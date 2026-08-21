import { readFile } from "node:fs/promises";
import path from "node:path";
import { composeAgents, composeClaude, diffQualityProfile, parseConsumerArgument } from "./lib.mjs";

const consumerDirectory = parseConsumerArgument(process.argv.slice(2));
const expected = new Map([
  ["AGENTS.md", await composeAgents(consumerDirectory)],
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

const qualityProfileDrift = await diffQualityProfile(consumerDirectory);
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

if (hasDrift) {
  process.exitCode = 1;
} else {
  console.log(`Generated adapters and quality profile are current in ${consumerDirectory}`);
}
