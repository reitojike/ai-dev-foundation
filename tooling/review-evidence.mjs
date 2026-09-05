import { execFileSync } from "node:child_process";
import {
  collectReviewEvidence,
  formatHumanSummary,
  parseReviewEvidenceArgs,
} from "./review-evidence-lib.mjs";
import {
  describeUnusableReviewerRecord,
  readReviewerRecordFile,
  resolveConsumerReviewerRecordPath,
} from "./reviewer-record-lib.mjs";
import { evaluateReviewerTargetStates } from "./review-evidence-state-lib.mjs";

// Snapshot tool only (Issue #62): one fresh fetch per invocation, no
// polling/daemon. Re-run it to get a new snapshot.
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

const EXIT_SETUP_ERROR = 2;

// Setup before acquisition (Issue #96): the reviewer capability record is
// resolved and loaded BEFORE the fresh fetch, so a record that cannot be used —
// including one this helper refuses to resolve from the Foundation checkout's
// own cwd default — is reported as a setup failure instead of after spending an
// acquisition. Ordering only; the state projection itself is unchanged.
async function main() {
  const args = parseReviewEvidenceArgs(process.argv.slice(2));
  const token = resolveToken(args.token);
  if (!token) {
    console.error(
      "No GitHub token available. Set GH_TOKEN/GITHUB_TOKEN, pass --token, or run `gh auth login`.",
    );
    return EXIT_SETUP_ERROR;
  }

  let record = null;
  if (args.state) {
    const recordPath = resolveConsumerReviewerRecordPath(args.record);
    const loaded = await readReviewerRecordFile(recordPath);
    if (loaded.status !== "ok") {
      console.error(describeUnusableReviewerRecord(loaded));
      return EXIT_SETUP_ERROR;
    }
    record = loaded.record;
  }

  const [owner, repo] = args.repo.split("/");
  const result = await collectReviewEvidence({
    owner,
    repo,
    pullNumber: Number(args.pr),
    token,
  });

  if (!args.state) {
    console.log(
      args.json ? JSON.stringify(result, null, 2) : formatHumanSummary(result),
    );
  } else {
    const state = evaluateReviewerTargetStates(result, {
      record,
      reviewerId: args.reviewer ?? null,
      target: { sha: args.targetSha },
      runAnchor: {
        ids: args.runAnchorId ? [args.runAnchorId] : [],
        after: args.runAfter ?? null,
      },
    });
    console.log(JSON.stringify(state, null, 2));
  }
  return result.fetch_failures > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = EXIT_SETUP_ERROR;
}
