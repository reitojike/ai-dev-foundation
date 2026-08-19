import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("core policy defines the provider-neutral Task Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  for (const heading of [
    "Goal",
    "Acceptance Criteria",
    "In Scope / Out of Scope",
    "Decisions / Invariants",
    "Verification",
    "Allowed Discretion / Escalate When",
    "Execution State",
  ]) {
    assert.ok(core.includes(heading), `missing Task Contract item: ${heading}`);
  }

  assert.match(core, /\*\*High\*\*/);
  assert.match(core, /\*\*Balanced\*\*/);
  assert.match(core, /\*\*Fast\*\*/);
  assert.match(core, /Task boundary と agent\/session boundary は一致しません/);
  assert.match(core, /silent decision を\nしてはいけません/);
  assert.match(core, /Execution\nEnvelope の制約や事故を semantic decision として吸収してはいけません/);
  assert.doesNotMatch(core, /claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});
