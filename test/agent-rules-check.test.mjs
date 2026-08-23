import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerScript = path.join(root, "profiles", "next-supabase", "quality", "check-agent-rules-disabled.mjs");
const fixturesRoot = path.join(root, "test", "fixtures", "agent-rules");

function runChecker(cwd) {
  return spawnSync(process.execPath, [checkerScript], { cwd, encoding: "utf8" });
}

test("agentRules: false in next.config.ts is green", () => {
  const result = runChecker(path.join(fixturesRoot, "disabled"));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /next\.config\.ts/);
  assert.match(result.stdout, /agentRules: false/);
});

test("a quoted \"agentRules\": false key in next.config.mjs is also green", () => {
  const result = runChecker(path.join(fixturesRoot, "disabled-quoted-mjs"));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /next\.config\.mjs/);
});

test("a next.config.js that never sets agentRules is deterministically red", () => {
  // This is the Issue #40 canonical failure mode: an ordinary Next.js
  // consumer whose next.config leaves the Next.js 16.3+ default (agent
  // rules enabled), so `next dev` upserts a managed block into the
  // Foundation-generated AGENTS.md the first time it detects an AI coding
  // agent in the environment.
  const result = runChecker(path.join(fixturesRoot, "not-disabled"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
  assert.match(result.stderr, /agentRules: false/);
  assert.match(result.stderr, /next\.config\.js/);
});

test("agentRules: false mentioned only inside a comment does not count as disabling it", () => {
  // A bare text match without comment-stripping would false-pass this
  // fixture, defeating the checker's purpose: the config never actually
  // sets agentRules, so next dev would still mutate AGENTS.md.
  const result = runChecker(path.join(fixturesRoot, "commented-out"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("agentRules: false nested inside an unrelated object does not count as the top-level opt-out", () => {
  // Codex P2 finding on this PR: a bare comment-stripped text match would
  // still treat a coincidentally named property nested inside some other
  // object (e.g. `experimental.agentRules`) as if it were the top-level
  // NextConfig `agentRules` the actual opt-out requires, false-passing a
  // config whose real top-level agentRules is unset.
  const result = runChecker(path.join(fixturesRoot, "nested-unrelated"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("agentRules: false in an unrelated top-level object does not shadow the actually exported config", () => {
  // Codex P2 finding on this PR (closure round): the earlier depth-1 fix
  // still matched agentRules: false in ANY top-level object, not only the
  // one `module.exports`/`export default` actually points at. A file that
  // shadows the exported nextConfig's agentRules: true with an unrelated
  // metadata object's agentRules: false must stay red.
  const result = runChecker(path.join(fixturesRoot, "shadowed-by-unrelated-export"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("a directly inlined `export default { agentRules: false }` is green", () => {
  const result = runChecker(path.join(fixturesRoot, "inline-export"));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /next\.config\.mjs/);
});

test("a `$`-prefixed export identifier (e.g. $config) is not corrupted as regex syntax", () => {
  // Codex P2 finding on this PR (2nd closure round): embedding the
  // identifier unescaped in `new RegExp(...)` let a literal `$` in a valid
  // JS identifier be read as a regex end-anchor, making the checker fail to
  // find an actually-disabled config.
  const result = runChecker(path.join(fixturesRoot, "dollar-identifier"));
  assert.equal(result.status, 0);
});

test("a same-named binding shadowed inside a nested function body does not shadow the real top-level export", () => {
  // Codex P2 finding on this PR (2nd closure round): anchoring the
  // declaration search to the start of a line excludes an indented,
  // function-scoped shadow, so the top-level (unindented) declaration that
  // module.exports actually points at is the one selected.
  const result = runChecker(path.join(fixturesRoot, "shadowed-by-nested-scope"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("a `$`-suffixed export identifier (e.g. config$) is matched in full, not truncated at the $", () => {
  // Codex P2 finding on this PR (4th closure round): `\b` right after an
  // identifier ending in `$` never asserts a boundary there (both sides are
  // non-word characters), so the capture silently backtracked to the
  // identifier without its trailing `$` — resolving to an unrelated
  // same-prefixed binding instead of the one actually exported.
  const result = runChecker(path.join(fixturesRoot, "dollar-suffixed-shadow"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("agentRules: false as a prefix of a larger expression (false || true) does not count as disabling it", () => {
  // Codex P2 finding on this PR (5th closure round): `false` must be the
  // complete property value. `agentRules: false || true` evaluates to
  // `true` at runtime, so next dev still mutates AGENTS.md even though the
  // literal text "false" appears right after "agentRules:".
  const result = runChecker(path.join(fixturesRoot, "incomplete-false-expression"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("agentRules: false followed by a spread that could override it is deterministically red, not assumed still false", () => {
  // Re-adjudicated under the current (post-#45) Resolution Contract: this is
  // an accepted defect, not an out-of-scope indirection case, because the
  // checker's job is specifically to verify the effective agentRules value,
  // and `{ agentRules: false, ...shared }` sets agentRules: false only if
  // `shared` (evaluated after, per normal JS object literal semantics)
  // doesn't itself set agentRules. This checker cannot evaluate what a
  // spread source contains, so it must fail closed rather than assume the
  // explicit `false` still wins.
  const result = runChecker(path.join(fixturesRoot, "spread-after-agent-rules"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /spreads another object/);
});

test("a spread before agentRules: false does not block the check — the explicit property after it wins", () => {
  // `{ ...shared, agentRules: false }`: the explicit property written after
  // the spread is what JS actually evaluates last, so this is verifiable
  // and must stay green.
  const result = runChecker(path.join(fixturesRoot, "spread-before-agent-rules"));
  assert.equal(result.status, 0);
});

test("a duplicate agentRules key that overrides false back to true is deterministically red", () => {
  // Codex and Claude independently found this in the same review round:
  // the same root cause as the spread-override fix — a later assignment to
  // the same key overrides an earlier one, per legal JS object literal
  // semantics — but via a plain duplicate key instead of a spread.
  // `{ agentRules: false, agentRules: true }` effectively sets true.
  const result = runChecker(path.join(fixturesRoot, "duplicate-key-overrides-to-enabled"));
  assert.notEqual(result.status, 0);
  // Claude review nit on this PR: the error message should distinguish
  // "never set" from "set false, then overridden" so a developer who wrote
  // agentRules: false but left a stale duplicate key can tell what's wrong.
  assert.match(result.stderr, /sets `agentRules: false` earlier, but a later duplicate/);
});

test("a duplicate agentRules key where the later occurrence is still false stays green", () => {
  // `{ agentRules: true, agentRules: false }`: the later occurrence is what
  // JS actually keeps, and it is a complete `false` value with nothing
  // after it, so this is verifiable and must stay green.
  const result = runChecker(path.join(fixturesRoot, "duplicate-key-still-disabled"));
  assert.equal(result.status, 0);
});

test("a differently named property whose name merely ends in agentRules does not count as the real key", () => {
  // Codex finding on this PR (fresh discovery round, target 10194e5):
  // without a key-start boundary, `{ notAgentRules: false }` was read as if
  // it were the real `agentRules` key, false-passing a config where the
  // real agentRules option is unset — the dangerous direction (next dev
  // still mutates AGENTS.md, but the checker said green).
  const result = runChecker(path.join(fixturesRoot, "name-suffix-collision"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("a quoted property name that merely ends in agentRules (e.g. 'not-agentRules') does not count as the real key", () => {
  // Codex finding on this PR (closure round): an optional quote on each
  // side (`["']?agentRules["']?`) let `{ 'not-agentRules': false }` match
  // by simply not consuming the leading quote and starting mid-string —
  // the `-` before `agentRules` isn't a `\w`/`$` character, so the old
  // bare-key lookbehind alone didn't reject it either. Requiring an actual
  // quote immediately on both sides of `agentRules` (not an optional one)
  // closes this.
  const result = runChecker(path.join(fixturesRoot, "quoted-name-suffix-collision"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not disable Next\.js's generated-AGENTS\.md agent rules/);
});

test("an unrelated array property's spread does not block the check", () => {
  // Claude finding on this PR (fresh discovery round, target 10194e5):
  // keepOnlyDirectProperties() only tracked `{`/`}` depth, so an array
  // literal property value like `pageExtensions: [...defaultExtensions,
  // 'mdx']` (an ordinary Next.js config idiom) stayed visible at depth 1,
  // and hasSpreadAfter() then false-positively flagged its unrelated `...`
  // as a possible agentRules override on an actually-safe config.
  const result = runChecker(path.join(fixturesRoot, "array-spread-unrelated-property"));
  assert.equal(result.status, 0);
});

test("a consumer with no next.config file at all is deterministically red, not a silent pass", () => {
  const result = runChecker(path.join(fixturesRoot, "missing-config"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No next\.config/);
  assert.match(result.stderr, /agentRules: false/);
});

test("the checker requires no next dev, network, or browser to run", () => {
  // A filesystem-only guardrail must not require actually starting a Next.js
  // dev server to determine whether AGENTS.md is at risk of mutation.
  const result = runChecker(path.join(fixturesRoot, "disabled"));
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
});
