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

// Shared assertion set for the Issue closure and Acceptance Criteria completion
// protocol (#32). Run against both the canonical policy/core.md and the
// generated consumer AGENTS.md, since composeAgents() embeds core.md verbatim
// and this protocol's content must not silently drift between the two.
function assertIssueClosureCompletionProtocol(text, label) {
  assert.ok(text.includes("### Issue closure and Acceptance Criteria completion"), `${label}: missing heading`);

  // This must stay a distinct contract from Review Protocol's merge-readiness:
  // review completion does not stand in for Acceptance Criteria confirmation.
  assert.ok(
    containsText(
      text,
      "Task Contract の completion は、Review Protocol の merge-readiness（Merge readiness and merge authority）とは別の contract です。",
    ),
    `${label}: missing merge-readiness separation statement`,
  );
  assert.ok(
    containsText(
      text,
      "merge-ready の成立、または実際の merge は、canonical Issue 上の Acceptance Criteria が満たされたことの証跡にはなりません。",
    ),
    `${label}: missing merge-ready-is-not-AC-evidence statement`,
  );
  assert.ok(
    containsText(
      text,
      "Review が完了していても、Issue Task Contract 上の Acceptance Criteria 確認を省略してよいことにはなりません。",
    ),
    `${label}: missing review-completion-does-not-skip-AC statement`,
  );

  // The 5 required pre-close steps.
  assert.ok(containsText(text, "canonical context の再取得"), `${label}: missing step 1 label`);
  assert.ok(
    containsText(
      text,
      "close しようとする session 自身の記憶や過去の長文 handoff をそのまま正としてはいけません。",
    ),
    `${label}: missing step 1 detail`,
  );
  assert.ok(containsText(text, "Acceptance Criteria evidence 照合"), `${label}: missing step 2 label`);
  assert.ok(
    containsText(text, "「実装が完了したように見える」という印象だけでは充足の根拠にしません。"),
    `${label}: missing step 2 detail`,
  );
  assert.ok(containsText(text, "checkbox 更新"), `${label}: missing step 3 label`);
  assert.ok(
    containsText(
      text,
      "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    ),
    `${label}: missing step 3 detail`,
  );
  assert.ok(containsText(text, "未達・判断不能な項目の扱い"), `${label}: missing step 4 label`);
  assert.ok(
    containsText(
      text,
      "evidence 不足または未達で判断できない Acceptance Criteria が 1 件でも残る場合、その項目を勝手に check せず、Issue も close しません。",
    ),
    `${label}: missing step 4 detail`,
  );
  assert.ok(
    containsText(
      text,
      "Issue に Acceptance Criteria が存在しない場合、close のために新たな Acceptance Criteria を捏造しません。",
    ),
    `${label}: missing no-fabricating-AC statement`,
  );
  assert.ok(containsText(text, "completion comment"), `${label}: missing step 5 label`);
  assert.ok(
    containsText(
      text,
      "final SHA、verification 結果、review evidence（Review Protocol の Acquisition & Validity Contract に従う record / result locator を含む）、および未解決事項を、Issue 上の completion comment として記録します。",
    ),
    `${label}: missing step 5 detail`,
  );

  // The recommended sequence, verbatim from Issue #32.
  assert.ok(
    containsText(
      text,
      "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    ),
    `${label}: missing recommended sequence`,
  );

  // Authority separation mirrors Merge readiness and merge authority: no
  // authority, no close — leave a completion comment and stop instead.
  assert.ok(
    containsText(
      text,
      "Issue close の execution authority は、Merge readiness and merge authority と同じ分離に従います。",
    ),
    `${label}: missing authority separation statement`,
  );
  assert.ok(
    containsText(
      text,
      "current Task、Execution Envelope、または explicit な authority が close の実行を許可している場合に限り、agent は Issue を close してよいです。",
    ),
    `${label}: missing authority-permits-close statement`,
  );
  assert.ok(
    containsText(
      text,
      "agent は Issue 本文の編集や close を実行せず、どの Acceptance Criteria がどの evidence で満たされているか（または未達か）を手順 5 の completion comment として明示的に残した上で停止し、authority escalation / handoff します。",
    ),
    `${label}: missing no-authority stop-and-handoff statement`,
  );

  // Constraint from Issue #32: auto-close keywords must not become the standard
  // path to a pre-AC-check close (full prohibition of auto-close is out of scope).
  assert.ok(
    containsText(
      text,
      "auto-close keyword（例: PR 本文の \"Closes #N\"）によって Acceptance Criteria 確認前に Issue が自動 close される運用を、標準運用にしません。",
    ),
    `${label}: missing auto-close-not-standard statement`,
  );

  // Out of scope for #32: no new bot / workflow-engine / orchestrator machinery.
  assert.ok(
    containsText(
      text,
      "この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management workflow engine、または新しい orchestrator を要求しません。",
    ),
    `${label}: missing no-new-machinery statement`,
  );
}

test("core policy defines the Issue closure and Acceptance Criteria completion protocol (#32)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assertIssueClosureCompletionProtocol(core, "policy/core.md");

  // Stays provider-neutral, like the rest of the Kernel.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("generated consumer AGENTS.md reflects the Issue closure completion protocol", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assertIssueClosureCompletionProtocol(agents, "test/fixtures/consumer/AGENTS.md");
});
