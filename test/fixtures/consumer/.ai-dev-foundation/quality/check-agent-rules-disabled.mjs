import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Next.js 16.3+ `next dev` auto-detects an AI coding agent in the
// environment (CLAUDECODE, CURSOR_TRACE_ID, CODEX_*, GEMINI_CLI, etc. — see
// @vercel/detect-agent) and, unless `agentRules` is explicitly `false` in
// next.config, upserts a `<!-- BEGIN:nextjs-agent-rules -->` managed block
// into AGENTS.md (verified against Next.js 16.3.2's
// node_modules/next/dist/server/lib/start-server.js and
// generate-agent-files.js). AGENTS.md is a Foundation-owned generated
// artifact (see tooling/sync.mjs); Next.js runtime mutating it is drift this
// profile's consumers must not hit on an ordinary `next dev`.
//
// Only the three filenames Next.js itself accepts for configuration are
// checked (an unsupported extension such as .cjs/.cts is itself a Next.js
// config error, not this checker's concern).
const CANDIDATE_CONFIG_FILENAMES = ['next.config.ts', 'next.config.js', 'next.config.mjs'];

// Deliberately a text match, not a config evaluation: this checker does not
// execute consumer config (no import/require of consumer code, no bundler),
// so it cannot follow indirection such as `agentRules: someImportedFlag`.
// It catches the direct, documented opt-out Next.js's own docs show.
const AGENT_RULES_DISABLED_PATTERN = /["']?agentRules["']?\s*:\s*false\b/;

// A bare text match on the unmodified source would treat a mention inside a
// comment (e.g. `// TODO: set agentRules: false`) as if it were the actual
// opt-out, silently passing a config that has not disabled anything. Comments
// are stripped first so only code the JS/TS parser would actually evaluate
// can match. This is line/block-comment stripping, not full tokenization, so
// a `//` or `/*` inside a string literal is a known, accepted edge case for
// this bounded, filesystem-only checker.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

async function findConfigFile(directory) {
  for (const filename of CANDIDATE_CONFIG_FILENAMES) {
    const candidatePath = path.join(directory, filename);
    try {
      return { path: candidatePath, content: await readFile(candidatePath, 'utf8') };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

const configFile = await findConfigFile(process.cwd());

if (configFile === null) {
  console.error(
    `No next.config.{ts,js,mjs} found. Foundation-generated AGENTS.md is a generated artifact ` +
      `(see tooling/sync.mjs) that \`next dev\` will otherwise silently mutate. Add a next.config ` +
      `with \`agentRules: false\`.`,
  );
  process.exitCode = 1;
} else if (!AGENT_RULES_DISABLED_PATTERN.test(stripComments(configFile.content))) {
  console.error(
    `${path.basename(configFile.path)} does not disable Next.js's generated-AGENTS.md agent rules. ` +
      `Set \`agentRules: false\` in ${path.basename(configFile.path)}, otherwise \`next dev\` upserts a ` +
      `<!-- BEGIN:nextjs-agent-rules --> block into the Foundation-generated AGENTS.md whenever it detects ` +
      `an AI coding agent in the environment.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `${path.basename(configFile.path)} disables Next.js's generated-AGENTS.md agent rules (agentRules: false).`,
  );
}
