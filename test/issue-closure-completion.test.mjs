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

// Shared assertion set for the minimum Kernel safety boundary of the Issue
// closure and Acceptance Criteria completion protocol (#32, narrowed by
// #114). Run against both the canonical policy/core.md and the generated
// consumer AGENTS.md, since composeAgents() embeds core.md verbatim and this
// boundary must not silently drift between the two.
function assertIssueClosureKernelBoundary(text, label) {
  assert.ok(
    text.includes("### Issue closure and Acceptance Criteria completion"),
    `${label}: missing heading`,
  );

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

  // #114: act-shaped closure trigger + dual-context MUST-load one-hop pointer.
  assert.ok(
    containsText(
      text,
      "canonical Issue を completed として close しようとする場合、または close 手順の適用要否が判断つかない場合は、`.ai-dev-foundation/skills/task-closure.md` を **MUST load** します。",
    ),
    `${label}: missing act-shaped MUST-load trigger`,
  );
  assert.ok(
    containsText(
      text,
      "判断がつかない場合を「適用不要」と解釈して silent skip してはいけません。",
    ),
    `${label}: missing fail-closed uncertainty rule`,
  );
  assert.ok(
    containsText(
      text,
      "この path は consumer context のものです。Foundation リポジトリ自身の Task では、同じ canonical source である `skills/task-closure.md` を同じ条件で MUST load します。",
    ),
    `${label}: missing Foundation-self path pointer`,
  );

  // Fail-closed AC boundary: unmet/unknown Acceptance Criteria block close,
  // and Acceptance Criteria are never fabricated to allow a close.
  assert.ok(
    containsText(
      text,
      "evidence 不足または未達で判断できない Acceptance Criteria が 1 件でも残る場合、その項目を勝手に check せず、Issue も close しません。",
    ),
    `${label}: missing unmet/unknown AC no-check/no-close statement`,
  );
  assert.ok(
    containsText(
      text,
      "Issue に Acceptance Criteria が存在しない場合、close のために新たな Acceptance Criteria を捏造しません。",
    ),
    `${label}: missing no-fabricating-AC statement`,
  );

  // Issue close execution authority separation mirrors Merge readiness and
  // merge authority: no authority, no close — leave evidence-supported
  // completion state on the record and stop instead.
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
      "agent は Issue 本文の編集や close を実行せず、evidence-supported な completion state を記録した上で停止し、authority escalation / handoff します。",
    ),
    `${label}: missing no-authority stop-and-handoff statement`,
  );

  // Constraint from Issue #32: auto-close keywords must not become the standard
  // path to a pre-AC-check close (full prohibition of auto-close is out of scope).
  assert.ok(
    containsText(
      text,
      'auto-close keyword（例: PR 本文の "Closes #N"）によって Acceptance Criteria 確認前に Issue が自動 close される運用を、標準運用にしません。',
    ),
    `${label}: missing auto-close-not-standard statement`,
  );
}

test("core policy keeps the minimum Issue closure Kernel safety boundary (#32, #114)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assertIssueClosureKernelBoundary(core, "policy/core.md");

  // Stays provider-neutral, like the rest of the Kernel.
  assert.doesNotMatch(
    core,
    /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i,
  );
});

test("generated consumer AGENTS.md reflects the Issue closure Kernel safety boundary", async () => {
  const agents = await readFile(
    path.join(root, "test", "fixtures", "consumer", "AGENTS.md"),
    "utf8",
  );

  assertIssueClosureKernelBoundary(agents, "test/fixtures/consumer/AGENTS.md");
});

// #114: the 5-step procedure detail, recommended sequence, close-authority-absent
// handoff detail, and no-new-machinery detail moved to skills/task-closure.md
// and must not remain duplicated in the Kernel.
test("core policy delegates the 5-step closure procedure detail to skills/task-closure.md (#114)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  for (const movedDetail of [
    "close しようとする session 自身の記憶や過去の長文 handoff をそのまま正としてはいけません。",
    "「実装が完了したように見える」という印象だけでは充足の根拠にしません。",
    "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    "final SHA、verification 結果、review evidence",
    "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    "GitHub Issue checkbox 専用 bot、generalized project-management workflow engine、または新しい orchestrator を要求しません。",
    "手順 5 の completion comment として明示的に残した上で停止し",
  ]) {
    assert.ok(
      !containsText(core, movedDetail),
      `policy/core.md must no longer contain moved closure procedure detail: ${movedDetail}`,
    );
  }

  assert.ok(
    containsText(
      core,
      "5-step closure procedure（canonical context の再取得手順、Acceptance Criteria evidence 照合手順、checkbox 更新手順、未達・判断不能時の procedure detail、completion comment の field / record locator detail）、推奨する sequence、close authority が無い場合の completion-comment / handoff procedure detail、および closure-specific no-new-machinery detail の canonical source は、consumer context では `.ai-dev-foundation/skills/task-closure.md`、Foundation リポジトリ自身の Task では `skills/task-closure.md` です。",
    ),
  );
});

test("skills/task-closure.md owns the 5-step closure procedure detail (#114)", async () => {
  const taskClosure = await readFile(
    path.join(root, "skills", "task-closure.md"),
    "utf8",
  );

  assert.ok(taskClosure.includes("## Closure procedure"));
  assert.ok(taskClosure.includes("## Close authority が無い場合"));
  assert.ok(taskClosure.includes("## No new machinery"));

  assert.ok(containsText(taskClosure, "canonical context の再取得"));
  assert.ok(
    containsText(
      taskClosure,
      "close しようとする session 自身の記憶や過去の長文 handoff をそのまま正としてはいけません。",
    ),
  );
  assert.ok(containsText(taskClosure, "Acceptance Criteria evidence 照合"));
  assert.ok(
    containsText(
      taskClosure,
      "「実装が完了したように見える」という印象だけでは充足の根拠にしません。",
    ),
  );
  assert.ok(containsText(taskClosure, "checkbox 更新"));
  assert.ok(
    containsText(
      taskClosure,
      "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    ),
  );
  assert.ok(containsText(taskClosure, "未達・判断不能な項目の扱い"));
  assert.ok(containsText(taskClosure, "completion comment"));
  assert.ok(
    containsText(
      taskClosure,
      "final SHA、verification 結果、review evidence（Review Protocol の Acquisition & Validity Contract に従う record / result locator を含む）、および未解決事項を、Issue 上の completion comment として記録します。",
    ),
  );
  assert.ok(
    containsText(
      taskClosure,
      "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    ),
  );
  assert.ok(
    containsText(
      taskClosure,
      "agent は Issue 本文の編集や close を実行せず、どの Acceptance Criteria がどの evidence で満たされているか（または未達か）を、手順 5 の completion comment として明示的に残した上で停止し、authority escalation / handoff します。",
    ),
  );
  assert.ok(
    containsText(
      taskClosure,
      "この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management workflow engine、または新しい orchestrator を要求しません。",
    ),
  );

  assert.doesNotMatch(
    taskClosure,
    /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i,
  );
});

// #114 (#112 lesson): the Kernel MUST-load pointer must name both the
// consumer-distributed path and the Foundation-repository-self path, so a
// Task running inside the Foundation repository itself can resolve it.
test("core policy's task-closure pointer resolves in both consumer and Foundation-self context (#114)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  const consumerOnlyPointerCount = (
    core.match(/`\.ai-dev-foundation\/skills\/task-closure\.md`/g) ?? []
  ).length;
  const selfContextPointerCount = (
    core.match(/`skills\/task-closure\.md`/g) ?? []
  ).length;
  assert.ok(
    consumerOnlyPointerCount > 0,
    "sanity check: consumer-context pointer must exist",
  );
  assert.ok(
    selfContextPointerCount >= consumerOnlyPointerCount,
    `every consumer-context task-closure.md pointer in core.md must be paired with a Foundation-self-context pointer (consumer-only refs: ${consumerOnlyPointerCount}, self-context refs: ${selfContextPointerCount})`,
  );
});

// #114 (#112/#113 lesson): the Kernel must not verbatim-duplicate the
// procedural detail canonically owned by skills/task-closure.md, and the
// skill must not verbatim-duplicate the Kernel's own minimum safety boundary
// sentences it references.
test("policy/core.md and skills/task-closure.md do not verbatim-duplicate each other's canonical content (#114)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const taskClosure = await readFile(
    path.join(root, "skills", "task-closure.md"),
    "utf8",
  );

  for (const skillOwnedDetail of [
    "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
  ]) {
    assert.ok(
      containsText(taskClosure, skillOwnedDetail),
      `sanity check: detail must actually be in skills/task-closure.md: ${skillOwnedDetail}`,
    );
    assert.ok(
      !containsText(core, skillOwnedDetail),
      `policy/core.md must not verbatim-duplicate skill-owned procedural detail: ${skillOwnedDetail}`,
    );
  }

  for (const kernelSentence of [
    "evidence 不足または未達で判断できない Acceptance Criteria が 1 件でも残る場合、その項目を勝手に check せず、Issue も close しません。",
    "Issue に Acceptance Criteria が存在しない場合、close のために新たな Acceptance Criteria を捏造しません。",
    "Issue close の execution authority は、Merge readiness and merge authority と同じ分離に従います。",
    'auto-close keyword（例: PR 本文の "Closes #N"）によって Acceptance Criteria 確認前に Issue が自動 close される運用を、標準運用にしません。',
  ]) {
    assert.ok(
      containsText(core, kernelSentence),
      `sanity check: sentence must actually be in core.md: ${kernelSentence}`,
    );
    assert.ok(
      !containsText(taskClosure, kernelSentence),
      `skills/task-closure.md must not verbatim-duplicate this Kernel sentence, only reference policy/core.md: ${kernelSentence}`,
    );
  }
});

test("materialized consumer skill bundle includes task-closure.md (#114)", async () => {
  const materialized = await readFile(
    path.join(
      root,
      "test",
      "fixtures",
      "consumer",
      ".ai-dev-foundation",
      "skills",
      "task-closure.md",
    ),
    "utf8",
  );
  const source = await readFile(
    path.join(root, "skills", "task-closure.md"),
    "utf8",
  );
  assert.equal(materialized, source);
});

// #114: the moved procedural detail must actually leave the generated
// consumer artifact, not just gain new Kernel headings alongside stale
// leftovers from a broken sync.
test("generated consumer AGENTS.md does not carry the moved closure procedural detail (#114)", async () => {
  const agents = await readFile(
    path.join(root, "test", "fixtures", "consumer", "AGENTS.md"),
    "utf8",
  );

  assert.ok(
    !containsText(
      agents,
      "checkbox 更新は見た目上の cleanup ではなく、Task Contract completion evidence の一部として扱います。",
    ),
  );
  assert.ok(
    !containsText(
      agents,
      "merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 -> completion comment -> Issue close",
    ),
  );
  assert.ok(
    !containsText(
      agents,
      "この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management workflow engine、または新しい orchestrator を要求しません。",
    ),
  );
});

// #114: an ordinary non-closure task must not be required to load
// task-closure.md or duplicate its content — mirrors the #112 safety
// scenario 6 pattern for the Review lane.
test("review skills do not need to load or duplicate skills/task-closure.md (#114 safety scenario 1)", async () => {
  const reviewCode = await readFile(
    path.join(root, "skills", "review-code.md"),
    "utf8",
  );
  const reviewDoc = await readFile(
    path.join(root, "skills", "review-doc.md"),
    "utf8",
  );
  const foundationChange = await readFile(
    path.join(root, "skills", "foundation-change.md"),
    "utf8",
  );

  for (const [name, skill] of [
    ["review-code.md", reviewCode],
    ["review-doc.md", reviewDoc],
    ["foundation-change.md", foundationChange],
  ]) {
    assert.ok(
      !skill.includes("task-closure"),
      `${name} must not reference skills/task-closure.md; unrelated Tasks must not be forced into the closure lane`,
    );
  }
});
