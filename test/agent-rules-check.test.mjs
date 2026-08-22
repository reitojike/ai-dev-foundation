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
