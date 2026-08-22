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
