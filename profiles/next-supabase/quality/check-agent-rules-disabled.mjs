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

// Matches a JS object property key that is EXACTLY `agentRules` — either a
// bare identifier not embedded in a longer one, or a fully quoted string
// whose entire content is `agentRules` — not merely a substring of a
// longer key. Shared between AGENT_RULES_DISABLED_PATTERN and
// AGENT_RULES_KEY_PATTERN below so both apply identical key-boundary rules
// (duplicating this by hand in each pattern previously let them drift out
// of sync — see the fix history in this PR).
//
// The quoted alternative, `(['"])agentRules\1`, CONSUMES both quote
// characters as part of the match (the backreference `\1` requires the
// closing quote to be the same character as the captured opening one). An
// earlier version used zero-width lookaround (`(?<=['"])`/`(?=['"])`)
// instead, which only verifies a quote is adjacent without consuming it —
// that let the match end sitting right before the closing quote, so the
// callers' `\s*:` (which cannot skip over a quote character) then failed
// to find the colon, breaking the ordinary, documented `"agentRules":
// false` / `'agentRules': false` cases entirely (independently caught by
// both Codex and Claude review on this PR — no existing fixture actually
// exercised a quoted key at the time, despite one being named
// `disabled-quoted-mjs`). Consuming the quotes fixes this while still
// correctly rejecting `{ 'not-agentRules': false }`: at the position right
// before `agentRules` in that string, the preceding character is `-`, not
// a quote, so `(['"])` doesn't match there.
//
// The bare-identifier alternative requires the character immediately
// before `agentRules` to be `{`, `,`, or whitespace (or nothing — start of
// text) — `(?<![^{,\s])` is a negative lookbehind on "any character that
// is NOT one of those", which also vacuously holds at the start of the
// string, where there is no preceding character to fail it. This is
// deliberately narrower than only excluding identifier characters
// (`(?<![\w$])`, used by an earlier version): a legitimate unquoted object
// key can only be immediately preceded by one of `{`, `,`, or whitespace,
// so anything else — punctuation like `-`, another quote, etc. — is never
// a valid bare-key start. The earlier, looser lookbehind let `agentRules`
// embedded inside a quoted string right after a `-` (as in
// `'not-agentRules'`) slip through the bare alternative, since `-` isn't a
// `\w`/`$` character either. The lookahead `(?![\w$])` still requires
// nothing immediately after `agentRules` is an identifier character,
// rejecting `{ agentRulesExtra: false }`.
const AGENT_RULES_KEY_SOURCE = /(?:(['"])agentRules\1|(?<![^{,\s])agentRules(?![\w$]))/.source;

// `false` must be the complete property value, not merely a prefix of a
// larger expression such as `agentRules: false || true` (which evaluates to
// `true`) — the lookahead requires whatever follows (after optional
// whitespace) to be a property/statement terminator or end of input, not
// arbitrary trailing expression text. `}` is included for defensiveness
// even though keepOnlyDirectProperties() below always blanks brace
// characters before this pattern runs, so a real `}` never reaches here.
const AGENT_RULES_DISABLED_PATTERN = new RegExp(
  `${AGENT_RULES_KEY_SOURCE}\\s*:\\s*false(?=\\s*[,;}]|\\s*$)`,
);

// Matches an `agentRules` key regardless of its value — used to find every
// occurrence among an object's direct properties, not just ones that
// happen to say `false`. JS object literals let the same key appear more
// than once; whichever occurrence appears LAST wins at runtime (this is
// legal, unambiguous JS, not a syntax error), so only the last occurrence's
// value is ever the effective one.
const AGENT_RULES_KEY_PATTERN = new RegExp(`${AGENT_RULES_KEY_SOURCE}\\s*:`, 'g');

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
// Out of this checker's documented scope (not a defect against it, per the
// module-level indirection note above — this is the same "does not execute
// consumer config" boundary, applied to scope resolution rather than value
// resolution): the declaration search below is anchored to the start of a
// line (no scope/indentation tracking), so a same-named binding declared at
// column 0 earlier in the file — not plausible for a real next.config,
// which declares its config once at the top level — could still be picked
// over the real one. A binding shadowed inside a nested function body is
// indented and so is excluded by the same anchor, which is why this does
// not regress the realistic case Next.js's own docs show. Closing this
// fully would require scope-aware parsing, which this filesystem-only,
// non-executing checker deliberately does not do.
//
// Note that identifier boundaries throughout this function use a
// `(?![\w$])` negative lookahead, not `\b`: `$` is a valid trailing
// identifier character but is not a `\w` character, so `\b` immediately
// after a `$`-suffixed identifier (e.g. `config$`) sits between two
// non-word characters and never asserts a boundary there, silently
// truncating the match to `config`.
function findExportedConfigObjectSource(source) {
  const exportedIdentifierMatch =
    /(?:export\s+default|module\.exports\s*=)\s*([A-Za-z_$][\w$]*)(?![\w$])/.exec(source);
  const declarationName = exportedIdentifierMatch?.[1];

  const openBraceMatch = declarationName
    ? new RegExp(
        `^(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(declarationName)}(?![\\w$])[^={]*=\\s*\\{`,
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
// `agentRules` property NextConfig actually reads. Brace/bracket depth is
// counted and only text at depth 1 relative to the exported object's own
// opening brace — its direct properties — is kept; deeper text is blanked
// out before matching. `[`/`]` are tracked the same way as `{`/`}` so an
// array-literal property VALUE (e.g. `pageExtensions: [...defaultExtensions,
// 'mdx']`, an ordinary Next.js config idiom) is blanked out too: without
// this, its contents stayed visible at depth 1, and hasSpreadAfter() below
// would false-positively read the array's own `...` spread — which has
// nothing to do with `agentRules` — as a possible override, fail-closing an
// actually-safe config (Claude review finding on this PR). This is
// brace/bracket counting, not full parsing, so a `{`/`}`/`[`/`]` inside a
// string or regex literal is a known, accepted edge case, matching the
// same bound already documented for stripComments().
//
// Out of this checker's documented scope (not fixed): unlike the
// fail-closed-only string-literal cases documented elsewhere in this file,
// a `]` inside a string/regex literal VALUE that sits between the winning
// `agentRules: false` and a real spread — e.g. `{ agentRules: false, note:
// ']', ...shared }` — can decrement depth prematurely and blank the real
// `...shared` out of directPropertiesText, hiding it from hasSpreadAfter()
// below (Codex review finding on this PR). If `shared` sets `agentRules`,
// this is a dangerous-direction miss (the checker reports green on a
// config `next dev` can still mutate), not merely a false alarm. Fully
// closing this requires distinguishing string/regex-literal contents from
// structural brackets, i.e. real JS tokenization, which this filesystem-
// only, non-executing checker deliberately does not do (see the
// module-level indirection note above) — it requires deliberately
// constructing a property value whose literal text contains an unbalanced
// bracket character positioned exactly between the winning key and a
// spread, which is not a plausible accidental `next.config`.
function keepOnlyDirectProperties(objectSource) {
  let depth = 0;
  let result = '';
  for (const character of objectSource) {
    if (character === '{' || character === '[') {
      depth += 1;
      result += ' ';
      continue;
    }
    if (character === '}' || character === ']') {
      depth -= 1;
      result += ' ';
      continue;
    }
    result += depth === 1 ? character : ' ';
  }
  return result;
}

// Finds the start index of the LAST `agentRules` key among an object's
// direct properties, or -1 if there is none. Two ways a later assignment
// can override an earlier explicit `agentRules: false` — a duplicate key
// (`{ agentRules: false, agentRules: true }`, legal JS: the last one wins)
// and a later spread whose source sets `agentRules` — are unified by this
// function and the caller: only the LAST key occurrence's value is ever
// the effective one, so evaluating anything before it is pointless, and a
// spread after it is exactly as override-capable as another explicit key.
//
// Out of this checker's documented scope (not a defect against it — the
// same "regex, not a tokenizer" bound already documented on stripComments()
// and keepOnlyDirectProperties() for `//`/`/*`/`{`/`}` inside string
// literals): a string VALUE that happens to contain the literal text
// `agentRules:` — e.g. `{ agentRules: false, note: 'agentRules: true' }` —
// is indistinguishable, to this pattern, from a real duplicate key, and
// would be treated as the last occurrence. This can only make the checker
// fail closed on an actually-fine config (a false alarm, not a silent
// pass), and requires a property value that itself contains the exact
// `agentRules:` key text — a construct this contrived is accepted as
// outside this filesystem-only checker's scope rather than chased with
// string-literal-aware tokenization.
function findLastAgentRulesKeyIndex(directPropertiesText) {
  AGENT_RULES_KEY_PATTERN.lastIndex = 0;
  let lastIndex = -1;
  let match;
  while ((match = AGENT_RULES_KEY_PATTERN.exec(directPropertiesText)) !== null) {
    lastIndex = match.index;
  }
  return lastIndex;
}

// A spread after the winning (last) `agentRules` key can still override it
// at runtime — `{ agentRules: false, ...shared }` sets agentRules: false,
// but if `shared` (evaluated after, per normal JS object literal semantics)
// itself has an `agentRules` key, that key wins, not `false`. This checker
// cannot evaluate what an arbitrary spread source contains (see the
// module-level indirection note above), so unlike the indirection/
// scope-shadowing bounds documented elsewhere in this file, this is not
// accepted as an unverifiable case that stays green: the caller fails
// closed instead of assuming `false` still holds. A spread BEFORE the
// winning key is fine — the explicit `agentRules: false` written after it
// is what wins, exactly as read.
function hasSpreadAfter(directPropertiesText, index) {
  return directPropertiesText.slice(index).includes('...');
}

// Distinguishes, for the error message only, "agentRules was never set to
// false" from "agentRules was set to false, but a later duplicate key
// overrides it" — the generic message is accurate but unhelpfully vague for
// the latter case (Claude review nit on this PR: a developer who already
// wrote `agentRules: false` and left a stale duplicate key behind can't
// tell what's wrong from the generic message alone).
function hasEarlierDisabledOccurrence(directPropertiesText, lastKeyIndex) {
  return (
    lastKeyIndex > 0 &&
    AGENT_RULES_DISABLED_PATTERN.test(directPropertiesText.slice(0, lastKeyIndex))
  );
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
  } else {
    const directPropertiesText = keepOnlyDirectProperties(exportedConfigObjectSource);
    const lastKeyIndex = findLastAgentRulesKeyIndex(directPropertiesText);
    const disabledMatch =
      lastKeyIndex === -1
        ? null
        : AGENT_RULES_DISABLED_PATTERN.exec(directPropertiesText.slice(lastKeyIndex));
    const lastKeyIsDisabled = disabledMatch !== null && disabledMatch.index === 0;

    if (!lastKeyIsDisabled) {
      if (hasEarlierDisabledOccurrence(directPropertiesText, lastKeyIndex)) {
        console.error(
          `${path.basename(configFile.path)} sets \`agentRules: false\` earlier, but a later duplicate ` +
            `\`agentRules\` key overrides it — JS keeps only the LAST occurrence of a duplicate object ` +
            `key, and \`next dev\` reads that final value. Remove the earlier \`agentRules: false\` or the ` +
            `later override so only one, disabling, \`agentRules\` assignment remains.`,
        );
      } else {
        console.error(
          `${path.basename(configFile.path)} does not disable Next.js's generated-AGENTS.md agent rules. ` +
            `Set \`agentRules: false\` in ${path.basename(configFile.path)}, otherwise \`next dev\` upserts a ` +
            `<!-- BEGIN:nextjs-agent-rules --> block into the Foundation-generated AGENTS.md whenever it detects ` +
            `an AI coding agent in the environment.`,
        );
      }
      process.exitCode = 1;
    } else if (hasSpreadAfter(directPropertiesText, lastKeyIndex + disabledMatch[0].length)) {
      console.error(
        `${path.basename(configFile.path)} sets \`agentRules: false\` but also spreads another object ` +
          `(\`...\`) into the config afterward. A later spread can override \`agentRules\` back to enabled ` +
          `at runtime, and this filesystem-only checker cannot verify what the spread source contains. ` +
          `Move \`agentRules: false\` after the spread (or remove the spread) so this checker can verify ` +
          `the effective value.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `${path.basename(configFile.path)} disables Next.js's generated-AGENTS.md agent rules (agentRules: false).`,
      );
    }
  }
}
