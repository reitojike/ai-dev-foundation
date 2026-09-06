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

  // #112: Change Proposal field definitions are canonically owned by
  // skills/foundation-change.md, not restated in core.md.
  const foundationChange = await readFile(path.join(root, "skills", "foundation-change.md"), "utf8");
  for (const field of [
    "Problem",
    "Evidence",
    "Proposed Change",
    "Expected Effect",
    "Trade-off",
    "Scope",
    "Success Criterion",
  ]) {
    assert.ok(foundationChange.includes(field), `Change Proposal must express: ${field}`);
  }

  assert.ok(
    containsText(
      core,
      "単発の friction、style、prompt nicety、効率改善のみを理由に、自動的に mandatory 化しません",
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

  // Regression proof: Step 13 must not contain an unqualified "...時点で merge します"
  // completion sentence a skimming reader/agent could act on as an unconditional
  // merge instruction. Both completion branches must read as a merge-ready
  // determination instead.
  assert.doesNotMatch(
    stripWhitespace(reviewCode),
    /時点でmergeします/,
    "review-code.md Step 13 must not phrase review completion as an unqualified merge instruction",
  );
  // Both branches must read as a semantic precondition being satisfied, not as
  // a merge. Since Issue #76 the declaration additionally requires the
  // deterministic fence to pass; the fence's own behavior is owned by
  // test/merge-ready-fence-lib.test.mjs.
  assert.ok(
    containsText(
      reviewCode,
      "required review 数の valid discovery と Resolution（手順 6）が完了した時点で semantic な条件が揃います。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "Closure Acquisition & Validity・Closure Resolution の完了が必要です。",
    ),
  );
});

test("core policy keeps the minimum Foundation Change Kernel safety boundary (#20, #112)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("### Observation trigger"));
  assert.ok(core.includes("### Observation handling — canonical ownership delegation"));
  assert.ok(core.includes("### Task closure と Observation"));
  assert.ok(core.includes("### Foundation Change の正当化条件"));

  // #112: classification/recording/promotion procedural detail is no longer
  // duplicated as its own heading in the Kernel; it is delegated to
  // skills/foundation-change.md.
  assert.ok(!core.includes("### Observation classification"));
  assert.ok(!core.includes("### Observation recording"));
  assert.ok(!core.includes("### Observation から Change Proposal への昇格"));

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

  // #112: trigger 発火時、または発火したかどうか不明な場合は
  // skills/foundation-change.md を MUST load する fail-closed one-hop pointer.
  assert.ok(
    containsText(
      core,
      "Observation trigger が発火した場合、または発火したかどうか判断がつかない場合は、`.ai-dev-foundation/skills/foundation-change.md` を **MUST load** します。",
    ),
  );
  assert.ok(
    containsText(core, "判断がつかない場合を「trigger なし」と解釈して silent skip してはいけません。"),
  );

  // #113 Codex P2: the MUST-load pointer named only the consumer-distributed
  // path, so a Task running inside the Foundation repository itself could
  // not resolve it to the canonical skills/foundation-change.md. Both
  // contexts must be named explicitly, without a generalized resolver.
  assert.ok(
    containsText(
      core,
      "この path は consumer context のものです。Foundation リポジトリ自身の Task では、同じ canonical source である `skills/foundation-change.md` を同じ条件で MUST load します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "consumer context では `.ai-dev-foundation/skills/foundation-change.md`、Foundation リポジトリ自身の Task では `skills/foundation-change.md` です。",
    ),
  );

  // #113 Codex P2 follow-up: a second consumer-only canonical-source
  // reference survived in the Foundation Change justification section
  // (Change Proposal field / promotion signal detail) after the first
  // MUST-load pointer fix. It must also branch by context.
  assert.ok(
    containsText(
      core,
      "canonical source は、consumer context では `.ai-dev-foundation/skills/foundation-change.md`、Foundation リポジトリ自身の Task では `skills/foundation-change.md` です。",
    ),
  );

  // Repo-wide regression guard: every reference to the consumer-distributed
  // `.ai-dev-foundation/skills/foundation-change.md` path in core.md must be
  // paired with the Foundation-repository-self path `skills/foundation-change.md`
  // nearby, so a future addition of a new consumer-only reference doesn't
  // silently reintroduce the same unreachable-pointer defect.
  const consumerOnlyPointerCount = (core.match(/`\.ai-dev-foundation\/skills\/foundation-change\.md`/g) ?? [])
    .length;
  // This pattern only matches a bare `skills/foundation-change.md` (backtick
  // immediately before "skills/"), so it does not also match inside the
  // consumer path above (which has a backtick before ".ai-dev-foundation/").
  const selfContextPointerCount = (core.match(/`skills\/foundation-change\.md`/g) ?? []).length;
  assert.ok(
    selfContextPointerCount >= consumerOnlyPointerCount,
    `every consumer-context foundation-change.md pointer in core.md must be paired with a Foundation-self-context pointer (consumer-only refs: ${consumerOnlyPointerCount}, self-context refs: ${selfContextPointerCount})`,
  );

  // Observation is not a work item and does not auto-create a Foundation
  // Issue; it is recorded on the originating consumer Task's canonical Issue.
  assert.ok(
    containsText(core, "Observation trigger の発火は、自動的に Foundation Issue を作りません。"),
  );
  assert.ok(containsText(core, "Observation は work item ではありません。"));

  // Out of Scope for #20: no ledger/bot/dashboard/auto-issue/periodic-audit
  // machinery stays a Kernel-retained anti-overbuilding invariant even after
  // the recording procedure itself moved to the skill (#112).
  assert.ok(
    containsText(
      core,
      "専用の ledger / database / schema、GitHub label 体系、bot / collector / dashboard / statistics、自動 Issue 生成、定期棚卸しの mandatory 化は Observation handling の一部にしません。",
    ),
  );

  // Task closure collects only triggers that already fired; it is not a new
  // improvement-discovery step.
  assert.ok(
    containsText(
      core,
      "Task closure は新しい Foundation 改善点を探索する工程ではありません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "Task 中に Observation trigger が発火していた場合、未分類のものは必ず classification を完了します。",
    ),
  );

  // The recording exemption must scope only to
  // the recording step, not to classification itself — otherwise an agent
  // could rationalize a still-unclassified trigger as "lightweight" and skip
  // classifying it entirely, contradicting the unconditional classification
  // requirement in Observation trigger/classification.
  assert.ok(
    containsText(
      core,
      "記録義務の対象にしない軽微な事象について省略できるのは記録だけであり、classification の完了は省略しません。",
    ),
  );

  // The pre-existing justification conditions are general Foundation Change
  // Protocol content, not Task-closure-specific, and must not nest under the
  // "### Task closure と Observation" heading.
  const taskClosureHeadingIndex = core.indexOf("### Task closure と Observation");
  const justificationHeadingIndex = core.indexOf("### Foundation Change の正当化条件");
  const justificationReasonIndex = core.indexOf("既存の mandatory / manual step を置き換える");
  assert.ok(taskClosureHeadingIndex !== -1 && justificationHeadingIndex !== -1);
  assert.ok(
    taskClosureHeadingIndex < justificationHeadingIndex &&
      justificationHeadingIndex < justificationReasonIndex,
    "the 3 justification conditions must sit under their own heading, after Task closure, not nested inside it",
  );

  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("skills/foundation-change.md owns Observation classification/recording/promotion detail (#112)", async () => {
  const foundationChange = await readFile(path.join(root, "skills", "foundation-change.md"), "utf8");

  assert.ok(foundationChange.includes("## Observation classification"));
  assert.ok(foundationChange.includes("## Observation recording"));
  assert.ok(foundationChange.includes("## Change Proposal"));
  assert.ok(foundationChange.includes("## Observation から Change Proposal への昇格"));

  // Minimal four-way classification, judged by root cause/ownership rather
  // than severity.
  for (const label of [
    "`consumer-local`",
    "`provider/runtime`",
    "`Foundation candidate`",
    "`canonical defect candidate`",
  ]) {
    assert.ok(foundationChange.includes(label), `missing Observation classification: ${label}`);
  }
  assert.ok(containsText(foundationChange, "症状の重大度ではなく root cause / ownership を軸に"));

  // `Foundation candidate` is not exclusive
  // to unconfirmed ownership — a Foundation-owned shared improvement
  // candidate that is not a confirmed defect belongs here too.
  // `canonical defect candidate` is limited strictly to confirmed defective
  // behavior; a correctly-functioning manual step that could be automated
  // does not qualify (Issue #20's original semantic contract).
  assert.ok(
    containsText(
      foundationChange,
      "Foundation-owned だと分かっていても、確認された defect ではない改善余地を含む",
    ),
  );
  assert.ok(
    containsText(
      foundationChange,
      "正しく機能している manual step を自動化・簡略化できるという改善余地だけでは、この分類に含めない",
    ),
  );

  // Recording is a mandatory obligation (not merely a recordable capability)
  // when the future-reuse-value condition is met: "記録できることを要求します"
  // reads as capability-only and lets required evidence be omitted at Task
  // closure.
  assert.ok(
    containsText(
      foundationChange,
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
    assert.ok(foundationChange.includes(field), `Observation record must express: ${field}`);
  }

  // #113 Claude review: the ledger/dashboard prohibition is a Kernel
  // minimum safety boundary sentence; the skill must reference it, not
  // restate it verbatim (that would violate the delegation's own
  // no-duplication condition in policy/core.md's 責務の分離).
  assert.ok(
    containsText(
      foundationChange,
      "ledger / database / schema、GitHub label 体系、bot / collector / dashboard / statistics、自動 Issue 生成、定期棚卸しを Observation handling の一部にしないことは `policy/core.md` の minimum safety boundary です。本 skill では複製しません。",
    ),
  );

  // Observation classification supplements, and does not replace or relax,
  // the existing three Foundation Change justification conditions.
  assert.ok(
    containsText(
      foundationChange,
      "Observation classification は、`policy/core.md` の 3 つの Foundation Change 正当化条件を置き換えず、緩和しません。",
    ),
  );
  for (const signal of [
    "Foundation 自身の material defect が実証された",
    "material defect を deterministically 防止できる",
    "同一 root cause が recurring / escaped failure になった",
    "correctness のための mandatory manual ritual が定着した",
    "consumer-local workaround では canonical semantics の fork が必要に",
  ]) {
    assert.ok(foundationChange.includes(signal), `missing Observation promotion signal: ${signal}`);
  }

  assert.doesNotMatch(foundationChange, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("generated consumer AGENTS.md reflects the Observation handling contract", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assert.ok(agents.includes("### Observation trigger"));
  assert.ok(agents.includes("### Observation handling — canonical ownership delegation"));
  assert.ok(agents.includes("### Task closure と Observation"));
  assert.ok(agents.includes("### Foundation Change の正当化条件"));
});

test("materialized consumer skill bundle includes foundation-change.md (#112)", async () => {
  const materialized = await readFile(
    path.join(root, "test", "fixtures", "consumer", ".ai-dev-foundation", "skills", "foundation-change.md"),
    "utf8",
  );
  const source = await readFile(path.join(root, "skills", "foundation-change.md"), "utf8");
  assert.equal(materialized, source);
});

// #112: the moved procedural headings must actually leave the generated
// consumer artifact, not just gain new Kernel headings alongside stale
// leftovers from a broken sync.
test("generated consumer AGENTS.md does not carry the moved Observation procedural detail (#112)", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assert.ok(!agents.includes("### Observation classification"));
  assert.ok(!agents.includes("### Observation recording"));
  assert.ok(!agents.includes("### Observation から Change Proposal への昇格"));
});

// #112: the widened "## 責務の分離" delegation clause must stay a closed,
// bounded enumeration of exactly the two named cases (review-execution-only,
// and trigger-fired-or-uncertain), not an open-ended class an agent could
// read as license to delegate arbitrary rules to arbitrary skills.
test("core policy's widened canonical ownership delegation clause stays a closed, bounded enumeration (#112)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(
    containsText(
      core,
      "policy は、次の二つの場合に限り、conditional にのみ必要となる必須事項・禁止事項について、その canonical ownership を Foundation-owned な skill へ明示的に委譲してよいです。",
    ),
  );
  assert.ok(containsText(core, "review 実行 agent のみが必要とする場合"));
  assert.ok(
    containsText(core, "特定の trigger 発火時（および発火したかどうか不明な場合）にのみ必要となる場合"),
  );

  for (const condition of [
    "policy 自身が、委譲先の skill を one-hop pointer として名指しする",
    "同じ規範的なルールを policy と skill の両方に重複して記述しない",
    "この委譲は個別に列挙した対象にのみ適用し、任意のルールを一般的に skill へ移してよいことを意味しない",
    "generalized loader / registry / routing framework / DSL を新設しない",
  ]) {
    assert.ok(containsText(core, condition), `missing delegation condition: ${condition}`);
  }

  // The enumeration must not carry a trailing "等" (etc.) or other
  // open-ended qualifier right after the two named cases — that would
  // contradict "個別に列挙した対象にのみ適用".
  const delegationIntroIndex = core.indexOf("policy は、次の二つの場合に限り");
  assert.ok(delegationIntroIndex !== -1);
  const delegationClauseSlice = core.slice(delegationIntroIndex, delegationIntroIndex + 400);
  assert.doesNotMatch(
    delegationClauseSlice,
    /場合等/,
    "the two-case enumeration must be closed, not suffixed with an open-ended 等",
  );
});

// #112 Safety scenario 6: Review Protocol tasks must be able to satisfy the
// Foundation Change justification conditions from the Kernel alone. They
// must not need to load skills/foundation-change.md, and must not duplicate
// or depend on its content.
test("review skills do not need to load or duplicate skills/foundation-change.md (#112 safety scenario 6)", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  for (const [name, skill] of [
    ["review-code.md", reviewCode],
    ["review-doc.md", reviewDoc],
  ]) {
    assert.ok(
      !skill.includes("foundation-change"),
      `${name} must not reference skills/foundation-change.md; the Review lane gets the justification conditions from the Kernel alone`,
    );
    assert.ok(
      !skill.includes("Foundation Change の正当化条件"),
      `${name} must not duplicate the Foundation Change justification conditions`,
    );
  }
});

// #113 Claude review: skills/foundation-change.md's own delegation rule
// (policy/core.md's 責務の分離, "同じ規範的なルールを policy と skill の
// 両方に重複して記述しない") must not be violated by the skill it applies
// to. Lock the specific Kernel minimum-safety-boundary sentences that were
// found verbatim-duplicated in skills/foundation-change.md, so a future
// edit can't silently reintroduce the duplication.
test("skills/foundation-change.md does not verbatim-duplicate Kernel minimum safety boundary sentences (#113)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const foundationChange = await readFile(path.join(root, "skills", "foundation-change.md"), "utf8");

  for (const kernelSentence of [
    "Observation trigger の発火は、自動的に Foundation Issue を作りません。",
    "Observation は work item ではありません。",
    "専用の ledger / database / schema、GitHub label 体系、bot / collector /",
    "記録義務の対象にしない軽微な事象について省略できるのは記録だけであり、classification の完了は省略しません。",
    "単発の friction、style、prompt nicety、効率改善のみを理由に、自動的に",
    "change class や review 強度は、固定の provider 名へ結びつけません。",
  ]) {
    assert.ok(
      containsText(core, kernelSentence),
      `sanity check: sentence must actually be in core.md: ${kernelSentence}`,
    );
    assert.ok(
      !containsText(foundationChange, kernelSentence),
      `skills/foundation-change.md must not verbatim-duplicate this Kernel sentence, only reference policy/core.md: ${kernelSentence}`,
    );
  }
});
