import path from "node:path";
import { materializeOwnedDirectory, parseConsumerArgument, qualityProfileSourceDirectory } from "./lib.mjs";

const consumerDirectory = parseConsumerArgument(process.argv.slice(2));
const destination = path.join(consumerDirectory, ".ai-dev-foundation", "quality");

await materializeOwnedDirectory(qualityProfileSourceDirectory, destination);
console.log(`Bootstrapped Next.js + Supabase quality profile in ${destination}`);
