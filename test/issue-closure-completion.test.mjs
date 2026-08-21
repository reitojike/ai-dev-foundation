import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripWhitespace(text) {
  return text.replace(/\s+/g, "");
}

function containsText(haystack, needle) {
  return stripWhitespace(haystack).includes(stripWhitespace(needle));
}

test("core policy defines the Issue closure and Acceptance Criteria completion protocol (#32)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("### Issue closure and Acceptance Criteria completion"));

  // This must stay a distinct contract from Review Protocol's merge-readiness:
  // review completion does not stand in for Acceptance Criteria confirmation.
  assert.ok(
    containsText(
      core,
      "Task Contract の completion は、Review Protocol の merge-readiness（Merge readiness and merge authority）とは別の contract です。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "merge-ready の成立、または実際の merge は、canonical Issue 上の Acceptance Criteria が満たされたことの証跡にはなりません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "Review が完了していても、Issue Task Contract 上の Acceptance Criteria 確認を省略してよいことにはなりません。",
    ),
  );

  // The 5 required pre-close steps.
  assert.ok(containsText(core, "canonical context の再取得"));
  assert.ok(
    containsText(
      core,
      "close しようとする session 自身の記憶や過去の長文 handoff をそのまま正としてはいけません。",
    ),
  );
  assert.ok(containsText(core, "Acceptance Criteria evidence 照合"));
  assert.ok(
    containsText(
      core,
      "「実装が完了したように見える」という印象だけでは充足の根拠にしません。",
    ),
  );
  assert.ok(containsText(core, "checkbox 更新"));
  assert.ok(
    containsText(
      core,
      "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    ),
  );
  assert.ok(containsText(core, "未達・判断不能な項目の扱い"));
  assert.ok(
    containsText(
      core,
      "evidence 不足または未達で判断できない Acceptance Criteria が 1 件でも残る場合、その項目を勝手に check せず、Issue も close しません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "Issue に Acceptance Criteria が存在しない場合、close のために新たな Acceptance Criteria を捏造しません。",
    ),
  );
  assert.ok(containsText(core, "completion comment"));
  assert.ok(
    containsText(
      core,
      "final SHA、verification 結果、review evidence（Review Protocol の Acquisition & Validity Contract に従う record / result locator を含む）、および未解決事項を、Issue 上の completion comment として記録します。",
    ),
  );

  // The recommended sequence, verbatim from Issue #32.
  assert.ok(
    containsText(
      core,
      "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    ),
  );

  // Authority separation mirrors Merge readiness and merge authority: no authority,
  // no close — leave a completion handoff and stop instead.
  assert.ok(
    containsText(
      core,
      "Issue close の execution authority は、Merge readiness and merge authority と同じ分離に従います。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "current Task、Execution Envelope、または explicit な authority が close の実行を許可している場合に限り、agent は Issue を close してよいです。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "agent は Issue 本文の編集や close を実行せず、どの Acceptance Criteria がどの evidence で満たされているか（または未達か）を completion handoff として明示的に残した上で停止し、authority escalation / handoff します。",
    ),
  );

  // Constraint from Issue #32: auto-close keywords must not become the standard
  // path to a pre-AC-check close (full prohibition of auto-close is out of scope).
  assert.ok(
    containsText(
      core,
      "auto-close keyword（例: PR 本文の \"Closes #N\"）によって Acceptance Criteria 確認前に Issue が自動 close される運用を、標準運用にしません。",
    ),
  );

  // Out of scope for #32: no new bot / workflow-engine / orchestrator machinery.
  assert.ok(
    containsText(
      core,
      "この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management workflow engine、または新しい orchestrator を要求しません。",
    ),
  );

  // Stays provider-neutral, like the rest of the Kernel.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("generated consumer AGENTS.md reflects the Issue closure completion protocol", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assert.ok(agents.includes("### Issue closure and Acceptance Criteria completion"));
  assert.ok(
    containsText(
      agents,
      "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    ),
  );
});
