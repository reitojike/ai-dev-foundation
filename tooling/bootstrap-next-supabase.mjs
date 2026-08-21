import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseConsumerArgument, qualityProfileSourceDirectory } from "./lib.mjs";

const consumerDirectory = parseConsumerArgument(process.argv.slice(2));
const source = qualityProfileSourceDirectory;
const destination = path.join(consumerDirectory, ".ai-dev-foundation", "quality");

await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Bootstrapped Next.js + Supabase quality profile in ${destination}`);
