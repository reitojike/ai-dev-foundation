import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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

test("core policy defines the Foundation Change Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("## Foundation Change Protocol"));
  assert.ok(
    containsText(core, "Observation は、そのままでは Issue や mandatory rule へ自動的に昇格しません。"),
  );

  for (const reason of [
    "既存の mandatory / manual step を置き換える",
    "material defect を deterministically 防止する",
    "demonstrated recurring / escaped failure へ対処する",
  ]) {
    assert.ok(core.includes(reason), `missing Foundation Change justification: ${reason}`);
  }

  for (const field of [
    "Problem",
    "Evidence",
    "Proposed Change",
    "Expected Effect",
    "Trade-off",
    "Scope",
    "Success Criterion",
  ]) {
    assert.ok(core.includes(field), `Change Proposal must express: ${field}`);
  }

  assert.ok(
    containsText(
      core,
      "単発の friction、style、prompt nicety、効率改善のみを理由に、自動的に mandatory 化しません。",
    ),
  );

  // Foundation Change Protocol stays provider-neutral, like the rest of the Kernel.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("core policy separates merge-readiness from merge execution authority", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  assert.ok(core.includes("### Merge readiness and merge authority"));
  assert.ok(
    containsText(
      core,
      "review completion（Resolution Contract の完了を含む）が成立した状態を **merge-ready** と呼びます。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "merge execution authority は、Review Protocol とは別の contract / context として扱います。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "current Task、Execution Envelope、または explicit な authority が merge の実行を許可している場合に限り、agent は merge を実行してよいです。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "merge authority が明示されていない場合、または別 authority の承認が必要な場合、agent は merge を実行せず、merge-ready の状態を報告した上で停止し、authority escalation / handoff します。",
    ),
  );

  // This is a stop/report gate, not a new mandatory Human diff-approval or
  // GitHub-required-approval-count rule, and it stays provider-neutral.
  assert.ok(
    containsText(
      core,
      "この分離は、すべての PR で Human diff approval を mandatory にすることを意味しません。GitHub の required approval 数を増やす rule でもありません。provider や model 固有の rule にもしません。",
    ),
  );
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // review-code.md's own merge step must defer execution to the canonical
  // authority contract instead of treating review completion as license to merge.
  assert.ok(
    containsText(
      reviewCode,
      "merge の実行は `policy/core.md` の Merge readiness and merge authority に従い、current Task / Execution Envelope / explicit authority が merge execution を許可している場合のみ行います。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "authority が明示されていない、または別 authority の承認が必要な場合は merge を実行せず、merge-ready の状態を報告して停止し、authority escalation / handoff します。",
    ),
  );

  // Regression proof (converged CodeRabbit + independent Claude Discovery finding
  // on this PR): Step 13 must not contain an unqualified "...時点で merge します"
  // completion sentence a skimming reader/agent could act on as an unconditional
  // merge instruction. Both completion branches must read as a merge-ready
  // determination instead.
  assert.doesNotMatch(
    stripWhitespace(reviewCode),
    /時点でmergeします/,
    "review-code.md Step 13 must not phrase review completion as an unqualified merge instruction",
  );
  assert.ok(
    containsText(
      reviewCode,
      "required review 数の valid discovery と Resolution（手順 6）が完了した時点で merge-ready と判定します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "Closure Acquisition & Validity・Closure Resolution が完了した時点で merge-ready と判定します。",
    ),
  );
});

test("core policy defines a minimal Observation handling entry point (#20)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("### Observation trigger"));
  assert.ok(core.includes("### Observation classification"));
  assert.ok(core.includes("### Observation recording"));
  assert.ok(core.includes("### Task closure と Observation"));
  assert.ok(core.includes("### Observation から Change Proposal への昇格"));

  // Observation trigger stays event-driven: five concrete conditions, not a
  // blanket per-Task retrospective requirement.
  for (const trigger of [
    "Foundation の rule / profile / tooling に従っても material correctness",
    "Task 完了のため Foundation の迂回・上書き・補完 workaround が必要になる",
    "Foundation が定義していない",
    "provider / runtime の実挙動が、Task で依拠した前提と食い違う",
    "同一 root cause と思われる friction / workaround を以前にも観測している",
  ]) {
    assert.ok(core.includes(trigger), `missing Observation trigger: ${trigger}`);
  }
  assert.ok(
    containsText(
      core,
      "これらが発火しない限り、Task ごとに Foundation 改善点を探索する追加工程は要求しません。",
    ),
  );

  // Minimal four-way classification, judged by root cause/ownership rather
  // than severity.
  for (const label of [
    "`consumer-local`",
    "`provider/runtime`",
    "`Foundation candidate`",
    "`canonical defect candidate`",
  ]) {
    assert.ok(core.includes(label), `missing Observation classification: ${label}`);
  }
  assert.ok(containsText(core, "症状の重大度ではなく root cause / ownership を軸に"));

  // Observation is not a work item and does not auto-create a Foundation
  // Issue; it is recorded on the originating consumer Task's canonical Issue.
  assert.ok(
    containsText(core, "Observation trigger の発火は、自動的に Foundation Issue を作りません。"),
  );
  assert.ok(containsText(core, "Observation は work item ではありません。"));

  // Recording is a mandatory obligation (not merely a recordable capability)
  // when the future-reuse-value condition is met — CodeRabbit/Codex Discovery
  // finding on PR #21: "記録できることを要求します" read as capability-only and
  // let required evidence be omitted at Task closure.
  assert.ok(
    containsText(
      core,
      "将来の Foundation 判断へ再利用する価値がある場合、発生した consumer Task の canonical Issue へ、少なくとも次を短く記録します。",
    ),
  );
  for (const field of [
    "Observed / evidence locator",
    "Classification",
    "Impact",
    "Local handling",
    "Foundation action",
    "Promotion signal",
  ]) {
    assert.ok(core.includes(field), `Observation record must express: ${field}`);
  }

  // Out of Scope for #20: no ledger/bot/dashboard/auto-issue/periodic-audit
  // machinery, and no new tooling files were added to implement it.
  assert.ok(
    containsText(
      core,
      "専用の ledger / database / schema、GitHub label 体系、bot / collector / dashboard / statistics、自動 Issue 生成、定期棚卸しの mandatory 化は Observation handling の一部にしません。",
    ),
  );
  // Codex Discovery finding on PR #21: an exact directory-equality check
  // would fail on any unrelated future tooling addition. Assert the absence
  // of the specifically prohibited machinery instead.
  const toolingFiles = await readdir(path.join(root, "tooling"));
  const observationMachineryPattern = /ledger|dashboard|collector|-?bot-?|statistics/i;
  assert.deepEqual(
    toolingFiles.filter((file) => observationMachineryPattern.test(file)),
    [],
    "Observation handling must not add new ledger/bot/dashboard/collector tooling",
  );

  // Task closure collects only triggers that already fired; it is not a new
  // improvement-discovery step. It also does not force recording of
  // observations the recording contract exempts (Codex Discovery finding on
  // PR #21: the closure gate must not conflict with the recording exemption).
  assert.ok(
    containsText(
      core,
      "Task closure は新しい Foundation 改善点を探索する工程ではありません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "Task 中に Observation trigger が発火していた場合、未分類のもの、または上記の記録義務があるのに未記録のものだけを回収してから Task を完了します。",
    ),
  );
  assert.ok(
    containsText(core, "記録義務の対象にしない軽微な事象は、この回収の対象にしません。"),
  );

  // Observation classification supplements, and does not replace or relax,
  // the existing three Foundation Change justification conditions.
  assert.ok(
    containsText(
      core,
      "Observation classification は、本節の 3 つの Foundation Change 正当化条件を置き換えず、緩和しません。",
    ),
  );
  for (const signal of [
    "Foundation 自身の material defect が実証された",
    "material defect を deterministically 防止できる",
    "同一 root cause が recurring / escaped failure になった",
    "correctness のための mandatory manual ritual が定着した",
    "consumer-local workaround では canonical semantics の fork が必要に",
  ]) {
    assert.ok(core.includes(signal), `missing Observation promotion signal: ${signal}`);
  }

  // Claude Discovery finding on PR #21: the pre-existing justification
  // conditions and Change Proposal fields are general Foundation Change
  // Protocol content, not Task-closure-specific, and must not nest under the
  // "### Task closure と Observation" heading (which "### Observation から
  // Change Proposal への昇格" still refers back to as "本節の 3 つの...
  // 正当化条件").
  const taskClosureHeadingIndex = core.indexOf("### Task closure と Observation");
  const justificationHeadingIndex = core.indexOf("### Foundation Change の正当化条件");
  const justificationReasonIndex = core.indexOf("既存の mandatory / manual step を置き換える");
  const promotionHeadingIndex = core.indexOf("### Observation から Change Proposal への昇格");
  assert.ok(taskClosureHeadingIndex !== -1 && justificationHeadingIndex !== -1);
  assert.ok(
    taskClosureHeadingIndex < justificationHeadingIndex &&
      justificationHeadingIndex < justificationReasonIndex &&
      justificationReasonIndex < promotionHeadingIndex,
    "the 3 justification conditions must sit under their own heading, between Task closure and Observation promotion, not nested inside either",
  );

  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("generated consumer AGENTS.md reflects the Observation handling contract", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assert.ok(agents.includes("### Observation trigger"));
  assert.ok(agents.includes("### Observation classification"));
  assert.ok(agents.includes("### Observation recording"));
  assert.ok(agents.includes("### Task closure と Observation"));
  assert.ok(agents.includes("### Foundation Change の正当化条件"));
  assert.ok(agents.includes("### Observation から Change Proposal への昇格"));
});
