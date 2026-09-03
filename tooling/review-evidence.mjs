import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  collectReviewEvidence,
  formatHumanSummary,
  parseReviewEvidenceArgs,
} from "./review-evidence-lib.mjs";
import { evaluateReviewerTargetStates } from "./review-evidence-state-lib.mjs";
import { readReviewerRecordFile } from "./reviewer-record-lib.mjs";

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

const args = parseReviewEvidenceArgs(process.argv.slice(2));
const [owner, repo] = args.repo.split("/");
const token = resolveToken(args.token);

if (!token) {
  console.error(
    "No GitHub token available. Set GH_TOKEN/GITHUB_TOKEN, pass --token, or run `gh auth login`.",
  );
  process.exitCode = 2;
} else {
  const result = await collectReviewEvidence({
    owner,
    repo,
    pullNumber: Number(args.pr),
    token,
  });
  if (args.targetSha) {
    const recordPath =
      args.recordPath ?? path.join(".ai-dev-foundation", "reviewers.json");
    const loaded = await readReviewerRecordFile(recordPath);
    if (loaded.status !== "ok") {
      console.error(
        `Reviewer record cannot be used (${loaded.status}): ${loaded.errors.join("; ") || loaded.path}`,
      );
      process.exitCode = 2;
    } else {
      const state = evaluateReviewerTargetStates(result, {
        record: loaded.record,
        target: args.targetSha,
        reviewerId: args.reviewerId ?? null,
        runAnchor:
          args.runAfter || args.runAnchorId
            ? {
                after: args.runAfter ?? null,
                ids: args.runAnchorId ? [args.runAnchorId] : [],
              }
            : null,
      });
      console.log(JSON.stringify(state, null, 2));
      process.exitCode = result.fetch_failures > 0 ? 1 : 0;
    }
  } else {
    console.log(
      args.json ? JSON.stringify(result, null, 2) : formatHumanSummary(result),
    );
    process.exitCode = result.fetch_failures > 0 ? 1 : 0;
  }
}
