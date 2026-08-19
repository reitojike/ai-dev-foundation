import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  // Reviewed-target evidence consistency: when record.target_sha and the acquired
  // evidence's reviewed target both exist, they must agree; disagreement is invalid,
  // and an unconfirmable reviewed target is unknown (not silently valid).
  assert.ok(
    containsText(
      core,
      "record の `target_sha` と acquired evidence 上の reviewed target が両方存在する場合、両者は一致していなければなりません。",
    ),
  );
  assert.ok(containsText(core, "一致しない場合は invalid です。"));
  assert.ok(
    containsText(core, "reviewed target を Validity 判定に必要な精度で確認できない場合は unknown です。"),
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

  // Stopping rules, including the closure Acquisition & Validity gate before merge
  assert.ok(core.includes("closure completion / acquisition / validity 確認"));
  assert.ok(
    containsText(
      core,
      "accepted finding の batch fix によって candidate SHA が変更された場合のみ targeted closure を行い、その review run も Acquisition & Validity Contract に従って completion / acquisition / validity を確認してから merge します。",
    ),
  );
  // Canonical policy: no accepted fix + no SHA change completes via the required
  // review count's valid discovery + Resolution, with no new closure run required
  // (matches skills/review-code.md's existing Executable procedure).
  assert.ok(
    containsText(
      core,
      "accepted fix が無く candidate SHA が変更されていない場合は、required review 数の valid discovery と Resolution の完了をもって、新たな closure run を要求せずに merge できます。",
    ),
  );
  assert.ok(containsText(core, "full discovery は原則 1 round です。"));
  assert.ok(containsText(core, "materially 変えた場合のみ 2 round 目を許容します。"));
  assert.ok(core.includes("semantic discovery（1 round）"));
  // Canonical policy: Normative closure is likewise conditioned on an accepted-fix
  // target change, not unconditional (matches skills/review-doc.md's procedure),
  // and re-runs mechanical check against the post-fix target first (Finding 2).
  assert.ok(
    containsText(
      core,
      "accepted finding の fix によって target SHA / range が変更された場合のみ、新しい target に対して mechanical check を再実行してから closure verification を行い、その review run も Acquisition & Validity Contract に従って completion / acquisition / validity を確認します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "accepted fix が無く target が変更されていない場合は、required review 数の valid semantic discovery と Resolution の完了をもって、新たな closure run を要求せずに review を完了できます。",
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
  // The Normative accepted-fix branch re-runs mechanical check before closure
  // verification, without adding a 2nd semantic discovery round.
  assert.ok(containsText(core, "mechanical check -> closure verification"));

  // Observed evidence stays a general principle, not a permanent provider rule
  assert.ok(containsText(core, "expected trigger behavior は completion evidence と同義ではありません。"));
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // The generated consumer adapter must be self-contained: it must not reference
  // Foundation-repo-only skill paths that are never distributed to the consumer.
  assert.ok(containsText(core, "実行手順（review skill）は Foundation リポジトリ側に別途保持し、"));
  assert.doesNotMatch(core, /skills\/review-code\.md|skills\/review-doc\.md/);
});

test("review skills document procedure without duplicating normative rules", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  for (const skill of [reviewCode, reviewDoc]) {
    assert.ok(skill.includes("policy/core.md"), "skill must reference policy/core.md");
    assert.doesNotMatch(
      skill,
      /"target_sha": "\.\.\."/,
      "skill must not duplicate the Acquisition & Validity record schema from policy",
    );
    // Neither skill restates the drip-fix prohibition; both defer to Resolution Contract.
    assert.doesNotMatch(skill, /drip fix/, "skill must reference Resolution Contract instead of restating drip fix");
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
    "Merge",
    "Adapter boundary",
    "Manual review pilot",
  ]) {
    assert.ok(reviewCode.includes(phrase), `review-code.md missing: ${phrase}`);
  }
  assert.ok(containsText(reviewCode, "Claude / Codex / CodeRabbit"));

  // SHA-change handling during code review: pre-validity change invalidates the run
  // and re-freezes; a post-discovery fix-driven change proceeds to targeted closure
  // without restarting discovery from scratch.
  assert.ok(
    containsText(reviewCode, "その review target / run を invalid として扱い、新しい SHA で re-freeze して"),
  );
  assert.ok(
    containsText(reviewCode, "valid な discovery の後、手順 7 の batch fix によって SHA が変わった場合は、"),
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
  assert.ok(
    !containsText(
      reviewCode,
      "run を completion / validity / `none` / `unknown` / `failure` のいずれかに判定します。",
    ),
    "review-code.md must not collapse completion/validity/none/unknown/failure into a single enum",
  );
  assert.ok(containsText(reviewCode, "completion と validity は独立した判定とし"));
  assert.ok(
    containsText(reviewCode, "target SHA / artifact set 等が一致しない completed run は invalid として表現できます"),
  );
  assert.ok(containsText(reviewCode, "`none` / `unknown` / `failure` は completion / validity と混同せず"));
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
  assert.ok(
    containsText(
      reviewCode,
      "candidate SHA が変更されていなければ、required review 数の valid discovery と Resolution が完了した時点で merge します。",
    ),
  );

  // Root cause 3: an unconfirmed closure defers to Failure / retry instead of
  // unconditionally retrying the same closure trigger.
  assert.ok(
    !containsText(reviewCode, "targeted closure をやり直します"),
    "review-code.md must not unconditionally retry the same closure trigger; it must defer to Failure / retry",
  );
  assert.ok(containsText(reviewCode, "確認できなければ merge せず、その後の扱いは Failure / retry"));

  // Finding 1 (Codex P1): only a Step 7 batch-fix-driven SHA change may take the
  // targeted-closure-only path; any other SHA change (parallel work, scope
  // addition, unrelated commits) routes back through Step 2's invalidate/re-freeze/
  // re-discovery handling instead of a separate SHA-change rule.
  assert.ok(
    containsText(reviewCode, "手順 7 の batch fix 以外の理由で candidate SHA が変わった場合"),
  );
  assert.ok(
    containsText(reviewCode, "手順 7 の batch fix によって candidate SHA が変更された場合のみ"),
  );

  // Root cause fix (this round, cell B): a non-fix SHA change must re-run Step 1's
  // deterministic verify against the new SHA before re-freezing, since mechanical/
  // deterministic precondition evidence does not carry over across a target change.
  assert.ok(
    containsText(
      reviewCode,
      "新しい SHA に対して手順 1 の deterministic verify を再実行し、成功したら",
    ),
  );

  // 2x2 cell A (Executable x accepted fix): deterministic verify runs against the
  // post-fix SHA before targeted closure (pre-existing, unaffected by this round);
  // closure re-freezes the post-fix SHA as the closure target and applies
  // Selection / Execution Contract to it, so closure validity is judged against
  // the post-fix target, not Step 3's original Selection.
  assert.ok(
    containsText(
      reviewCode,
      "手順 7 の batch fix によって candidate SHA が変更された場合のみ、fix 後に手順 1 の verify を再実行します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "修正後の SHA を closure target として re-freeze し、Selection Contract に従ってこの closure target を expected target として確定し、Execution Contract に従って closure run を起動します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "この closure target を expected target として、targeted closure の review run に手順 5 と同じ Acquisition & Validity Contract を適用し",
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
  ]) {
    assert.ok(reviewDoc.includes(phrase), `review-doc.md missing: ${phrase}`);
  }
  assert.ok(
    containsText(
      reviewDoc,
      "target SHA / range、target artifact set、reviewer / capability、required review 数を確定します。",
    ),
  );

  // 2x2 cell D (Normative x non-fix change): a target change after valid discovery
  // that isn't Step 6's accepted-finding fix invalidates the old discovery as
  // evidence for the new target and restarts from Selection through a fresh
  // semantic discovery on the new target — not a 2nd round on the same target.
  assert.ok(
    containsText(
      reviewDoc,
      "手順 6 の accepted finding batch fix 以外の理由で target SHA / range が変わった場合",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "re-freeze して手順 2（Selection）からやり直し、手順 3 の semantic discovery を新しい target に対して行います。",
    ),
  );

  // Root cause fix (this round, cell D): a non-fix target change must also re-run
  // Step 1's mechanical check against the new target before re-freezing, matching
  // review-code.md's cell B fix.
  assert.ok(
    containsText(
      reviewDoc,
      "新しい target に対して手順 1 の mechanical check を再実行し、成功したら",
    ),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "Execution Contract に従い reviewer を起動し、trigger 方法と required context を記録した上で、",
    ),
  );
  assert.ok(containsText(reviewDoc, "target SHA / range、target artifact set、"));

  // Only valid runs' findings may reach triage; invalid/unknown/failure runs must not,
  // matching review-code.md's "valid な run から finding を集約し" gate (Fix, Codex P2).
  assert.ok(
    !containsText(reviewDoc, "確認できない run の finding は triage へ進めず、"),
    "review-doc.md must gate on valid (not just 'confirmable'), since invalid is a determinate Validity outcome, not an inability to confirm",
  );
  assert.ok(containsText(reviewDoc, "valid な run の finding だけを triage へ進めます。"));
  assert.ok(containsText(reviewDoc, "invalid / unknown / failure な run の finding は triage に使用しません。"));

  assert.ok(
    containsText(reviewDoc, "closure verification 自体の completion / acquisition / validity も"),
  );

  // Finding 2 (Codex P1): a fix that changes target SHA / range re-freezes the
  // closure target and applies Selection / Execution Contract to the closure
  // review run, so closure validity is judged against the post-fix target instead
  // of the pre-fix expected target from Step 2's Selection.
  assert.ok(
    containsText(reviewDoc, "成功したらその SHA / range を closure target として re-freeze し、"),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "Selection / Execution Contract（`policy/core.md`）を closure review run に適用します。",
    ),
  );
  assert.ok(
    containsText(reviewDoc, "この closure target を expected target として Acquisition & Validity"),
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
      "accepted finding の fix によって target SHA / range が変わった場合のみ行います。",
    ),
  );
  assert.ok(
    containsText(reviewDoc, "accepted finding の fix が無く target も変更されていない場合"),
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
