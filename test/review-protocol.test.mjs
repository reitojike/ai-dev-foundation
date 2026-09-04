import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripWhitespace(text) {
  return text.replace(/\s+/g, "");
}

// Ignores all whitespace (not just line-wrap points) on both sides, so prose
// assertions survive any content-preserving Markdown reflow.
function containsText(haystack, needle) {
  return stripWhitespace(haystack).includes(stripWhitespace(needle));
}

// Counts non-overlapping occurrences, whitespace-agnostic. Used where the same
// precondition-recheck clause must appear once per applicable branch.
function countOccurrences(haystack, needle) {
  const hay = stripWhitespace(haystack);
  const need = stripWhitespace(needle);
  if (!need) return 0;
  let count = 0;
  let index = 0;
  while ((index = hay.indexOf(need, index)) !== -1) {
    count += 1;
    index += need.length;
  }
  return count;
}

test("core policy defines the provider-neutral Review Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  for (const heading of [
    "## Review Protocol",
    "### Artifact classification",
    "### Review contracts",
    "#### Selection Contract",
    "#### Execution Contract",
    "#### Acquisition & Validity Contract",
    "#### Resolution Contract",
    "### Review Adapter boundary",
    "### Failure / retry",
    "### Review stopping rules",
  ]) {
    assert.ok(core.includes(heading), `missing Review Protocol heading: ${heading}`);
  }

  // Artifact classification
  for (const artifactClass of ["**Executable**", "**Normative**", "**Informational**"]) {
    assert.ok(core.includes(artifactClass), `missing artifact class: ${artifactClass}`);
  }

  // Principle A (Contract applicability is stage-independent): the 4 Contracts
  // apply to closure review runs too, not just discovery, and a Selection
  // Contract's required review count gates closure the same as discovery.
  assert.ok(
    containsText(
      core,
      "各 Contract は discovery だけでなく、同じ Contract を使って起動する closure review run にも適用されます。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "closure target も Selection Contract で expected target として確定し、Execution Contract に従って起動します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "Selection Contract が required review 数を定めた review stage では、discovery か closure かを問わず、その required 数の completed かつ valid な run が揃うまで triage / Resolution / merge / review completion へ進みません。",
    ),
  );

  // Resolve discovery findings before merge: the discovery
  // Resolution gate is stage-independent — accepted-fix paths don't drop it,
  // multiple discovery stages (e.g. 2nd full discovery) each need their own
  // Resolution complete, and completion order vs. closure isn't mandated.
  assert.ok(
    containsText(
      core,
      "Selection Contract で required とした review stage（discovery、2nd full discovery を含む）の finding は、その stage で accepted fix があったかどうかに関係なく、Resolution Contract に従って Resolution が完了するまで merge / review completion へ進みません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "同じ review flow で複数の discovery stage を行った場合は、実行した discovery stage すべての Resolution が完了している必要があります。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "discovery Resolution を closure より先に完了させる順序を強制するものではなく、merge / review completion の時点で揃っていれば十分です。",
    ),
  );
  assert.doesNotMatch(
    core,
    /Discovery Resolution Contract|discovery_resolved|resolution_state/i,
    "policy/core.md must not introduce a new Discovery Resolution Contract or Resolution state schema",
  );
  assert.doesNotMatch(
    core,
    /discovery.{0,20}Resolution.{0,30}(完了|終わ).{0,10}(から|前提).{0,10}closure|closure.{0,10}を開始できません/,
    "this fix is a merge/completion gate, not a new precondition for starting closure",
  );

  // Pass the selected commit range to Execution: Execution Contract's
  // target field is bound to Selection's expected target (SHA or commit range),
  // not reduced to a bare "target SHA" that Selection's range would silently
  // narrow down to. Since Step 9 (2nd discovery) and Step 10 (targeted closure)
  // both already say "Execution Contract に従って", fixing the Contract's own
  // definition is enough to cover them without restating range semantics there.
  assert.ok(
    containsText(core, "Selection で確定した expected target SHA / commit range"),
  );
  assert.doesNotMatch(
    core,
    /#### Execution Contract\s*\n\s*-\s*trigger 方法\s*\n\s*-\s*target SHA\s*\n/,
    "Execution Contract must not regress to a bare, Selection-unbound 'target SHA' field",
  );

  // Invalidate discovery on artifact-set-only target changes: the
  // review target is explicitly defined as the (SHA/range, artifact set)
  // pair, and the Execution Contract propagates the confirmed artifact set
  // to the trigger just like the confirmed SHA/range, instead of silently
  // dropping it.
  assert.ok(
    containsText(
      core,
      "この節における review target は、Selection Contract で確定した expected target SHA / commit range と target artifact set の組を指します。**どれか 1 つでも変われば review target の変更です。**",
    ),
  );
  // Detecting that drift is the checker's job now (behavior fixtures in
  // test/merge-ready-fence-lib.test.mjs cover head, base and artifact-set
  // moves). The Kernel keeps the definition and the fail-safe consequence.
  assert.ok(
    containsText(
      core,
      "precondition evidence、discovery evidence、closure evidence はいずれも target-specific であり、確定した target と一致しない evidence を review / closure / merge の根拠にしません。",
    ),
  );
  assert.ok(
    containsText(core, "Selection で確定した target artifact set"),
  );
  assert.ok(
    containsText(
      core,
      "Selection Contract で確定した expected target（SHA / commit range）と target artifact set は、Execution で reviewer の trigger へ渡し、実際に渡した target と artifact set を記録します。",
    ),
  );
  assert.doesNotMatch(
    core,
    /#### Execution Contract\s*\n\s*-\s*trigger 方法\s*\n\s*-\s*Selection で確定した expected target SHA \/ commit range\s*\n\s*-\s*required context\s*\n/,
    "Execution Contract must not regress to omitting the confirmed target artifact set field",
  );

  // Principle B (review evidence is target-specific): discovery evidence, not just
  // precondition evidence, does not carry over to a new target unless the change
  // was the accepted-fix-driven closure path.
  assert.ok(
    containsText(
      core,
      "precondition evidence、discovery evidence、closure evidence はいずれも target-specific であり、確定した target と一致しない evidence を review / closure / merge の根拠にしません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "accepted-fix による closure target の変更以外の理由で review target が変わった場合、その discovery を新しい target の merge / completion evidence として使いません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "accepted fix による target 変更は、既存の targeted closure（Executable）/ closure verification（Normative）の扱いに従います。",
    ),
  );

  // Acquisition & Validity invariants
  assert.ok(containsText(core, "CI status は review completion と同義ではありません"));
  assert.ok(containsText(core, "0 findings は positive evidence を必要とします"));
  assert.ok(
    containsText(
      core,
      "確定した reviewed target が expected target と一致しない場合、completion していても invalid です。",
    ),
  );
  assert.ok(containsText(core, "intended artifact set が review されていない場合も invalid です。"));

  // Issue #22: acquisition records are only durable evidence once persisted
  // somewhere a later session can recover independent of the reviewing
  // agent/session (e.g. a PR/Issue comment), not merely "recordable".
  assert.ok(
    containsText(
      core,
      "acquisition の record は、後続 session から独立に recoverable な場所へpersist されて初めて durable evidence です。",
    ),
  );
  // An existing provider surface that
  // already carries enough information in a later-session-recoverable form
  // counts as the record itself — this must not be read as requiring every
  // already-durable run to additionally post a normalized record.
  //
  // Root-cause fix: the first two
  // closure attempts hand-enumerated which elements the surface must carry
  // (target, then +artifact set), and each round a reviewer found one more
  // Validity/Completion element missing from the hand-kept list (required
  // context accessibility was still absent after round 2). Rather than
  // enumerate a 3rd time, this defers to "Completion と Validity の要求事項"
  // as a whole, so no future element can be missing from this sufficiency
  // bar without also being missing from the Contract's own definition above.
  assert.ok(
    containsText(
      core,
      "本 Contract が定義する Completion と Validity の要求事項を独立に判定できるだけの情報が",
    ),
  );
  assert.ok(
    containsText(
      core,
      "reviewer mechanism が外部から確認可能な surface へ残す結果に、その判定に必要な情報が既に含まれていれば、その surface 自体をこの record の recoverable な representation として扱ってよく、別途 record を post し直す必要はありません。",
    ),
  );
  // Root-cause fix #2: the first root-cause fix
  // still let the no-surface fallback path point at the bare record schema,
  // whose `validity` field is only a self-asserted conclusion — so a later
  // session had no way to independently re-derive it, unlike the surface
  // branch which requires independently-judgable raw information. Unify both
  // branches under one bar (enough info to independently judge Completion/
  // Validity) so the schema's summary fields can never again be mistaken for
  // a substitute for the evidence behind them.
  assert.ok(
    containsText(
      core,
      "含まれていない場合（reviewer mechanism 自身がそのような surface へ結果を残さない場合、例えば実装 session 内で動く subagent review を含む）は、上記の record schema の各 field に加え、Completion と Validity の要求事項",
    ),
  );
  assert.ok(
    containsText(
      core,
      "を独立に判定できる情報を、そのような場所へ明示的に persist しない限り、session 終了後には recoverable な evidence として扱いません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "record schema 自体（特に `validity` field）は判定結果の要約であり、その根拠情報の代わりにはなりません。",
    ),
    "the record schema's validity field must not be treated as sufficient evidence on its own",
  );
  // The sufficiency bar must not silently re-narrow to only a hand-picked
  // subset — it must cover Validity's own 4 listed requirements by reference.
  for (const requirement of [
    "reviewed SHA / range が intended target と一致している",
    "intended artifact set が review 対象になっている",
    "required context へアクセスできた",
    "execution / acquisition が途中で欠落していない",
  ]) {
    assert.ok(core.includes(requirement), `Validity requirement must still be listed: ${requirement}`);
  }
  assert.ok(
    containsText(core, "positive completion evidence のない empty output は `unknown` として扱います。"),
  );
  assert.ok(containsText(core, "`none` / `unknown` / `failure` を区別し、混同してはいけません。"));

  // Completion and Validity must not both claim ownership of target SHA/range matching:
  // Completion covers run termination/acquisition only; Validity owns the SHA/range match.
  assert.ok(
    !core.includes("intended SHA / range を対象にしている"),
    "Completion must not require intended SHA/range match (that belongs to Validity, see Fix 5)",
  );
  assert.ok(containsText(core, "reviewed SHA / range が intended target と一致している"));
  assert.ok(containsText(core, "quota / timeout / structural な execution / acquisition failure がない"));

  // Acquisition record schema fields
  for (const field of [
    '"reviewer"',
    '"target_sha"',
    '"status"',
    '"validity"',
    '"finding_count"',
    '"result_locator"',
    '"started_at"',
    '"completed_at"',
    '"failure"',
  ]) {
    assert.ok(core.includes(field), `missing record schema field: ${field}`);
  }

  // The record's target_sha is the reviewed/observed target, not the Selection
  // Contract's expected target, and completed-but-invalid must be expressible via
  // status/validity together, without expanding the schema beyond this one field.
  assert.ok(
    containsText(
      core,
      "record の `target_sha` は、Selection Contract の expected target（SHA / commit range）ではなく、実際に reviewed された SHA / range（observed target）を表します。",
    ),
  );
  assert.ok(containsText(core, "`validity` は少なくとも `valid` / `invalid` / `unknown` を表現します。"));
  assert.ok(
    containsText(core, "この場合、record は `status: completed` かつ `validity: invalid` として表現します。"),
  );

  // Reviewed-target evidence consistency: reconciling the record's target_sha
  // against the reviewed target carried by the acquired evidence — and ranking
  // competing representations of the same object — is executed by the
  // deterministic evaluator (test/review-evidence-state.test.mjs owns those
  // cases). The Kernel keeps the two consequences it must never lose: an
  // unconfirmable reviewed target is unknown, and a confirmed mismatch is
  // invalid. Neither may be read as valid.
  assert.ok(
    containsText(
      core,
      "reviewed target をどの field / surface から確定するか、複数表現の間でどの binding を優先するか、および確定した reviewed target を expected target と照合する手順は、Foundation-owned な deterministic evaluator が所有します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "reviewed target を Validity 判定に必要な精度で確認できない場合、その binding は成立しておらず、判定結果は `unknown` です。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "確定した reviewed target が expected target と一致しない場合、completion していても invalid です。",
    ),
  );

  // Resolution Contract
  assert.ok(
    containsText(
      core,
      "fix / false-positive / needs-verification / technical-dispute / intent-question へ triage する",
    ),
  );
  assert.ok(containsText(core, "human を raw finding の message bus にしない"));
  assert.ok(containsText(core, "pure technical dispute は technical adjudication で解決する"));
  assert.ok(containsText(core, "human escalation は product intent / authority に限る"));
  assert.ok(
    containsText(core, "P0/P1 相当の重大 finding を dismiss する場合は、必要に応じて独立 reviewer の確認を要求する"),
  );
  assert.ok(containsText(core, "accepted finding は drip fix せず、root-cause を確認した上で batch で fix する"));
  assert.ok(containsText(core, "fix 後は全 discovery をやり直さず、targeted closure を基本とする"));
  assert.ok(containsText(core, "review を新しい scope の探索に使わない"));

  // Review Adapter boundary
  for (const fn of ["trigger()", "pollCompletion()", "collectOutputs()", "normalizeFindings()"]) {
    assert.ok(core.includes(fn), `missing adapter boundary function: ${fn}`);
  }
  assert.ok(containsText(core, "という negative claim を恒久仕様にしてはいけません。"));
  assert.ok(
    containsText(
      core,
      "収集した evidence は、comment ID / review ID / run ID / timestamp / target SHA または commit range を可能な範囲で保持します。",
    ),
  );

  // Failure / retry
  assert.ok(containsText(core, "transient failure: bounded retry"));
  assert.ok(
    containsText(core, "quota / rate limit: `unknown` または `failure` として明示し、success に潰さない"),
  );
  assert.ok(
    containsText(
      core,
      "structural capability mismatch: 同じ trigger を無限 retry せず、alternate reviewer / escalation",
    ),
  );
  assert.ok(containsText(core, "empty output: positive completion evidence がなければ `unknown`"));

  // Review stopping rules (Kernel-retained always-on semantics, #51 Phase 1).
  // The artifact-class finite flow itself moved to the Foundation-owned review
  // skills; what stays here is the target-bound evidence invariant, the
  // closure-cycle stopping semantics, and the discovery round limit — all of
  // which can be violated at any time, including at the merge-ready fence,
  // without ever entering the skill's procedure.

  // Root cause A (closure findings need Resolution too): completed + valid closure
  // runs still gate on Resolution before merge/completion, in both artifacts, using
  // the existing Resolution Contract rather than a new Closure Resolution Contract.
  assert.ok(
    containsText(
      core,
      "discovery（2nd full discovery を含む）と targeted closure / closure verification のいずれの finding も Resolution Contract の対象であり、triage category を付けただけでは Resolution 完了ではない。",
    ),
  );

  // Resolve discovery findings before merge: triage alone is not
  // Resolution completion — an unresolved needs-verification / technical-dispute
  // / intent-question finding blocks that stage's Resolution, no new state enum.
  assert.ok(
    containsText(
      core,
      "unresolved の finding（未解決の needs-verification / technical-dispute / intent-question 等を含む）が残る間は、その review stage の Resolution は完了せず、merge / review completion の根拠にしない",
    ),
  );

  // Root cause B (precondition target-binding): precondition evidence used as
  // review/closure/merge grounds must match the confirmed (frozen/Selected)
  // target, not just "not stale after a later mutation." Comparing the two SHAs
  // is the fence's `verify-coherence` check now, so the Kernel states where the
  // judgment lives instead of restating the comparison.
  assert.ok(
    containsText(
      core,
      "precondition evidence が確定した target SHA を指しているかは deterministic であり、Merge-ready completion fence が参照する checker が機械判定します。照合手順を本節に置きません。",
    ),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range: a SHA-only match is not enough — the selected target artifact
  // set must also be within the precondition check's covered scope, checked
  // after Selection when the check ran before it, with a rerun required
  // whenever coverage can't be positively confirmed. This half is explicitly
  // NOT machine-judged, so it stays normative here.
  assert.ok(
    containsText(
      core,
      "checker が判定しないのは、precondition check がどの artifact scope を対象としたかです。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "precondition check を Selection より前に実行した場合は、Selection 後にこの binding を確認します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "selected artifact set を precondition evidence がカバーしていると確認できない場合は、確定した target に対して precondition check を再実行してから先へ進みます。",
    ),
  );

  // Range-only target change: a commit
  // range's endpoint moving counts as a target change even if head SHA is
  // unchanged, so old evidence isn't carried over just because the SHA looks the
  // same. The canonical review target definition the merge-ready fence and both
  // skills key on stays in the Kernel.
  assert.ok(
    containsText(
      core,
      "head SHA が不変でも commit range の endpoint が変わった場合、また expected target SHA / commit range が不変でも target artifact set が変わった場合も、review target の変更として同じ scope です。",
    ),
  );

  // Discovery round limit stays always-on: the merge-ready completion fence's
  // expected-member exception is defined in terms of "targeted closure で十分と
  // 判定されて" per these rules, so the round limit cannot be skill-only.
  assert.ok(containsText(core, "full discovery は原則 1 round です。"));
  assert.ok(containsText(core, "materially 変えた場合のみ 2 round 目を許容します。"));
  assert.ok(
    containsText(
      core,
      "2nd discovery の accepted finding を fix した後も、その fix が behavior / blast radius をさらに materially 変えた場合は、3rd full discovery を起動せず、targeted closure だけで merge へ進まず、upstream task/design の不安定さを疑い、必要に応じて escalate します。",
    ),
  );
  assert.doesNotMatch(
    core,
    /4th full discovery|third full discovery|discovery_round|round counter|Materiality Contract|Closure Materiality Contract/i,
    "must not introduce a 3rd discovery phase, round counter, or a new Materiality Contract",
  );
  assert.doesNotMatch(
    core,
    /discovery_round|round counter|Second Discovery Contract/,
    "policy/core.md must not introduce a new round-counter schema or a Second Discovery Contract",
  );

  // Stage-independent closure-cycle stopping semantics: a repeating
  // closure Resolution -> accepted fix -> closure review cycle (either
  // artifact) is escalated as upstream/policy instability, distinct from
  // Failure/retry's retry count — stated once in canonical policy rather than
  // only referenced from the skills.
  assert.ok(
    containsText(
      core,
      "closure Resolution で accepted fix が生じ、その fix を closure review で確認する cycle（Executable の targeted closure、Normative の closure verification のいずれも）が繰り返し発生する場合、無制限に継続せず、upstream task/design または policy/document 自体の instability を疑い、必要に応じて escalate します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "これは Failure / retry の retry count とは別の stopping semantics です。",
    ),
  );

  // Canonical invariant (root cause fix): mechanical/deterministic precondition
  // evidence is target-specific and does not carry over across a target change.
  assert.ok(
    containsText(
      core,
      "target が変更された場合、その新しい target に対する mechanical / deterministic precondition の evidence は自動的に持ち越しません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "precondition check（Executable の deterministic verify、Normative の mechanical check）を新しい target に対して再成立させます。",
    ),
  );

  // #51 Phase 1: the Kernel keeps the routing pointer to the skill-owned
  // procedure instead of the procedure itself.
  assert.ok(
    containsText(
      core,
      "この review 手順の canonical source は Foundation-owned な review skill であり、本節には置きません。該当する review 手順へ入る前に、Skill routing contract に従って対応する skill を load します。",
    ),
  );

  // Observed evidence stays a general principle, not a permanent provider rule
  assert.ok(containsText(core, "expected trigger behavior は completion evidence と同義ではありません。"));
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // The generated consumer adapter must be self-contained: it must not reference
  // a bare, Foundation-repo-only skill path. It may reference the distributed
  // `.ai-dev-foundation/skills/...` path, since that path is now materialized to
  // every consumer.
  assert.ok(containsText(core, "実行手順（review skill）は Foundation リポジトリ側に別途保持し、"));
  assert.doesNotMatch(core, /(?<!\.ai-dev-foundation\/)skills\/review-code\.md/);
  assert.doesNotMatch(core, /(?<!\.ai-dev-foundation\/)skills\/review-doc\.md/);
});

// #51 Phase 1 (progressive disclosure canary): the artifact-class review finite
// flow — the phase-specific part of the former Kernel `Review stopping rules`
// section — is owned by the Foundation-owned review skills, not by the Kernel.
// Every assertion below previously ran against `policy/core.md`; the semantics
// are unchanged, only the canonical location moved.
test("review skills own the artifact-class review finite flow (#51 Phase 1)", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  // --- Executable finite flow (skills/review-code.md) ---

  // Stopping rules, including the closure Acquisition & Validity gate before merge
  assert.ok(reviewCode.includes("closure completion / acquisition / validity 確認"));
  // Finding 1: the Code accepted-fix branch re-applies Selection/Execution to the
  // closure target before targeted closure runs.
  assert.ok(reviewCode.includes("closure target の Selection / Execution"));
  assert.ok(reviewCode.includes("-> targeted closure"));

  // Route a material fix through a full 2nd discovery: an optional 2nd
  // full discovery sits between the post-fix deterministic verify and closure
  // target Selection/Execution — reusing the same discovery Contracts, not a new
  // Second Discovery Contract or round-counter schema. #51 Phase 1: the branch
  // condition itself defers to the Kernel's Review stopping rules rather than
  // restating the materiality criterion inside the skill.
  assert.ok(
    containsText(
      reviewCode,
      "deterministic verify -> Review stopping rules に従い 2nd full discovery が必要な場合のみ:",
    ),
  );
  assert.ok(reviewCode.includes("second discovery target の Selection / Execution"));
  assert.ok(reviewCode.includes("full discovery（2nd round、独立 reviewer）"));
  assert.ok(
    containsText(
      reviewCode,
      "required review 数の valid run 確認 -> aggregate / triage -> accepted finding があれば batch fix -> target が変われば deterministic verify",
    ),
  );
  assert.doesNotMatch(
    reviewCode,
    /discovery_round|round counter|Second Discovery Contract/,
    "the skill must not introduce a new round-counter schema or a Second Discovery Contract",
  );
  assert.ok(
    containsText(
      reviewCode,
      "この review flow で accepted finding の fix によって target が変更された場合のみ（手順 9 の second full discovery を挟んだ場合を含む）行います。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "targeted closure の review run に手順 5 と同じ Acquisition & Validity Contract を適用し、completion / acquisition / validity を確認します。",
    ),
  );

  // Unify closure-entry predicates with the canonical review target
  // definition: the Code review diagram's accepted-fix branch condition is
  // "review target changed", not a stage-local "candidate SHA changed" that
  // drifts from the review target definition the Kernel still owns.
  assert.ok(
    containsText(reviewCode, "-> accepted finding の batch fix で review target が変更された場合:"),
  );
  assert.doesNotMatch(
    reviewCode,
    /accepted finding の batch fix で candidate SHA が変更された場合/,
    "the Code review diagram's closure-entry condition must not regress to a bare candidate-SHA predicate",
  );

  assert.ok(reviewCode.includes("closure finding の Resolution"));
  assert.ok(
    containsText(
      reviewCode,
      "targeted closure の finding を Resolution Contract（`policy/core.md`）に従って triage します。unresolved の finding がある間は merge しません。",
    ),
  );

  // Resolve discovery findings before merge, Code flow: the
  // accepted-fix diagram branch requires required discovery stage(s)'
  // Resolution to complete, not just closure Resolution, before merge.
  assert.ok(reviewCode.includes("required discovery stage(s) の Resolution 完了"));
  assert.ok(
    containsText(reviewCode, "closure finding の Resolution -> accepted closure finding があれば:"),
  );

  // Re-evaluate materiality of closure fixes: an accepted closure
  // finding's fix re-enters Review stopping rules — routing to an unused 2nd
  // discovery if needed, to escalation (no 3rd discovery, no merge) if 2nd was
  // already used and still insufficient, or back to targeted closure if the
  // fix wasn't material — instead of falling straight through to merge.
  assert.ok(
    containsText(
      reviewCode,
      "accepted closure finding があれば: batch fix -> deterministic verify -> Review stopping rules の再評価",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "2nd full discovery 未使用かつ必要な場合: second discovery target の Selection / Execution から上記の full discovery route へ進み、完了後 targeted closure を再実行する",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "2nd full discovery 使用済みでなお必要な場合: 3rd full discovery は起動せず、merge もせず、upstream task/design の不安定さを疑い、必要に応じて escalate する",
    ),
  );
  assert.ok(
    containsText(reviewCode, "追加の full discovery が不要な場合: targeted closure を再実行する"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "accepted な closure finding があれば、手順 7 と同じ batch fix semantics でまとめて fix し、手順 8 と同じ deterministic verify を行います。その上で Review stopping rules（`policy/core.md`）を再評価します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "この review flow で手順 9 をまだ使っておらず、2nd full discovery が必要と判断される場合は、手順 9 へ進み、完了後に手順 10 へ進みます。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "手順 9 を既に使っており、なお追加の full discovery が必要と判断される場合は、3rd full discovery は起動せず merge もせず、upstream task/design の不安定さを疑い、必要に応じて escalate します。",
    ),
  );
  assert.ok(
    containsText(reviewCode, "追加の full discovery が不要な場合は、手順 10 へ進みます。"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "手順 6 の discovery Resolution（手順 9 を使った場合はその Resolution も含む）と、Closure Acquisition & Validity・Closure Resolution の完了が必要です。discovery Resolution と closure の完了順序は問いません。",
    ),
  );
  // The verify/freeze SHA comparison the diagram used to spell out is a fence
  // check now (test/merge-ready-fence-lib.test.mjs fixtures 18-20); the diagram
  // instead shows the fence as the last step before merge.
  assert.ok(!reviewCode.includes("verify target と freeze target の consistency 確認"));
  assert.ok(reviewCode.includes("-> merge-ready fence"));
  assert.ok(
    containsText(
      reviewCode,
      "この review flow で accepted finding の fix による target 変更が一度も発生していなければ、required review 数の valid discovery と Resolution（手順 6）が完了した時点で semantic な条件が揃います。",
    ),
  );
  assert.ok(reviewCode.includes("-> accepted fix が無く review target が変更されていない場合:"));
  assert.doesNotMatch(
    reviewCode,
    /accepted fix が無く candidate SHA が変更されていない場合/,
    "the merge-without-closure branch must key on review target (SHA-and-range), not head SHA alone, or an independent range move could read as unchanged",
  );

  // Stop merge after a materially-changing 2nd discovery fix: the
  // canonical Code review diagram re-evaluates the need for more discovery after
  // the 2nd discovery's own accepted-finding fix, not just before entering 2nd
  // discovery — a further material change stops at escalation, not merge.
  assert.ok(
    containsText(
      reviewCode,
      "-> target が変われば deterministic verify -> この fix でさらに追加の full discovery が必要と判断される場合: 3rd full discovery は起動せず、merge もせず、upstream task/design の不安定さを疑い、必要に応じて escalate する -> closure target の Selection / Execution",
    ),
  );

  // --- Normative finite flow (skills/review-doc.md) ---

  assert.ok(reviewDoc.includes("closure completion / acquisition / validity 確認"));
  assert.ok(reviewDoc.includes("closure target の Selection / Execution"));
  assert.ok(reviewDoc.includes("closure finding の Resolution"));
  assert.ok(
    containsText(
      reviewDoc,
      "unresolved の finding がある間は review procedure を完了としません。",
    ),
  );
  // Resolve discovery findings before merge, Normative flow: same
  // gate for semantic discovery Resolution before review completion.
  assert.ok(
    containsText(
      reviewDoc,
      "-> closure finding の Resolution -> semantic discovery の Resolution 完了 -> merge-ready fence（merge-ready を宣言する場合） -> 完了",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "closure Resolution に加えて、手順 5 の semantic discovery Resolution も完了していることが review procedure 完了の条件です。完了順序は問いません。",
    ),
  );
  // Reconciling the mechanical-check target with the Selection target is no
  // longer a step in the flow: the fence's `verify-coherence` check compares
  // them (test/merge-ready-fence-lib.test.mjs, fixtures 18-20). What the skill
  // keeps is the duty to record the check's SHA and to redo it on a move.
  assert.ok(
    containsText(
      reviewDoc,
      "手順 1 の mechanical check 対象と確定した target の一致、および宣言した routing と changed artifact set の整合は、手順 9 の fence が機械判定します。",
    ),
  );

  // Normative keeps exactly one semantic discovery round.
  assert.ok(reviewDoc.includes("semantic discovery（1 round）"));
  assert.doesNotMatch(
    reviewDoc,
    /semantic discovery（2nd round）|2nd semantic discovery/,
    "Normative document review must not gain a 2nd semantic discovery round",
  );
  assert.ok(
    containsText(
      reviewDoc,
      "accepted finding の fix によって target SHA / range または target artifact set が変わった場合のみ行います。修正後の target に対して手順 1 の mechanical check を再実行し、",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "closure verification 自体の completion / acquisition / validity も、この closure target を expected target として Acquisition & Validity Contract に従って確認します。",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "required review 数の valid semantic discovery と Resolution が完了した時点で review procedure を完了とし、新たな closure run を要求しません。",
    ),
  );

  // Unify closure-entry predicates with the canonical review target
  // definition, Normative sibling: both diagram branches key on "review
  // target", matching the Code review diagram and the Kernel's review target
  // definition, not a stage-local "target SHA / range" partial predicate.
  assert.ok(containsText(reviewDoc, "-> accepted finding の fix で review target が変更された場合:"));
  assert.ok(containsText(reviewDoc, "-> accepted fix が無く review target が変更されていない場合:"));
  assert.doesNotMatch(
    reviewDoc,
    /accepted finding の fix で target SHA \/ range が変更された場合/,
    "the Normative diagram's closure-entry condition must not regress to a bare SHA/range predicate",
  );
  assert.ok(
    containsText(
      reviewDoc,
      "mechanical check -> closure target の Selection / Execution -> closure verification",
    ),
  );
});

// #51 Phase 1 contract: routing remains in the Kernel, procedure moved to the
// skills. This guards both halves at once — a regression that copies the flow
// back into the Kernel (or into the generated consumer adapter) fails here, and
// so does a regression that drops the MUST skill-load routing.
test("Phase 1 migration keeps routing in the Kernel and the procedure in the skills", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const generated = await readFile(
    path.join(root, "test", "fixtures", "consumer", "AGENTS.md"),
    "utf8",
  );

  // Distinctive finite-flow markers that must no longer live in always-on context.
  const flowMarkers = [
    "-> freeze candidate SHA",
    "-> verify target と freeze target の consistency 確認",
    "-> discovery（独立 reviewer）",
    "-> accepted finding の batch fix で review target が変更された場合:",
    "second discovery target の Selection / Execution",
    "-> closure target の Selection / Execution -> targeted closure",
    "-> closure finding の Resolution",
    "required discovery stage(s) の Resolution 完了",
    "mechanical check target と Selection target の consistency 確認",
    "semantic discovery（1 round）",
    "-> accepted finding の fix で review target が変更された場合:",
  ];
  for (const marker of flowMarkers) {
    assert.ok(
      !containsText(core, marker),
      `Kernel must not carry the migrated finite-flow procedure: ${marker}`,
    );
    assert.ok(
      !containsText(generated, marker),
      `generated consumer AGENTS.md must not carry the migrated finite-flow procedure: ${marker}`,
    );
  }

  // The Kernel keeps a `Review stopping rules` section: the always-on semantics
  // the merge-ready completion fence and both skills reference by name.
  assert.ok(core.includes("### Review stopping rules"));
  assert.ok(generated.includes("### Review stopping rules"));

  // The MUST skill-load routing stays discoverable from always-on context, in
  // the Kernel and in the generated consumer adapter alike.
  for (const text of [core, generated]) {
    assert.ok(
      containsText(
        text,
        "該当する artifact classification の review 手順に入る前に、対応する skill を load することは **MUST** です。",
      ),
    );
    assert.ok(containsText(text, "`.ai-dev-foundation/skills/review-code.md`"));
    assert.ok(containsText(text, "`.ai-dev-foundation/skills/review-doc.md`"));
    assert.ok(
      containsText(
        text,
        "この review 手順の canonical source は Foundation-owned な review skill であり、本節には置きません。該当する review 手順へ入る前に、Skill routing contract に従って対応する skill を load します。",
      ),
    );
  }

  // The migrated procedure is reachable from the distributed skill bundle, and
  // the distributed copy is an exact match of the canonical skill.
  for (const name of ["review-code.md", "review-doc.md"]) {
    const canonical = await readFile(path.join(root, "skills", name), "utf8");
    const distributed = await readFile(
      path.join(root, "test", "fixtures", "consumer", ".ai-dev-foundation", "skills", name),
      "utf8",
    );
    assert.equal(distributed, canonical, `distributed ${name} must match the canonical skill`);
    assert.ok(canonical.includes("## 停止条件"), `${name} must own its stopping/finite-flow section`);
    assert.ok(canonical.includes("```text"), `${name} must carry the migrated finite flow`);
  }
});

test("core policy defines a provider-neutral skill routing contract", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("### Skill routing contract"));
  assert.ok(containsText(core, "| Executable | `.ai-dev-foundation/skills/review-code.md` |"));
  assert.ok(containsText(core, "| Normative | `.ai-dev-foundation/skills/review-doc.md` |"));
  // Informational stays consistent with Artifact classification: no mandatory review skill.
  assert.ok(
    containsText(
      core,
      "| Informational | mandatory review skill なし（Artifact classification の定義に従い、" +
        "open-ended AI review を通常の merge gate にしないため） |",
    ),
  );
  assert.ok(
    containsText(
      core,
      "対応する skill を load することは **MUST** です。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "consumer はこの path を編集しません。canonical source は Foundation リポジトリの `skills/` であり、",
    ),
  );

  // The routing contract itself must resolve `policy/core.md` skill references
  // to something a consumer repository actually has: the generated AGENTS.md's
  // Foundation policy section, not a `policy/core.md` file that never ships.
  assert.ok(
    containsText(
      core,
      "consumer にはこの規範的なルールが generated `AGENTS.md` の `## Foundation policy` section として配布されます。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "consumer リポジトリに `policy/core.md` という path が存在することを前提にしません。",
    ),
  );

  // Provider-neutral: no provider name and no provider-specific skill mechanism.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
  assert.doesNotMatch(core, /\.claude\/skills|\.codex\/skills/);
});

// Issue #57 (O-2 prerequisite hardening): a single review target can straddle
// multiple artifact classifications (observed on reitojike/stage-tracker
// PR#60 / #127 — a mix of Executable and Normative artifacts in one target).
// The 1:1 Skill routing contract table didn't say what to do then; fresh
// agents independently converged on "load every applicable skill, apply each
// classification's procedure only to its own artifact subset" without it
// being written down. This test locks that resolution in as a deterministic,
// mechanically-checkable rule.
test("skill routing contract defines mixed-classification review target routing (Issue #57)", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  // The rules live inside the Skill routing contract rather than in a section
  // of their own; folding them in removed the duplicated framing, not the rules.
  const routingIndex = core.indexOf("### Skill routing contract");
  assert.ok(routingIndex !== -1);
  const routing = core.slice(routingIndex, core.indexOf("## Foundation Change Protocol"));

  // MUST load every applicable classification's skill — not just one.
  assert.ok(
    containsText(
      routing,
      "1 つの review target が、mandatory review skill を持つ classification（Executable と Normative）を複数含む場合（mixed-classification review target）、**該当する classification すべてに対応する skill を load することを MUST とします。**",
    ),
  );
  assert.ok(
    containsText(
      core,
      "いずれか 1 つの classification の skill だけを load し、他の classification に属する artifact もそれで代替したことにしてはいけません。",
    ),
  );

  // Each classification's procedural obligations apply only to its own artifact
  // subset — no cross-classification borrowing of stricter/looser rules.
  assert.ok(
    containsText(
      core,
      "各 classification の手続き的 obligation（stopping rule、discovery round 数、required review 数、closure / verification 手順）は、その classification に属する artifact subset にのみ適用し、他の classification へ流用しません。",
    ),
  );
  // Which classifications a target actually contains is derived from the
  // changed artifact set by the checker, so an under-declared Mixed target
  // fails rather than depending on the agent noticing
  // (test/merge-ready-fence-lib.test.mjs, fixtures 15 and 17).
  assert.ok(
    containsText(
      core,
      "**changed artifact set から required skill を導出する判定は、agent の自己申告だけで決めません。**",
    ),
  );
  assert.ok(
    containsText(
      core,
      "path から class を確実に導出できない artifact を、checker が勝手に特定の class へ分類することはありません。",
    ),
  );

  // Informational's "no mandatory review skill" definition is unaffected by
  // being mixed into the same target as Executable/Normative artifacts.
  assert.ok(
    containsText(
      core,
      "target に Informational な artifact が同時に含まれていても、Informational に mandatory review skill が無いという Artifact classification の定義は変わりません。",
    ),
  );

  // Multiple loaded skills run as independent parallel flows, not one forced
  // merge into a single procedure.
  assert.ok(
    containsText(
      core,
      "複数の skill を load した場合、各 skill の discovery / closure / stopping semantics は classification ごとに独立した review flow として並行に適用してよく、単一の flow へ統合することを要求しません。",
    ),
  );
  assert.ok(
    containsText(core, "| Executable | `.ai-dev-foundation/skills/review-code.md` |"),
    "the single-classification 1:1 table must survive unchanged",
  );
  assert.ok(
    containsText(core, "| Normative | `.ai-dev-foundation/skills/review-doc.md` |"),
    "the single-classification 1:1 table must survive unchanged",
  );

  // Provider-neutral, and no new Kernel-level round-counter/schema invented
  // just to express this routing rule.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
  assert.doesNotMatch(core, /mixed_classification|classification_matrix|Mixed Classification Contract/i);
});

test("the skill routing contract table stays in sync with the actual skills/ directory", async () => {
  // The routing contract table in policy/core.md is static prose, not
  // generated from skills/. This guards against it silently going stale if a
  // skill file is added to or removed from skills/ without updating the table.
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const skillFiles = (await readdir(path.join(root, "skills"))).filter((file) => file.endsWith(".md")).sort();

  const referencedSkillPaths = [...core.matchAll(/`\.ai-dev-foundation\/skills\/([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(referencedSkillPaths)].sort(),
    skillFiles,
    "policy/core.md's Skill routing contract table must list exactly the files in skills/",
  );
});

test("review skills document procedure without duplicating normative rules", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");
  // Read the Kernel too: several rules the skills used to restate are now
  // asserted where they actually live.
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  for (const skill of [reviewCode, reviewDoc]) {
    assert.ok(skill.includes("policy/core.md"), "skill must reference policy/core.md");
    assert.doesNotMatch(
      skill,
      /"target_sha": "\.\.\."/,
      "skill must not duplicate the Acquisition & Validity record schema from policy",
    );
    // Neither skill restates the drip-fix prohibition; both defer to Resolution Contract.
    assert.doesNotMatch(skill, /drip fix/, "skill must reference Resolution Contract instead of restating drip fix");

    // A distributed skill's many `policy/core.md` references must be resolvable
    // from consumer context, where no `policy/core.md` file ships — only the
    // generated AGENTS.md's Foundation policy section does.
    assert.ok(
      containsText(
        skill,
        "の規範的なルールは generated `AGENTS.md` の `## Foundation policy` section として配布されます。",
      ),
      "skill must state how policy/core.md references resolve in consumer context",
    );
    assert.ok(
      containsText(skill, "consumer リポジトリに `policy/core.md` という path が存在することは前提にしません。"),
      "skill must not assume a policy/core.md path exists in the consumer repository",
    );
  }

  // review-code.md covers the code review procedure, including the closure validity
  // gate before merge and the manual adapter boundary
  for (const phrase of [
    "Freeze candidate SHA",
    "Selection",
    "Execution",
    "Deterministic verify",
    "Targeted closure",
    "Closure Acquisition & Validity",
    "Closure Resolution",
    "Merge",
    "Adapter boundary",
    "Happy path",
    "reviewer capability record",
  ]) {
    assert.ok(reviewCode.includes(phrase), `review-code.md missing: ${phrase}`);
  }

  // Issue #72 Phase 1: reviewer-provider knowledge (which reviewers exist, how
  // they are triggered, which markers mean completion / rate limit) moved out
  // of this skill into the consumer-owned reviewer capability record. The skill
  // still names Claude Code where it draws the preflight/local boundary around
  // the *implementing* agent's own tooling, but no longer names any reviewer
  // provider, so the two can no longer drift apart.
  assert.doesNotMatch(
    reviewCode,
    /Codex|CodeRabbit/,
    "reviewer provider names belong in the reviewer capability record, not in review-code.md",
  );

  // Issue #22: collectOutputs() must cover mechanisms with no external
  // surface of their own (e.g. in-session/subagent review) by persisting the
  // run's record somewhere recoverable, deferring to policy's record schema
  // rather than restating it.
  assert.ok(
    containsText(
      reviewCode,
      "reviewer mechanism 自身が外部から確認可能な surface へ結果を残さない場合（例: 実装 session 内で動く subagent review）は、`policy/core.md` の Acquisition & Validity Contract が定める durable evidence の要求を、その手段で満たします。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "record が、結果を durable な GitHub surface へ残す trigger 経路を宣言している場合は、その経路を preferred route として使います。",
    ),
    "review-code.md must keep the durable-surface trigger route preference, expressed against the record rather than a named provider",
  );
  assert.ok(
    containsText(reviewCode, "この fallback は durable evidence requirement を免除しません"),
    "falling back to in-session/subagent acquisition must not drop the durable evidence requirement",
  );

  // CollectOutputs() must state that a
  // sufficiently informative existing surface counts as the recoverable
  // record itself, not just describe the no-surface persistence fallback.
  //
  // Root-cause fix: defer to policy's own Completion /
  // Validity requirements by reference instead of re-enumerating them here
  // too — the skill already says "skill は policy を使った作業方法を説明し、
  // 規範的なルールを複製しません", and a second hand-kept list here would
  // reintroduce the same drift risk the policy.md fix just eliminated.
  assert.ok(
    containsText(
      reviewCode,
      "`policy/core.md` の Acquisition & Validity Contract が定める durable evidence の要求を、その手段で満たします。何を persist すれば足りるかは同 Contract が定めます。",
    ),
  );
  // Both halves of the rule stay stated — but in the Kernel, once, instead of
  // being re-enumerated in the skill where the copy could drift. The
  // no-surface fallback must still demand evidence, not just conformance to
  // the bare record schema (whose `validity` field is only a self-asserted
  // conclusion a later session can't independently re-derive).
  assert.ok(
    containsText(
      core,
      "その surface 自体をこの record の recoverable な representation として扱ってよく、別途 record を post し直す必要はありません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "上記の record schema の各 field に加え、Completion と Validity の要求事項を独立に判定できる情報を、そのような場所へ明示的に persist しない限り、session 終了後には recoverable な evidence として扱いません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "record schema 自体（特に `validity` field）は判定結果の要約であり、その根拠情報の代わりにはなりません。",
    ),
  );

  // Commit range as review target: review target is SHA and,
  // applicable, commit range, per Selection Contract's own field name — not
  // reduced to head SHA alone, so a range-only mutation (e.g. base moving) is
  // covered by the same target mutation semantics as a SHA change.
  assert.ok(
    containsText(
      reviewCode,
      "review target は Selection Contract に従い、candidate SHA、applicable な場合は commit range、および target artifact set を含みます。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "commit range を review target として使う場合は対象 range も、target artifact set も同時に freeze し、以降 SHA について述べる target mutation semantics を range と artifact set にも同じ意味で適用します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "expected target SHA / applicable な commit range を決めます。",
    ),
  );

  // Pass the selected commit range to Execution: Step 4 must send the
  // Selection-confirmed target to the reviewer trigger, not just record a bare
  // target SHA after the fact — recording alone would still let the range
  // silently narrow to head SHA.
  assert.ok(
    containsText(
      reviewCode,
      "Execution Contract に従い、Selection で確定した expected target SHA / applicable な commit range と target artifact set を各 reviewer の trigger へ渡して起動します。",
    ),
  );
  assert.doesNotMatch(
    reviewCode,
    /trigger 方法と target SHA、渡した required context を記録します。/,
    "Step 4 must pass the Selection-confirmed target to the trigger, not just record target SHA after invocation",
  );

  // Invalidate discovery on artifact-set-only target changes: Step 3
  // freezes the artifact set as part of the review target from the moment
  // Selection confirms it, and Step 4 records what artifact set was actually
  // sent to the trigger, not just the SHA/range.
  assert.ok(
    containsText(
      reviewCode,
      "commit range を review target として使う場合は対象 range も、target artifact set も同時に freeze し、以降 SHA について述べる target mutation semantics を range と artifact set にも同じ意味で適用します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "artifact classification、reviewer / capability、required review 数、target artifact set、expected target SHA / applicable な commit range を決めます。",
    ),
  );
  assert.ok(
    containsText(reviewCode, "実際に渡した target と artifact set、required context を記録します。"),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range: Step 1 records what scope the deterministic verify actually
  // covered, and Step 3 checks that scope against the confirmed target
  // artifact set once Selection has run, re-verifying when coverage can't be
  // confirmed. Artifact set ownership stays with Selection — Step 1/2 only
  // record evidence metadata, they don't freeze a competing artifact set.
  assert.ok(
    containsText(
      reviewCode,
      "その verify が対象とした artifact / package / repository scope を必要な精度で記録した上で",
    ),
  );
  assert.ok(
    containsText(reviewCode, "repository 全体を対象とする verify であれば repo-wide として記録すれば十分です。"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "target artifact set を確定したら、直近の successful deterministic verify evidence が、確定した SHA / range と target artifact set の両方をカバーしているかを確認します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "selected artifact set をその verify evidence がカバーしていると確認できない場合は、確定した target に対して手順 1 の deterministic verify を再実行し、成功してから手順 4（Execution）へ進みます。",
    ),
  );

  // A mixed change (accepted-fix-driven head move plus an independently moved
  // range endpoint) is not closure-eligible for the independent portion — it
  // routes through Step 2's existing non-fix mutation semantics instead of a new
  // change-origin taxonomy.
  assert.ok(
    containsText(
      reviewCode,
      "fix による変更を超えて target が動いた場合（例えば commit range の一方の endpoint や target artifact set が accepted fix と無関係に変わった場合）、その独立した変更分は手順 2 の non-fix target mutation semantics に従い、targeted closure だけでは扱いません。",
    ),
  );

  // Root cause A, cell A (Code): a completed + valid closure run with findings
  // still gates on Resolution before merge; an accepted closure finding loops back
  // through the existing batch-fix/verify/closure procedure, not a new loop design.
  assert.ok(
    containsText(
      reviewCode,
      "targeted closure の finding を Resolution Contract（`policy/core.md`）に従って triage します。unresolved の finding がある間は merge しません。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "accepted な closure finding があれば、手順 7 と同じ batch fix semantics でまとめて fix し、手順 8 と同じ deterministic verify を行います。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "手順 6 の discovery Resolution（手順 9 を使った場合はその Resolution も含む）と、Closure Acquisition & Validity・Closure Resolution の完了が必要です。",
    ),
  );

  // Resolve discovery findings before merge: the discovery Resolution
  // gate isn't dropped when the accepted-fix path is taken — merge requires both
  // discovery and closure Resolution, in either order, not closure alone.
  assert.ok(
    containsText(reviewCode, "discovery Resolution と closure の完了順序は問いません。"),
  );

  // Follow-up (sibling gap B): a closure finding's fix may now re-enter the
  // optional Step 9 (2nd full discovery) if it's the first material fix in this
  // review flow, reusing the same materiality-only, not origin-stage-specific,
  // exception. If Step 9 was already used and another round is still needed, the
  // flow escalates instead of silently completing via targeted closure alone.
  assert.ok(
    containsText(
      reviewCode,
      "この review flow で手順 9 をまだ使っておらず、2nd full discovery が必要と判断される場合は、手順 9 へ進み、完了後に手順 10 へ進みます。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "手順 9 を既に使っており、なお追加の full discovery が必要と判断される場合は、3rd full discovery は起動せず merge もせず、upstream task/design の不安定さを疑い、必要に応じて escalate します。",
    ),
  );
  assert.ok(containsText(reviewCode, "追加の full discovery が不要な場合は、手順 10 へ進みます。"));

  // Gap fix: a repeating closure-finding cycle connects to the existing Review
  // stopping rules (upstream instability / escalate) instead of looping
  // unbounded; no new closure-specific retry counter or policy was introduced.
  assert.ok(
    containsText(
      reviewCode,
      "この cycle が繰り返し発生する場合は無制限に続けず、Review stopping rules（`policy/core.md`）に従って upstream task/design の不安定さを疑い、必要に応じて escalate します。",
    ),
  );

  // Root cause B, cells E/F (Code): the deterministic verify target must be
  // recorded at Step 1. Reconciling it with the frozen candidate SHA is no
  // longer a sentence the agent has to execute — the fence's `verify-coherence`
  // check compares the two (test/merge-ready-fence-lib.test.mjs, fixtures
  // 18-20). What the skill still owns is capturing the SHA and the scope.
  assert.ok(containsText(reviewCode, "その時点の candidate SHA"));
  assert.ok(
    containsText(
      reviewCode,
      "記録した SHA と freeze した target の一致は手順 13 の fence が機械判定するため、手順の各所で手作業の SHA 照合を繰り返しません。",
    ),
  );

  // SHA-change handling during code review. Two cases used to be spelled out in
  // two near-identical paragraphs; they are one branch now, but the branch must
  // still cover BOTH triggers — a change before discovery validity is confirmed,
  // and a non-fix change after it — and must state the consequence as "not
  // usable as evidence for the new target", never as retroactively invalidating
  // the prior run's own Validity.
  assert.ok(
    containsText(
      reviewCode,
      "discovery の completion / validity が確定する前に動いた場合、または **手順 7 の batch fix 以外**の理由で動いた場合",
    ),
    "review-code.md must cover both the pre-validity and the post-valid non-fix target move",
  );
  assert.ok(
    countOccurrences(
      reviewCode,
      "旧 review target / run を現在 target の evidence として扱いません。",
    ) === 1,
    "review-code.md must not retroactively mark a run's own Validity invalid on a candidate SHA change; it must state the run is no longer usable as evidence for the new target",
  );
  assert.doesNotMatch(
    reviewCode,
    /review target \/ run を invalid として扱い/,
    "review-code.md must not conflate a target change with retroactively invalidating the prior run's own Validity",
  );
  // Both triggers re-run Step 1's deterministic verify against the new SHA
  // before re-freezing.
  assert.ok(
    containsText(reviewCode, "新しい SHA に対して手順 1 の verify をやり直し、re-freeze して必要な discovery をやり直します。"),
  );
  // A fix-driven change proceeds to targeted closure without restarting discovery.
  assert.ok(
    containsText(reviewCode, "valid な discovery の後、**手順 7 の batch fix によって**動いた場合は、"),
  );
  assert.ok(containsText(reviewCode, "re-freeze はしますが手順を最初からやり直さず、"));

  // review-code.md must defer to policy Contracts rather than restating their
  // normative conditions (Fix 2): the specific prohibitions below must not reappear
  // verbatim in the skill, only a reference to the owning Contract.
  assert.ok(
    !reviewCode.includes("completed（success を含む）と混同せず未開始・判定不能・失敗をそれぞれ"),
    "review-code.md must not restate the none/unknown/failure distinction; it must reference the Acquisition & Validity Contract",
  );
  // Completion and validity are independent judgments (not a single enum), and a
  // completed-but-invalid run (e.g. stale/wrong SHA) must remain expressible.
  // The skill used to restate all three rules; that is the duplication this
  // test exists to prevent, so it now asserts the skill defers and that the
  // Kernel is where the distinction is normative.
  assert.ok(
    !containsText(
      reviewCode,
      "run を completion / validity / `none` / `unknown` / `failure` のいずれかに判定します。",
    ),
    "review-code.md must not collapse completion/validity/none/unknown/failure into a single enum",
  );
  assert.ok(
    containsText(
      reviewCode,
      "target-bound completion、run state、coverage、および binding の規範的な扱いは、いずれも `policy/core.md` が定めます。",
    ),
    "review-code.md must defer the completion/validity distinction to the Contract",
  );
  assert.ok(containsText(core, "Completion は少なくとも次を要求します。"));
  assert.ok(containsText(core, "Validity はさらに次を要求します。"));
  assert.ok(
    containsText(core, "record は `status: completed` かつ `validity: invalid` として表現します"),
    "a completed-but-invalid run must stay expressible in the Kernel's record schema",
  );
  assert.ok(
    containsText(core, "review run の状態は少なくとも `none` / `unknown` / `failure` を区別し、混同してはいけません。"),
  );
  assert.ok(
    !containsText(reviewCode, "behavior / blast radius を materially"),
    "review-code.md must not restate the discovery round-limit condition; it must reference Review stopping rules",
  );
  assert.ok(containsText(reviewCode, "Review stopping rules（`policy/core.md`）に従い"));
  assert.ok(containsText(reviewCode, "重大 finding を dismiss する際の確認要否は"));

  // Root cause 1: required review count is a gate on triage, in both skills — a
  // shortfall (invalid/unknown/failure) defers to Failure / retry, not a separate
  // "at least one valid run" rule.
  const requiredReviewGate =
    "Selection Contract で required とした review 数ぶんの `validity: valid` な run が揃うまで triage へ進みません。";
  assert.ok(containsText(reviewCode, requiredReviewGate));
  assert.ok(containsText(reviewDoc, requiredReviewGate));
  assert.ok(
    containsText(reviewCode, "揃わない run（invalid / unknown / failure）の扱いは Failure / retry"),
  );
  assert.ok(
    containsText(reviewDoc, "揃わない run（invalid / unknown / failure）の扱いは Failure / retry"),
  );

  // Root cause 2: closure (targeted closure / Closure Acquisition & Validity) is
  // required only when the candidate SHA actually changed, not unconditionally.
  assert.ok(containsText(reviewCode, "candidate SHA が変更された場合のみ"));

  // Sibling gap fix: the closure predicate is stabilized to "did this review flow
  // ever have an accepted-fix-driven target change" (including via the optional
  // 2nd discovery), not "did Step 7's SHA change specifically" — so a 2nd
  // discovery with zero accepted findings still requires targeted closure for the
  // first accepted fix, and merge without closure still requires no target change
  // at all across the whole flow.
  assert.ok(
    countOccurrences(
      reviewCode,
      "この review flow で accepted finding の fix によって target が変更された場合のみ",
    ) === 2,
    "review-code.md's Targeted closure and Closure Acquisition & Validity steps must gate on whether this review flow ever had an accepted-fix-driven target change, not just Step 7's own SHA change",
  );
  assert.ok(
    containsText(reviewCode, "手順 9 の second full discovery を挟んだ場合を含む"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "この review flow で accepted finding の fix による target 変更が一度も発生していなければ、required review 数の valid discovery と Resolution（手順 6）が完了した時点で semantic な条件が揃います。",
    ),
  );

  // Root cause 3: an unconfirmed closure defers to Failure / retry instead of
  // unconditionally retrying the same closure trigger.
  assert.ok(
    !containsText(reviewCode, "targeted closure をやり直します"),
    "review-code.md must not unconditionally retry the same closure trigger; it must defer to Failure / retry",
  );
  assert.ok(containsText(reviewCode, "確認できなければ merge せず、その後の扱いは Failure / retry"));

  // Only a Step 7 batch-fix-driven SHA change may take the
  // targeted-closure-only path; any other SHA change (parallel work, scope
  // addition, unrelated commits) routes back through Step 2's invalidate/re-freeze/
  // re-discovery handling instead of a separate SHA-change rule.
  assert.ok(
    containsText(reviewCode, "**手順 7 の batch fix 以外**の理由で動いた場合"),
  );
  assert.ok(
    containsText(reviewCode, "手順 7 の batch fix によって candidate SHA が変更された場合のみ"),
  );

  // 2x2 cell A (Executable x accepted fix): deterministic verify runs against the
  // post-fix SHA before targeted closure (pre-existing, unaffected by this round);
  // closure re-freezes the post-fix SHA as the closure target and applies
  // Selection / Execution Contract to it, so closure validity is judged against
  // the post-fix target, not Step 3's original Selection.
  assert.ok(
    containsText(
      reviewCode,
      "手順 7 の batch fix によって candidate SHA が変更された場合のみ、fix 後に手順 1 の verify を再実行し、記録した verify SHA を更新します。",
    ),
  );
  // Reconciling the closure target with the last successful verify target is
  // the fence's `verify-coherence` check now; the skill states the re-freeze
  // and the Selection/Execution that follows it.
  assert.ok(
    containsText(
      reviewCode,
      "最終的な post-fix SHA を closure target として re-freeze し、Selection Contract に従ってこの closure target を expected target として確定し、",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "Selection Contract に従ってこの closure target を expected target として確定し、確定した closure artifact set まで直近の successful deterministic verify evidence がカバーしているかを確認します。",
    ),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range: targeted closure's artifact-set coverage check re-runs
  // deterministic verify against the confirmed closure target when coverage
  // can't be confirmed, before Execution starts the closure run.
  assert.ok(
    containsText(
      reviewCode,
      "カバーしていると確認できない場合は、確定した closure target に対して deterministic verify を再実行し、成功してから Execution Contract に従って closure run を起動します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "この closure target を expected target として、targeted closure の review run に手順 5 と同じ Acquisition & Validity Contract を適用し",
    ),
  );

  // Sibling gap A (Step 10): a mismatch between the closure target and the
  // latest successful deterministic verify target must not carry over stale
  // verify evidence. The SHA comparison itself is the fence's
  // `verify-coherence` check (test/merge-ready-fence-lib.test.mjs, fixtures
  // 18-20); what stays with the skill is the artifact-scope coverage the fence
  // deliberately does not judge.
  assert.ok(
    containsText(
      reviewCode,
      "確定した closure artifact set まで直近の successful deterministic verify evidence がカバーしているかを確認します。",
    ),
  );

  // Route a material fix through a full 2nd discovery: Step 9 is an
  // optional, policy-gated 2nd full discovery inserted before targeted closure,
  // reusing the same Selection / Execution / Acquisition & Validity / Resolution
  // Contracts and the required-review-count gate as the first discovery — not a
  // new Second Discovery Contract or schema.
  assert.ok(reviewCode.includes("Second full discovery"));
  assert.ok(
    containsText(
      reviewCode,
      "Review stopping rules（`policy/core.md`）に従って 2nd full discovery が必要と判断された場合のみ、targeted closure の前に行います。",
    ),
  );
  // Sibling gap A (Step 9), direction fix: the *current* post-fix SHA is frozen
  // as the second discovery target — not the latest successful verify target,
  // which would freeze a stale SHA and miss a candidate that advanced further
  // before Step 9 ran. Comparing the frozen target against the verify target is
  // the fence's `verify-coherence` check now (test/merge-ready-fence-lib.test.mjs,
  // fixtures 18-20).
  assert.ok(
    containsText(
      reviewCode,
      "現在の post-fix SHA を second discovery target として re-freeze し、",
    ),
  );
  assert.doesNotMatch(
    reviewCode,
    /直近の successful deterministic verify target を second discovery\s*target として re-freeze/,
    "Step 9 item 1 must not freeze the latest verify target itself as the second discovery target; it must freeze the current post-fix SHA and check it against the latest verify target",
  );
  assert.ok(
    containsText(
      reviewCode,
      "Selection Contract をこの second discovery stage へ適用し、確定した target artifact set まで直近の successful deterministic verify evidence がカバーしているかを確認します。",
    ),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range: second discovery's artifact-set coverage check re-runs
  // deterministic verify against the confirmed second discovery target when
  // coverage can't be confirmed, before Execution starts full discovery.
  assert.ok(
    containsText(
      reviewCode,
      "カバーしていると確認できない場合は、確定した second discovery target に対して deterministic verify を再実行し、成功してから Execution へ進みます。",
    ),
  );
  assert.ok(
    containsText(reviewCode, "Execution Contract に従って full discovery（独立 reviewer）を"),
  );
  assert.ok(
    containsText(reviewCode, "Acquisition & Validity Contract をこの discovery run に適用します。"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "Selection で required とした review 数ぶんの valid run が揃うまで triage へ進みません。揃わない run の扱いは Failure / retry",
    ),
  );
  assert.ok(
    containsText(reviewCode, "accepted finding があれば、手順 7 と同じ batch fix semantics で"),
  );
  assert.ok(
    containsText(
      reviewCode,
      "その fix によって target が変わった場合、手順 8 と同じ",
    ),
  );
  // Non-fix target mutation inside the 2nd discovery reuses Step 2's semantics
  // rather than a Second-Discovery-specific mutation rule.
  assert.ok(
    containsText(
      reviewCode,
      "second discovery の実行中、または completion / validity 確定前後に accepted fix 以外の理由で target が変わった場合も同じ扱いです。",
    ),
  );
  // A 3rd full discovery is never triggered; the flow escalates instead, per the
  // existing Review stopping rules (no new retry counter or round-limit schema).
  assert.ok(
    containsText(
      reviewCode,
      "3rd full discovery は起動せず merge もせず、Review stopping rules（`policy/core.md`）に従って upstream task/design の不安定さを疑い、必要に応じて escalate します。",
    ),
  );
  assert.doesNotMatch(
    reviewCode,
    /discovery_round|round counter|Second Discovery Contract/,
    "review-code.md must not introduce a new round-counter schema or a Second Discovery Contract",
  );

  // Finding 3 (Code): Selection Contract's required review count gates closure
  // the same as discovery; a shortfall defers to Failure / retry.
  assert.ok(
    containsText(
      reviewCode,
      "closure 用 Selection Contract で required とした review 数ぶんの valid な closure run が揃うまで Closure Resolution へ進みません。",
    ),
  );

  // review-doc.md covers the normative document review procedure, including the new
  // Selection / Execution steps (Fix 7) and the closure validity gate (Fix 6)
  for (const phrase of [
    "Mechanical check",
    "Selection",
    "Execution & Semantic discovery",
    "Acquisition & Validity 確認",
    "Triage",
    "Fix",
    "Closure",
    "Closure Resolution",
  ]) {
    assert.ok(reviewDoc.includes(phrase), `review-doc.md missing: ${phrase}`);
  }
  // Issue #45 extended this enumeration with the expected review set; the
  // Selection step must still name every Selection Contract item it confirms.
  assert.ok(
    containsText(
      reviewDoc,
      "target SHA / range、target artifact set、reviewer / capability、required review 数、および expected review set を確定します。",
    ),
  );

  // Root cause A, cell B (Normative): a completed + valid closure run with
  // findings still gates on Resolution before completion; an accepted closure
  // finding loops back through the existing fix/mechanical-check/closure
  // procedure, and this step does not apply when Step 7's closure never fired.
  assert.ok(
    containsText(
      reviewDoc,
      "closure verification（手順 7）の finding を Resolution Contract（`policy/core.md`）に従って triage します。unresolved の finding がある間は review procedure を完了としません。",
    ),
  );
  assert.ok(containsText(reviewDoc, "accepted な closure finding があれば、手順 6〜7 と同じ procedure"));

  // Resolve discovery findings before merge (Normative sibling):
  // closure Resolution completing doesn't drop the semantic discovery (Step 5)
  // Resolution gate — review procedure completion requires both, in either order.
  assert.ok(
    containsText(
      reviewDoc,
      "closure Resolution に加えて、手順 5 の semantic discovery Resolution も完了していることが review procedure 完了の条件です。完了順序は問いません。",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "手順 7 の closure が行われなかった場合（accepted fix が無く target SHA / range も target artifact set も変更されていない場合）、この手順は不要です。",
    ),
  );

  // Gap fix: a repeating closure-finding cycle connects to this skill's existing
  // stopping condition and Review stopping rules instead of looping unbounded,
  // without restating the "## 停止条件" section verbatim.
  assert.ok(
    containsText(
      reviewDoc,
      "この cycle が繰り返し発生する場合は、本 skill の停止条件および Review stopping rules（`policy/core.md`）に従います。",
    ),
  );

  // Root cause B, cells G/H (Normative): the mechanical check target must be
  // captured at Step 1. Matching it against the target confirmed at Step 2 is
  // the fence's `verify-coherence` check now (test/merge-ready-fence-lib.test.mjs,
  // fixtures 18-20); the skill keeps capturing the target and redoing the check
  // when the target moves.
  assert.ok(containsText(reviewDoc, "その時点の target SHA / range"));
  assert.ok(
    containsText(
      reviewDoc,
      "target が動いたら mechanical check をやり直し、記録した check SHA を更新します。",
    ),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range, Normative sibling: Step 1 records what scope the mechanical
  // check covered, and Step 2 checks that scope against the confirmed target
  // artifact set, re-checking when coverage can't be confirmed. Artifact set
  // ownership stays with Selection — Step 1 only records evidence metadata.
  assert.ok(
    containsText(
      reviewDoc,
      "その mechanical check が対象とした document / artifact scope を必要な精度で記録した上で",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "target artifact set を確定したら、直近の successful mechanical-check evidence が、確定した target SHA / range と target artifact set の両方をカバーしているかを確認します。",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "selected artifact set をその mechanical check evidence がカバーしていると確認できない場合は、確定した target に対して手順 1 の mechanical check を再実行してから手順 3（semantic discovery）へ進みます。",
    ),
  );

  // 2x2 cell D (Normative x non-fix change): a target change after valid discovery
  // that isn't Step 6's accepted-finding fix invalidates the old discovery as
  // evidence for the new target and restarts from Selection through a fresh
  // semantic discovery on the new target — not a 2nd round on the same target.
  assert.ok(
    containsText(
      reviewDoc,
      "手順 6 の accepted finding batch fix 以外の理由で target SHA / range または target artifact set が変わった場合",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "新しい target に対して手順 1 の mechanical check を再実行し、Selection をやり直して、手順 3 の semantic discovery を新しい target に対して行います。",
    ),
  );

  // Invalidate discovery on artifact-set-only target changes,
  // Normative sibling: the pre-validity mutation clause must cover an
  // artifact-set-only change the same way it covers a SHA/range change, not
  // just the post-validity non-fix clause above.
  // Two near-identical paragraphs became one branch; it must still cover BOTH
  // triggers — a move before semantic discovery validity is confirmed, and a
  // non-fix move after it — and both re-run Step 1's mechanical check against
  // the new target before Selection is redone.
  assert.ok(
    containsText(
      reviewDoc,
      "手順 3 の semantic discovery の completion / validity が確定する前に動いた場合、または手順 6 の accepted finding batch fix 以外の理由で target SHA / range または target artifact set が変わった場合",
    ),
  );
  assert.ok(
    countOccurrences(
      reviewDoc,
      "旧 review target / run を現在 target の evidence として扱いません。",
    ) === 1,
  );
  assert.ok(
    containsText(
      reviewDoc,
      "新しい target に対して手順 1 の mechanical check を再実行し、Selection をやり直して、",
    ),
  );
  assert.ok(containsText(reviewDoc, "target SHA / range、target artifact set、"));

  // Invalidate discovery on artifact-set-only target changes,
  // Normative sibling: Step 3 must pass the Selection-confirmed target SHA
  // / range AND target artifact set to the reviewer trigger, not just record
  // required context after the fact.
  assert.ok(
    containsText(
      reviewDoc,
      "Execution Contract に従い、Selection で確定した target SHA / range と target artifact set を reviewer の trigger へ渡して起動します。trigger 方法、実際に渡した target と artifact set、required context を記録した上で、",
    ),
  );

  // The required count of valid runs remains the gate for *entering* triage.
  assert.ok(
    !containsText(reviewDoc, "確認できない run の finding は triage へ進めず、"),
    "review-doc.md must gate on valid (not just 'confirmable'), since invalid is a determinate Validity outcome, not an inability to confirm",
  );
  assert.ok(
    containsText(reviewDoc, "required 数の valid run が揃うことは triage へ進むための gate ですが、"),
  );

  // Issue #45 superseded the earlier "only valid runs' findings reach triage"
  // rule: `validity` is an evidence-axis judgement and is not grounds for
  // dropping a finding that a non-valid run already produced. The superseded
  // instructions must be absent, not merely contradicted further down.
  assert.ok(!containsText(reviewDoc, "valid な run の finding だけを triage へ進めます。"));
  assert.ok(!containsText(reviewDoc, "invalid / unknown / failure な run の finding は triage に使用しません。"));
  assert.ok(containsText(reviewDoc, "finding の集約対象は valid な run に限りません。"));

  assert.ok(
    containsText(reviewDoc, "closure verification 自体の completion / acquisition / validity も"),
  );

  // A fix that changes target SHA / range re-freezes the
  // closure target and applies Selection / Execution Contract to the closure
  // review run, so closure validity is judged against the post-fix target instead
  // of the pre-fix expected target from Step 2's Selection.
  assert.ok(
    containsText(reviewDoc, "成功したらその SHA / range を closure target として re-freeze し、"),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "Selection Contract（`policy/core.md`）をこの closure review run に適用します。",
    ),
  );
  assert.ok(
    containsText(reviewDoc, "この closure target を expected target として Acquisition & Validity"),
  );

  // Bind precondition evidence to selected artifact set, not just
  // SHA/range: Normative closure's artifact-set coverage check re-runs
  // mechanical check against the confirmed closure target when coverage
  // can't be confirmed, before Execution starts the closure run.
  assert.ok(
    containsText(
      reviewDoc,
      "確定した closure artifact set を、直近の mechanical-check evidence がカバーしていることを確認します。確認できない場合は、確定した closure target に対して mechanical check を再実行してから、Execution Contract（`policy/core.md`）を closure review run に適用します。",
    ),
  );

  // Finding 3 (Normative): Selection Contract's required review count gates
  // closure the same as discovery; a shortfall defers to Failure / retry.
  assert.ok(
    containsText(
      reviewDoc,
      "closure 用 Selection Contract で required とした review 数ぶんの valid な closure run が揃うまで Closure Resolution へ進みません。",
    ),
  );

  // Root cause fix (this round, cell C): closure re-runs Step 1's mechanical check
  // against the post-fix target before re-freezing it, so mechanical precondition
  // evidence is re-established for the new target rather than carried over.
  assert.ok(
    containsText(
      reviewDoc,
      "修正後の target に対して手順 1 の mechanical check を再実行し、成功したら",
    ),
  );

  // Latent gap (push-before-check E): Closure only fires on an accepted-fix-driven
  // target change; no accepted fix + no target change completes at Resolution
  // without requiring a new closure run.
  assert.ok(
    containsText(
      reviewDoc,
      "accepted finding の fix によって target SHA / range または target artifact set が変わった場合のみ行います。",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "accepted finding の fix が無く target SHA / range も target artifact set も変更されていない場合",
    ),
  );

  // Unify closure-entry predicates with the canonical review target
  // definition, skills/review-doc.md sibling: the closure predicate covers an
  // artifact-set-only change too, matching Step 2's mutation semantics and
  // policy/core.md's "review target" definition, not just target SHA / range.
  assert.doesNotMatch(
    reviewDoc,
    /accepted finding の fix によって target SHA \/ range が変わった場合のみ行います。/,
    "the Closure step's entry condition must not regress to a bare SHA/range predicate",
  );
  assert.ok(
    containsText(
      reviewDoc,
      "required review 数の valid semantic discovery と Resolution が完了した時点で review procedure を完了とし、新たな closure run を要求しません。",
    ),
  );

  // review-doc.md must not restate the 2nd-discovery-round prohibition verbatim;
  // it must reference Review stopping rules instead (Fix 2).
  assert.ok(
    !reviewDoc.includes("2 回目の full discovery を追加しません"),
    "review-doc.md must not restate the discovery round-limit condition; it must reference Review stopping rules",
  );
  assert.ok(containsText(reviewDoc, "round 数の扱いは Review stopping rules（`policy/core.md`）に従います。"));
});
