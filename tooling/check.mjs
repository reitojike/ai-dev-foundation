import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeAgents,
  composeClaude,
  diffQualityProfile,
  diffSkillBundle,
  parseConsumerArgument,
  skillsSourceDirectory,
} from "./lib.mjs";
import { REVIEWER_RECORD_RELATIVE_PATH, loadReviewerRecord } from "./reviewer-record-lib.mjs";

const foundationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const consumerDirectory = parseConsumerArgument(process.argv.slice(2));
const agentsContent = await composeAgents(consumerDirectory);
const expected = new Map([
  ["AGENTS.md", agentsContent],
  ["CLAUDE.md", await composeClaude()],
]);
const drifted = [];

for (const [file, content] of expected) {
  try {
    if ((await readFile(path.join(consumerDirectory, file), "utf8")) !== content) {
      drifted.push(file);
    }
  } catch (error) {
    if (error.code === "ENOENT") drifted.push(file);
    else throw error;
  }
}

const [qualityProfileDrift, skillBundleDrift, reviewerRecord] = await Promise.all([
  diffQualityProfile(consumerDirectory),
  diffSkillBundle(consumerDirectory),
  loadReviewerRecord(consumerDirectory),
]);
let hasDrift = false;

if (drifted.length > 0) {
  console.error(`Generated adapter drift detected: ${drifted.join(", ")}`);
  console.error("Run: node tooling/sync.mjs --consumer <path>");
  hasDrift = true;
}

if (qualityProfileDrift.length > 0) {
  console.error(
    `Foundation-owned quality profile is stale (.ai-dev-foundation/quality): ${qualityProfileDrift.join(", ")}`,
  );
  console.error("Run: node tooling/bootstrap-next-supabase.mjs --consumer <path>");
  hasDrift = true;
}

if (skillBundleDrift.length > 0) {
  console.error(`Foundation-owned skill bundle is stale (.ai-dev-foundation/skills): ${skillBundleDrift.join(", ")}`);
  console.error("Run: node tooling/sync.mjs --consumer <path>");
  hasDrift = true;
}

// Issue #72: the reviewer capability record is the consumer-owned artifact the
// Selection Contract now consults. A missing record is the failure this check
// exists to make impossible to miss — without it an agent has no machine-readable
// way to learn which reviewers exist, so it falls back to guessing. The record's
// contents stay consumer-owned; only presence/parse/minimal validity are checked.
if (reviewerRecord.status === "missing") {
  console.error(`Reviewer capability record is missing: ${REVIEWER_RECORD_RELATIVE_PATH}`);
  console.error(
    `Copy the example and edit it for this repository: ${path.join(foundationRoot, "templates", "reviewers.example.json")}`,
  );
  hasDrift = true;
} else if (reviewerRecord.status !== "ok") {
  console.error(`Reviewer capability record is ${reviewerRecord.status} (${REVIEWER_RECORD_RELATIVE_PATH}):`);
  for (const message of reviewerRecord.errors) console.error(`  - ${message}`);
  hasDrift = true;
}

// Advisory only (Issue #72, no threshold): the byte sizes the #72-series PRs are
// required to keep shrinking. Never affects the exit code.
const skillFiles = (await readdir(skillsSourceDirectory)).filter((file) => file.endsWith(".md")).sort();
const sizes = [["policy/core.md", Buffer.byteLength(await readFile(path.join(foundationRoot, "policy", "core.md")))]];
for (const file of skillFiles) {
  sizes.push([`skills/${file}`, Buffer.byteLength(await readFile(path.join(skillsSourceDirectory, file)))]);
}
sizes.push([`generated AGENTS.md (${consumerDirectory})`, Buffer.byteLength(agentsContent)]);

console.log("Artifact sizes (advisory, no threshold):");
for (const [label, bytes] of sizes) console.log(`  ${label}: ${bytes} bytes`);
console.log(`  total: ${sizes.reduce((sum, [, bytes]) => sum + bytes, 0)} bytes`);

if (hasDrift) {
  process.exitCode = 1;
} else {
  console.log(
    `Generated adapters, quality profile, skill bundle, and reviewer capability record are current in ${consumerDirectory}`,
  );
}
