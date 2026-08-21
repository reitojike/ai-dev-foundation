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
  assert.match(core, /silent decision を\s+してはいけません/);
  assert.match(core, /Execution\s+Envelope の制約や事故を semantic decision として吸収してはいけません/);
  assert.doesNotMatch(core, /claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("core policy defines a thin invocation convention over a canonical Task Contract (Issue #29)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("### Thin invocation over a canonical Task Contract"));

  // Core rule: reference, don't restate, when a canonical Task Contract already
  // exists on a durable surface.
  assert.match(
    core,
    /Task の canonical context は Issue 本文です（本節冒頭）。この canonical\s+Task Contract が既に Issue 本文へ存在する場合、agent invocation はその\s+内容を原則として再掲せず、Issue を参照します。/,
  );

  // Regression guard (Codex P2 finding on PR #33): the new section must not
  // introduce a broader "durable surface" than the single canonical context
  // ("Issue 本文") already fixed earlier in this Task Protocol section.
  assert.doesNotMatch(core, /durable な project surface（Issue 本文等）/);

  // Representative examples of what invocation/handoff prompts should still carry.
  for (const item of [
    "canonical Task Contract の locator",
    "handoff 値を current と仮定せず、current state を再取得する指示",
    "Task Contract へまだ materialize されていない session 固有の追加",
    "execution authority",
    "stopping condition",
    "必要な review / verification への pointer",
  ]) {
    assert.ok(core.includes(item), `missing invocation-retained item: ${item}`);
  }

  // Material recurring decisions belong on the durable surface, not the prompt.
  assert.match(
    core,
    /material な追加 decision が session を跨いで継続的に必要になる場合は、/,
  );

  // Guardrail: this must not become a mechanical shortening rule when the
  // Task Contract itself is insufficient.
  assert.match(
    core,
    /短い prompt 自体を目的にしません。canonical Task Contract が不十分な場合/,
  );
  assert.match(
    core,
    /canonical\s+Task Contract の不足に気付いた場合は、省略ではなく Task Contract 自体の\s+更新を優先します。/,
  );

  // Guardrail (Codex P2 finding on PR #33 closure round): thin invocation
  // presupposes the receiving agent/session can actually reach the Issue
  // (an Execution Envelope / capability property, independent of Semantic
  // Contract sufficiency). When that access isn't guaranteed, the invoker
  // must inline the needed Task Contract content rather than a bare locator.
  assert.match(
    core,
    /thin invocation は、受け手の agent\/session が Issue 本文へアクセスできる\s+ことを前提とします。/,
  );
  assert.match(
    core,
    /受け手が Issue\s+本文へアクセスできることを保証できない場合、locator の提示だけで済ませ\s+ず、必要な Task Contract の内容を invocation へ直接含めます。/,
  );

  // Provider-neutral: no new prompt schema/DSL/generator, no hardcoded CLI/model.
  assert.match(core, /この convention は provider-neutral です。/);
  assert.match(core, /新しい\s+prompt schema \/ DSL \/ generator の導入を要求しません。/);
  assert.doesNotMatch(core, /claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});
