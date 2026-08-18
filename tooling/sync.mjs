import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { composeAgents, composeClaude, parseConsumerArgument } from "./lib.mjs";

const consumerDirectory = parseConsumerArgument(process.argv.slice(2));
const [agents, claude] = await Promise.all([
  composeAgents(consumerDirectory),
  composeClaude(),
]);

await mkdir(consumerDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(consumerDirectory, "AGENTS.md"), agents, "utf8"),
  writeFile(path.join(consumerDirectory, "CLAUDE.md"), claude, "utf8"),
]);

console.log(`Synchronized adapters in ${consumerDirectory}`);
