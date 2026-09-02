import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectReviewEvidence, formatHumanSummary, parseReviewEvidenceArgs } from "./review-evidence-lib.mjs";
import { evaluateReviewerStates, formatReviewerStateSummary } from "./reviewer-state-lib.mjs";
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

// The record is resolved and validated before any network call, so a broken
// record fails fast with the same messages `check` reports rather than after a
// full fetch.
let reviewerRecord = null;
let recordDigest = null;
if (args.reviewers) {
  const recordPath = path.resolve(args.reviewers);
  const loaded = await readReviewerRecordFile(recordPath);
  if (loaded.status !== "ok") {
    console.error(`Reviewer capability record ${loaded.status} (${loaded.path})`);
    for (const message of loaded.errors) console.error(`  - ${message}`);
    process.exitCode = 2;
  } else {
    reviewerRecord = loaded.record;
    recordDigest = `sha256:${createHash("sha256").update(await readFile(recordPath)).digest("hex")}`;
  }
}

if (process.exitCode === 2) {
  // The record problem above is already reported; do not fetch.
} else if (!token) {
  console.error("No GitHub token available. Set GH_TOKEN/GITHUB_TOKEN, pass --token, or run `gh auth login`.");
  process.exitCode = 2;
} else {
  const result = await collectReviewEvidence({ owner, repo, pullNumber: Number(args.pr), token });
  const reviewerStates = reviewerRecord
    ? evaluateReviewerStates(result, reviewerRecord, {
        targetSha: args.targetSha,
        since: args.since,
        recordDigest,
      })
    : null;
  if (args.json) {
    console.log(JSON.stringify(reviewerStates ? { ...result, reviewer_states: reviewerStates } : result, null, 2));
  } else {
    console.log(formatHumanSummary(result) + (reviewerStates ? formatReviewerStateSummary(reviewerStates) : ""));
  }
  process.exitCode = result.fetch_failures > 0 ? 1 : 0;
}
