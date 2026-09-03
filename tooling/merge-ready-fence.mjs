import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectReviewEvidence } from "./review-evidence-lib.mjs";
import { readReviewerRecordFile } from "./reviewer-record-lib.mjs";
import { evaluateReviewerTargetStates } from "./review-evidence-state-lib.mjs";
import {
  MERGE_READY_FENCE_USAGE,
  evaluateMergeReadyFence,
  parseAcknowledgedRevisions,
  parseMergeReadyFenceArgs,
} from "./merge-ready-fence-lib.mjs";

// Deterministic merge-ready fence CLI (Issue #76).
//
// One invocation performs exactly ONE fresh acquisition and evaluates every
// machine-checkable precondition against it. It deliberately accepts no
// snapshot argument: there is no way to hand this tool an evidence snapshot
// observed earlier in a session, which is what makes "the fence was evaluated
// on fresh evidence" a structural property rather than a promise.
//
// Exit codes: 0 = pass, 1 = fail, 2 = unknown. Usage/setup errors also exit 2
// but write to stderr and emit no JSON on stdout.

function resolveToken(explicitToken) {
  if (explicitToken) return explicitToken;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// A missing optional list stays null so the fence can report `unknown` for the
// check that needed it, rather than silently evaluating against an empty set.
async function readPathList(filePath, inline) {
  const values = inline === null ? [] : [...inline];
  if (filePath) {
    const text = await readFile(path.resolve(filePath), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) values.push(trimmed);
    }
  }
  return inline === null && !filePath ? null : values;
}

async function readAcknowledged(filePath, inline) {
  if (inline === null && !filePath) return null;
  const lines = inline === null ? [] : [...inline];
  if (filePath) lines.push(await readFile(path.resolve(filePath), "utf8"));
  const parsed = parseAcknowledgedRevisions(lines.join("\n"));
  if (parsed.malformed.length > 0) {
    throw new Error(`Malformed --acknowledged entry: ${parsed.malformed[0]}`);
  }
  return parsed.entries;
}

const EXIT_CODE = { pass: 0, fail: 1, unknown: 2 };

let args;
try {
  args = parseMergeReadyFenceArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(MERGE_READY_FENCE_USAGE);
  process.exitCode = 2;
}

if (args) {
  const token = resolveToken(args.token);
  if (!token) {
    console.error("No GitHub token available. Set GH_TOKEN/GITHUB_TOKEN, pass --token, or run `gh auth login`.");
    process.exitCode = 2;
  } else {
    const recordPath = path.resolve(args.record ?? ".ai-dev-foundation/reviewers.json");
    const loaded = await readReviewerRecordFile(recordPath);
    if (loaded.status !== "ok") {
      console.error(`Reviewer record ${loaded.status}: ${recordPath}`);
      process.exitCode = 2;
    } else {
      const [artifacts, acknowledged] = await Promise.all([
        readPathList(args.artifactsFile, args.artifacts),
        readAcknowledged(args.acknowledgedFile, args.acknowledged),
      ]);
      const [owner, repo] = args.repo.split("/");
      const evidence = await collectReviewEvidence({
        owner,
        repo,
        pullNumber: Number(args.pr),
        token,
      });
      // Every reviewer in the record is evaluated, not just the required
      // ones: an advisory reviewer whose result has already arrived still
      // owes revision coherence (Issue #76 amendment).
      const state = evaluateReviewerTargetStates(evidence, {
        record: loaded.record,
        target: { sha: args.targetSha },
        runAnchor: { ids: args.runAnchorIds, after: args.runAfter ?? null },
      });
      const fence = evaluateMergeReadyFence({
        evidence,
        state,
        inputs: {
          targetSha: args.targetSha,
          baseSha: args.baseSha ?? null,
          artifacts,
          verifySha: args.verifySha ?? null,
          requiredReviewers: args.requiredReviewers,
          declaredSkills: args.declaredSkills.length > 0 ? args.declaredSkills : null,
          acknowledged,
        },
      });
      console.log(JSON.stringify(fence, null, 2));
      process.exitCode = EXIT_CODE[fence.status];
    }
  }
}
