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

// ---------------------------------------------------------------------------
// Decision model
//
// This is a TEST-ONLY executable encoding of the Merge-ready completion fence
// (policy/core.md, Merge readiness and merge authority). It is not a production
// mechanism and nothing in tooling/ depends on it. Its purpose is to prove that
// the normative rules, as written, produce the intended verdict for the failure
// modes recorded in Issue #45 — rather than asserting only that certain prose
// exists.
//
// The rules encoded here, and only these:
//   R1 expected review set = required | expected(declared or observed review
//      participation) | optional. Presence alone never promotes an actor.
//   R2 positive completion evidence is target-bound; absent it, state is
//      `unknown` and never `0 findings`.
//   R3 a run whose reviewed target != final target is unusable as clean/discovery
//      evidence (evidence axis) but its findings survive (finding axis).
//   R4 merge-ready = every required|expected member's review obligation is
//      satisfied per Review stopping rules. NOT "every member completed at the
//      final target".
//   R5 optional members: `unknown` alone does not block; observed findings do.
// ---------------------------------------------------------------------------

/**
 * Classify an actor observed on the review target.
 * `participation` is what the adapter identified the surface item as.
 */
function classifyActor(actor) {
  if (actor.declaredRequired) return "required";
  if (actor.declaredAutomatic) return "expected";
  if (actor.declaredAdvisory) return "optional";
  // Observed-participant closure: only review participation promotes an actor.
  if (actor.participation === "review") return "expected";
  return "not-a-member";
}

/** Is this run usable as clean/discovery evidence for `finalTarget`? (R2, R3) */
function isTargetBoundEvidence(run, finalTarget) {
  if (!run.positiveCompletionEvidence) return false;
  // Binding must come from a field that stably represents the reviewed target.
  if (!run.reviewedTargetIsStable) return false;
  return run.reviewedTarget === finalTarget;
}

/**
 * Evaluate the fence.
 * Returns { mergeReady, blockers[] }.
 */
function evaluateFence({ finalTarget, actors, runs, findings, unresolvedThreads = 0 }) {
  const blockers = [];
  const members = [];

  for (const actor of actors) {
    const cls = classifyActor(actor);
    if (cls !== "not-a-member") members.push({ ...actor, cls });
  }

  for (const member of members) {
    const memberRuns = runs.filter((r) => r.actor === member.name);
    const bound = memberRuns.find((r) => isTargetBoundEvidence(r, finalTarget));

    // Finding axis (R3): findings survive regardless of which target produced
    // them, and regardless of the run's validity.
    const openFindings = findings.filter((f) => f.actor === member.name && !f.resolved);
    if (openFindings.length > 0) {
      blockers.push(`unresolved-finding:${member.name}:${openFindings.length}`);
    }

    if (member.cls === "optional") continue; // R5: unknown alone does not block

    // Evidence axis (R2/R3): only a target-bound run may back a `0 findings`
    // claim. Absent one, the member's state is `unknown`.
    if (!bound) {
      // R4: an unknown state only blocks where the obligation actually requires
      // fresh evidence at the final target. Review stopping rules say a bounded
      // accepted-fix closure does not re-require full discovery at the head.
      if (member.obligationSatisfiedByStoppingRules) continue;
      blockers.push(`unknown-completion:${member.name}`);
    }
  }

  if (unresolvedThreads > 0) blockers.push(`unresolved-threads:${unresolvedThreads}`);

  return { mergeReady: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Regression proofs — the five scenarios required by Issue #45.
// ---------------------------------------------------------------------------

// Shapes taken from the real incident recorded in Issue #45: an automatic
// reviewer produced a P1 on 354187da while the frozen final target was c2b99f69.
test("regression 1: PR #42 type — ancestor-target finding blocks merge-ready", () => {
  const scenario = {
    finalTarget: "c2b99f69",
    actors: [{ name: "auto-reviewer", participation: "review" }],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da", // ancestor, not the final target
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
      },
    ],
    findings: [{ actor: "auto-reviewer", reviewedTarget: "354187da", resolved: false }],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "ancestor finding must block merge-ready");
  assert.ok(
    blockers.includes("unresolved-finding:auto-reviewer:1"),
    `finding axis must survive the target move: ${blockers.join(", ")}`,
  );

  // The evidence axis must ALSO reject the ancestor run as clean evidence.
  assert.equal(
    isTargetBoundEvidence(scenario.runs[0], scenario.finalTarget),
    false,
    "a run on an ancestor target is not clean evidence for the final target",
  );

  // Resolving the finding is what clears it — not the head having moved.
  const resolved = {
    ...scenario,
    findings: [{ actor: "auto-reviewer", reviewedTarget: "354187da", resolved: true }],
    actors: [{ name: "auto-reviewer", participation: "review", obligationSatisfiedByStoppingRules: true }],
  };
  assert.equal(evaluateFence(resolved).mergeReady, true);
});

// Shape taken from the real incident: the automatic reviewer had completed on
// exactly the frozen target, and its finding was simply never collected because
// the reviewer was never in the review set.
test("regression 2: PR #51 type — finding at the final target blocks merge-ready", () => {
  const scenario = {
    finalTarget: "29447ce3",
    actors: [{ name: "auto-reviewer", participation: "review" }],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "29447ce3",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
      },
    ],
    findings: [{ actor: "auto-reviewer", reviewedTarget: "29447ce3", resolved: false }],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "a finding on the final target must block merge-ready");
  assert.ok(blockers.includes("unresolved-finding:auto-reviewer:1"));

  // The load-bearing part: the reviewer entered the set purely through observed
  // review participation, with no consumer declaration. Without that closure the
  // finding is never collected and the fence is vacuous.
  assert.equal(classifyActor(scenario.actors[0]), "expected");

  // Guard against binding on a head-following field: had the model trusted a
  // field that drifts to the head, this ancestor run would be misread as clean
  // evidence for the current head.
  const drifted = {
    actor: "auto-reviewer",
    reviewedTarget: "29447ce3",
    reviewedTargetIsStable: false,
    positiveCompletionEvidence: true,
  };
  assert.equal(
    isTargetBoundEvidence(drifted, "29447ce3"),
    false,
    "an unstable (head-following) field must not establish binding",
  );
});

test("regression 3: bounded accepted-fix does not re-require full discovery at the head", () => {
  // Review stopping rules: a bounded fix is handled by targeted closure. The
  // fence must not escalate that into "the automatic reviewer must complete
  // again at the final head".
  const scenario = {
    finalTarget: "6800b796", // post-fix head
    actors: [
      {
        name: "auto-reviewer",
        participation: "review",
        // targeted closure was judged sufficient per Review stopping rules
        obligationSatisfiedByStoppingRules: true,
      },
    ],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da", // never re-ran at the final head
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
      },
    ],
    findings: [{ actor: "auto-reviewer", reviewedTarget: "354187da", resolved: true }],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(
    mergeReady,
    true,
    `bounded closure must not be blocked on a head re-review: ${blockers.join(", ")}`,
  );

  // Contrast: without the stopping-rules satisfaction, the same shape blocks.
  const notSatisfied = {
    ...scenario,
    actors: [{ name: "auto-reviewer", participation: "review" }],
  };
  assert.deepEqual(evaluateFence(notSatisfied).blockers, ["unknown-completion:auto-reviewer"]);
});

test("regression 4: optional reviewer — unknown does not block, findings do", () => {
  const unknownOnly = {
    finalTarget: "abc1234",
    actors: [{ name: "advisory-bot", declaredAdvisory: true }],
    runs: [], // no completion evidence at all
    findings: [],
  };
  assert.equal(
    evaluateFence(unknownOnly).mergeReady,
    true,
    "an optional reviewer being unknown must not block merge-ready",
  );

  const withFinding = {
    ...unknownOnly,
    findings: [{ actor: "advisory-bot", reviewedTarget: "abc1234", resolved: false }],
  };
  const result = evaluateFence(withFinding);
  assert.equal(result.mergeReady, false, "an optional reviewer's actual finding is in scope");
  assert.ok(result.blockers.includes("unresolved-finding:advisory-bot:1"));
});

test("regression 5: ordinary non-review actors are not promoted to expected reviewers", () => {
  for (const actor of [
    { name: "human-collaborator", participation: "comment" },
    { name: "ci", participation: "status" },
    { name: "release-notes-bot", participation: "comment" },
  ]) {
    assert.equal(
      classifyActor(actor),
      "not-a-member",
      `${actor.name} must not become an expected reviewer through presence alone`,
    );
  }

  // A PR full of ordinary chatter and a green CI status is still merge-ready.
  const scenario = {
    finalTarget: "abc1234",
    actors: [
      { name: "human-collaborator", participation: "comment" },
      { name: "ci", participation: "status" },
      { name: "auto-reviewer", participation: "review" },
    ],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
      },
    ],
    findings: [],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, true, `non-review actors must not create blockers: ${blockers.join(", ")}`);
});

test("regression 2b: absence of positive completion evidence is `unknown`, never 0 findings", () => {
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "declared-auto", declaredAutomatic: true }],
    runs: [
      {
        actor: "declared-auto",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: false, // silence, not a clean result
      },
    ],
    findings: [],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "silence must not be converted into `0 findings`");
  assert.deepEqual(blockers, ["unknown-completion:declared-auto"]);
});

test("fence blocks while review threads are unresolved", () => {
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "auto-reviewer", participation: "review" }],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
      },
    ],
    findings: [],
    unresolvedThreads: 1,
  };
  assert.equal(evaluateFence(scenario).mergeReady, false);
});

// ---------------------------------------------------------------------------
// The decision model above is only meaningful if the normative source actually
// states these rules. These assertions bind the model to policy/core.md and
// skills/review-code.md so the two cannot drift apart silently.
// ---------------------------------------------------------------------------

test("core policy states the expected review set closure rule", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(containsText(core, "expected review set は、agent が選択した reviewer だけでは閉じません"));
  assert.ok(containsText(core, "consumer が configured automatic reviewer として明示している"));
  assert.ok(
    containsText(core, "取得済み evidence が、その actor による review 行為をその review target 上で識別させる"),
  );

  // Presence alone must not promote an actor.
  assert.ok(containsText(core, "review participation として識別できる"));
  assert.ok(containsText(core, "review target 上に presence があるだけでは足りず"));
  for (const negative of [
    "通常の human comment",
    "CI actor（workflow / status / check の author であること）",
    "review 以外の目的で投稿する bot",
  ]) {
    assert.ok(containsText(core, negative), `missing negative constraint: ${negative}`);
  }

  // Provider-neutrality: identification is the adapter's job, not the Kernel's.
  assert.ok(containsText(core, "どの surface item が review participation を構成するかの識別は Review Adapter"));
  assert.ok(containsText(core, "その actor を expected member とした根拠"));

  // Residual limitation is stated rather than papered over.
  assert.ok(
    containsText(
      core,
      "review participation evidence を出していない reviewer を含められません",
    ),
  );

  // optional/advisory stays non-blocking, but its findings do not.
  assert.ok(containsText(core, "completion state が `unknown` であること自体は blocker にしません"));
  assert.ok(containsText(core, "actual finding が観測された場合、その finding は Resolution Contract の対象です"));
});

test("core policy requires target-bound positive completion evidence on stable fields", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(containsText(core, "positive completion evidence は target-bound です"));
  assert.ok(containsText(core, "その target への resolvable な参照を持つ positive completion evidence"));
  assert.ok(containsText(core, "state は `unknown` であり、`0 findings` へ変換してはいけません"));

  assert.ok(containsText(core, "target を安定して表す field / surface"));
  assert.ok(
    containsText(core, "review target の移動に追随して値が変化する field / surface を binding の根拠にしてはいけません"),
  );
  assert.ok(containsText(core, "binding の根拠を記録すること"));

  // The two axes must be stated, and stated as non-interchangeable.
  assert.ok(containsText(core, "次の 2 軸で扱いを分けます。両者を混同してはいけません"));
  assert.ok(containsText(core, "**evidence 軸**"));
  assert.ok(containsText(core, "**finding 軸**"));
  assert.ok(containsText(core, "review target が移動したことだけを理由に discharge されません"));
});

test("core policy defines the merge-ready completion fence without overriding stopping rules", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("#### Merge-ready completion fence"));

  // The fence must live in the always-on merge-readiness section, not inside
  // `Review stopping rules` (which #36 Phase 1 migrates out of the Kernel).
  const fenceIndex = core.indexOf("#### Merge-ready completion fence");
  const mergeReadinessIndex = core.indexOf("### Merge readiness and merge authority");
  const stoppingRulesIndex = core.indexOf("### Review stopping rules");
  assert.ok(mergeReadinessIndex !== -1 && stoppingRulesIndex !== -1);
  assert.ok(
    fenceIndex > mergeReadinessIndex && fenceIndex < stoppingRulesIndex,
    "the fence must sit inside Merge readiness and merge authority",
  );

  assert.ok(containsText(core, "merge-ready を宣言する前に、次を最後の action として評価します"));
  assert.ok(containsText(core, "この fence は Review stopping rules を置き換えず、参照します"));
  assert.ok(containsText(core, "Selection Contract に従って expected review set を閉じる"));
  assert.ok(containsText(core, "positive completion evidence が無い member を `0 findings` へ変換しない"));
  assert.ok(containsText(core, "安定 evidence 由来の reviewed target へ帰属させる"));
  assert.ok(containsText(core, "ancestor target で発見された finding も対象とする"));
  assert.ok(containsText(core, "unresolved review thread が 0 であることを確認する"));

  // R4: obligation satisfaction, NOT universal completion at the final target.
  assert.ok(
    containsText(core, "review obligation が Review stopping rules に従って satisfied している"),
  );
  assert.ok(containsText(core, "全 member が final target で completed であることを要求するものではありません"));
  assert.ok(
    containsText(core, "同じ reviewer による final target の full re-review を強制しません"),
  );

  // Ordering property: the fence is invalidated by later state changes.
  assert.ok(
    containsText(core, "state が変化した場合、その fence 評価は無効となり、再評価します"),
  );

  // merge-ready still is not merge authority.
  assert.ok(containsText(core, "merge を実行してよいという判断とは同義ではありません"));
});

test("Resolution Contract keeps ancestor-target findings in scope", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  assert.ok(
    containsText(
      core,
      "確定した review target より前の target（ancestor）で発見された finding も Resolution Contract の対象である",
    ),
  );
});

test("review-code skill carries the procedural detail for the fence", async () => {
  const skill = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  // Selection: close the set, record the basis, do not promote by presence.
  assert.ok(containsText(skill, "expected review set を閉じます"));
  assert.ok(containsText(skill, "自分が trigger した reviewer だけを set に入れて終わりにせず"));
  assert.ok(containsText(skill, "presence だけを理由に expected member 化しません"));

  // Acquisition: target-bound, stable field, record the binding basis.
  assert.ok(containsText(skill, "resolvable な参照を持つ positive completion evidence が必要です"));
  assert.ok(containsText(skill, "安定して表す field / surface を使います"));
  assert.ok(containsText(skill, "binding の根拠にしてはいけません"));
  assert.ok(containsText(skill, "どちらが安定かを確認できない場合、その binding は成立しておらず `unknown` です"));

  // Aggregation must not drop findings from non-valid runs.
  assert.ok(containsText(skill, "finding の集約対象は valid な run に限りません"));
  assert.ok(containsText(skill, "`validity` は evidence 軸の判定であり、finding を捨ててよい根拠ではありません"));

  // Merge-ready: fence evaluated last, invalidated by later change.
  assert.ok(containsText(skill, "merge-ready を宣言する直前の最後の action として"));
  assert.ok(containsText(skill, "会話内で既に見た snapshot をこの判定の根拠にしません"));
  assert.ok(containsText(skill, "fence 評価は無効です。再評価してから宣言します"));
  assert.ok(containsText(skill, "全 member が final target で completed であることを要求しません"));

  // Provider observations stay observations.
  assert.ok(containsText(skill, "check/status surface を一切生成しませんでした"));
  assert.ok(containsText(skill, "green な status が review 完了ではなく **review 未実施**を意味する"));
  assert.ok(containsText(skill, "capability/profile 側で再検証可能な observed evidence として扱います"));
});

test("the Kernel states the fence without hard-coding provider specifics", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const added = core.slice(core.indexOf("#### Selection Contract"));

  for (const providerToken of [
    "Codex",
    "CodeRabbit",
    "chatgpt",
    "original_commit_id",
    "commit_id",
    "pulls/",
    "github.com",
  ]) {
    assert.ok(
      !added.includes(providerToken),
      `Kernel must not hard-code provider specifics, found: ${providerToken}`,
    );
  }
});
