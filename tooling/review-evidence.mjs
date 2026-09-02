import { execFileSync } from "node:child_process";
import { collectReviewEvidence, formatHumanSummary, parseReviewEvidenceArgs } from "./review-evidence-lib.mjs";

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
  console.error("No GitHub token available. Set GH_TOKEN/GITHUB_TOKEN, pass --token, or run `gh auth login`.");
  process.exitCode = 2;
} else {
  const result = await collectReviewEvidence({ owner, repo, pullNumber: Number(args.pr), token });
  console.log(args.json ? JSON.stringify(result, null, 2) : formatHumanSummary(result));
  process.exitCode = result.fetch_failures > 0 ? 1 : 0;
}
