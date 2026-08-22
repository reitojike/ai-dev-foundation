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

// A valid JS identifier can contain `$` (e.g. `$config`), which is a regex
// metacharacter. Embedding an un-escaped identifier in `new RegExp(...)`
// below would let a `$` in the identifier be read as regex syntax instead of
// a literal character, corrupting the match.
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Locates, by source span, the object literal that a `next.config` file
// actually `export default`s or `module.exports`s — following at most one
// level of the canonical indirection Next.js's own docs show:
//   const nextConfig: NextConfig = { ... }; export default nextConfig;
//   const nextConfig = { ... }; module.exports = nextConfig;
// or a directly inlined `export default { ... }` / `module.exports = { ... }`.
// Restricting the search to this object (rather than every top-level object
// literal in the file) matters: without it, an unrelated top-level object —
// `const metadata = { agentRules: false }; const nextConfig = { agentRules:
// true }; module.exports = nextConfig;` — would satisfy the checker even
// though the config Next.js actually loads has agentRules left enabled.
// Any other export shape (a wrapped call like `withPlugin(nextConfig)`, a
// config assembled via spread from another module, re-exports, etc.) is out
// of scope for this filesystem-only checker and returns null so the caller
// fails loudly instead of guessing.
//
// Known, accepted bound (not fixed): the declaration search below is
// anchored to the start of a line (no scope/indentation tracking), so a
// same-named binding declared at column 0 earlier in the file — not
// plausible for a real next.config, which declares its config once at the
// top level — could still be picked over the real one. A binding shadowed
// inside a nested function body, as in Codex's adversarial example on this
// PR (`function helper() { const nextConfig = {...} }`), is indented and so
// is excluded by the same anchor. Closing this fully would require
// scope-aware parsing, which this filesystem-only, non-executing checker
// deliberately does not do (see the module-level indirection note above).
function findExportedConfigObjectSource(source) {
  const exportedIdentifierMatch =
    /(?:export\s+default|module\.exports\s*=)\s*([A-Za-z_$][\w$]*)\b/.exec(source);
  const declarationName = exportedIdentifierMatch?.[1];

  const openBraceMatch = declarationName
    ? new RegExp(
        `^(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(declarationName)}\\b[^={]*=\\s*\\{`,
        'm',
      ).exec(source)
    : /(?:export\s+default|module\.exports\s*=)\s*\{/.exec(source);
  if (!openBraceMatch) return null;

  const openBraceIndex = openBraceMatch.index + openBraceMatch[0].length - 1;
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, index + 1);
    }
  }
  return null;
}

// A comment-stripped text match against the exported object's own source
// would still treat an unrelated, coincidentally named `agentRules: false`
// nested inside some other property of that same object (for example
// `{ experimental: { agentRules: false } }`) as if it were the top-level
// `agentRules` property NextConfig actually reads. Brace depth is counted
// and only text at depth 1 relative to the exported object's own opening
// brace — its direct properties — is kept; deeper text is blanked out
// before matching. This is brace counting, not full parsing, so a `{` or
// `}` inside a string literal is a known, accepted edge case, matching the
// same bound already documented for stripComments().
function keepOnlyDirectProperties(objectSource) {
  let depth = 0;
  let result = '';
  for (const character of objectSource) {
    if (character === '{') {
      depth += 1;
      result += ' ';
      continue;
    }
    if (character === '}') {
      depth -= 1;
      result += ' ';
      continue;
    }
    result += depth === 1 ? character : ' ';
  }
  return result;
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
} else {
  const exportedConfigObjectSource = findExportedConfigObjectSource(
    stripComments(configFile.content),
  );
  if (exportedConfigObjectSource === null) {
    console.error(
      `Could not determine the exported config object in ${path.basename(configFile.path)}. ` +
        `This checker only recognizes the canonical shapes Next.js's own docs show: ` +
        `\`const nextConfig = { ... }; export default nextConfig;\` (or \`module.exports = nextConfig;\`), ` +
        `or a directly inlined \`export default { ... }\` / \`module.exports = { ... }\`. ` +
        `Use one of these shapes with \`agentRules: false\` so this checker can verify it.`,
    );
    process.exitCode = 1;
  } else if (
    !AGENT_RULES_DISABLED_PATTERN.test(keepOnlyDirectProperties(exportedConfigObjectSource))
  ) {
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
}
