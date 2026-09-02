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
// TEST-ONLY executable encoding of the Merge-ready completion fence
// (policy/core.md, Merge readiness and merge authority). Not a production
// mechanism; nothing in tooling/ depends on it. Its purpose is to prove that
// the normative rules, as written, yield the intended verdict for the failure
// modes recorded in Issue #45 — rather than only asserting that prose exists.
//
// Encoded rules, and only these:
//   R1 expected review set = required | expected(declared automatic, or observed
//      review participation) | optional. Presence alone never promotes an actor.
//      An explicit consumer declaration outranks observed evidence.
//   R2 positive completion evidence is target-bound, and binding must rest on a
//      field that stably represents the reviewed target. Absent either, the
//      member's target completion state is `unknown` — never `0 findings`.
//   R3 two axes. A run whose reviewed target != final target is unusable as
//      clean/discovery evidence (evidence axis) but its findings survive
//      (finding axis).
//   R4 merge-ready = EVERY member of the expected review set — including
//      optional/advisory — has its review obligation satisfied, where the
//      obligation is the one policy/core.md defines per class. This does not
//      demand a fresh full re-review at every accepted fix; the narrow
//      post-fix exception defines that boundary.
//   R5 optional members: `unknown` alone does not block; observed findings do.
//   R6 a required member cannot be exempted by declaring non-participation.
// ---------------------------------------------------------------------------

/**
 * Classify an actor observed on the review target.
 * `participation` is what the adapter identified the surface item as.
 * Explicit consumer declarations take precedence over observed evidence.
 */
function classifyActor(actor) {
  if (actor.declaredRequired) return "required";
  if (actor.declaredAdvisory) return "optional";
  if (actor.declaredAutomatic) return "expected";
  // Observed-participant closure: only review participation promotes an actor.
  if (actor.participation === "review") return "expected";
  return "not-a-member";
}

/** Is this run usable as clean/discovery evidence for `finalTarget`? (R2) */
function isTargetBoundEvidence(run, finalTarget) {
  if (!run.positiveCompletionEvidence) return false;
  // Binding must come from a field that stably represents the reviewed target.
  if (!run.reviewedTargetIsStable) return false;
  return run.reviewedTarget === finalTarget;
}

/**
 * Findings owed by a member (finding axis, R3).
 *
 * Deliberately DERIVED from the member's runs rather than taken as a free
 * input. The finding axis claims a finding's fate does not depend on whether
 * its producing run is target-bound; deriving it here is what makes that claim
 * falsifiable. An implementation that discharged findings on a target move
 * would filter on `isTargetBoundEvidence` at this exact spot — and
 * `finding axis is falsifiable` below would catch it.
 */
function outstandingFindings(member, runs, finalTarget) {
  const owed = [];
  for (const run of runs.filter((r) => r.actor === member.name)) {
    for (const finding of run.findings ?? []) {
      if (finding.resolved) continue;
      owed.push({
        ...finding,
        reviewedTarget: run.reviewedTarget,
        bound: run.reviewedTarget === finalTarget,
      });
    }
  }
  return owed;
}

/**
 * Evaluate the fence. Returns { mergeReady, blockers[] }.
 *
 * Gates are derived from observable inputs (runs, findings, declared class,
 * declared non-participation) wherever the state is representable. Two inputs
 * remain judgements rather than derivations, and both are ones policy/core.md
 * requires the agent to RECORD, so neither is an unstated intention:
 *   - `boundedClosureSufficient` — the Review stopping rules decision that
 *     targeted closure suffices for every target move since the member's
 *     completion.
 *   - `runInFlightAtCurrentTarget` — whether a run is still running; not
 *     derivable from a terminal-run list.
 * `completedAtPreFixTarget` is NOT an input: whether the member ever reached
 * `completed@target` is derivable from its runs, and deriving it is what makes
 * the precondition falsifiable.
 */
function evaluateFence({ finalTarget, actors, runs, findingsRequireTriage = true }) {
  const blockers = [];
  const members = actors
    .map((actor) => ({ ...actor, cls: classifyActor(actor) }))
    .filter((m) => m.cls !== "not-a-member");

  for (const member of members) {
    // Finding axis (R3): applies to every class, regardless of the producing
    // run's validity or target, and regardless of non-participation. Declaring
    // non-participation never discharges a finding already produced.
    const owed = outstandingFindings(member, runs, finalTarget);
    if (owed.length > 0) blockers.push(`unresolved-finding:${member.name}:${owed.length}`);
    if (findingsRequireTriage) {
      const untriaged = owed.filter((f) => !f.triage);
      if (untriaged.length > 0) blockers.push(`untriaged-finding:${member.name}:${untriaged.length}`);
    }

    const memberRuns = runs.filter((r) => r.actor === member.name);
    const bound = memberRuns.some((r) => isTargetBoundEvidence(r, finalTarget));

    if (member.cls === "required") {
      // A required run's validity is judged against the expected target of the
      // review STAGE it belongs to — not against the final target. Comparing
      // to finalTarget here would demand a re-review at every accepted fix,
      // the opposite of what the stopping rules allow.
      const validForItsStage = memberRuns.some((r) =>
        isTargetBoundEvidence(r, r.stageTarget ?? finalTarget),
      );
      if (!validForItsStage && !member.selectionChangedToDropRequired) {
        blockers.push(`required-run-missing:${member.name}`);
      }
      continue;
    }

    if (member.cls === "optional") continue; // R5: state is never a blocker

    // expected (R4): the target completion state must be `completed@target` or
    // `declined`. The sole exception is the narrow post-fix carry-over, and it
    // requires ALL of its preconditions — it is not a free pass. Note this
    // branch is reached only for `expected`; `required` returned above, so the
    // exception can never discharge a required obligation.
    // Derived, not supplied: did this member ever reach `completed@target` at
    // some target in this flow? A member that never completed can never claim
    // the exception, however the stopping-rules decision was recorded.
    const everCompleted = memberRuns.some((r) => isTargetBoundEvidence(r, r.reviewedTarget));

    const exceptionApplies =
      member.boundedClosureSufficient === true &&
      everCompleted && // never completed => no exception
      member.runInFlightAtCurrentTarget !== true; // must await a terminal state

    if (!bound && !member.declinedParticipation && !exceptionApplies) {
      blockers.push(`unknown-completion:${member.name}`);
    }
  }

  return { mergeReady: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Regression proofs — the five scenarios required by Issue #45.
// ---------------------------------------------------------------------------

// Shape taken from the real incident recorded in Issue #45: an automatic
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
        findings: [{ id: "P1", resolved: false }],
      },
    ],
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

  // Resolving the finding is what clears the finding axis — and nothing else
  // changes here, so the assertion isolates one variable. The member's own
  // completion at the new target is a separate obligation, checked below.
  const resolved = structuredClone(scenario);
  resolved.runs[0].findings[0].resolved = true;
  assert.deepEqual(evaluateFence(resolved).blockers, ["unknown-completion:auto-reviewer"]);
});

test("finding axis is falsifiable: a target move alone must not discharge a finding", () => {
  // Same ancestor finding, but the head has moved on twice more. If the model
  // discharged findings whose run is no longer target-bound, this would pass as
  // merge-ready. It must not.
  for (const finalTarget of ["c2b99f69", "6800b796", "deadbeef"]) {
    const scenario = {
      finalTarget,
      actors: [{ name: "auto-reviewer", participation: "review" }],
      runs: [
        {
          actor: "auto-reviewer",
          reviewedTarget: "354187da",
          reviewedTargetIsStable: true,
          positiveCompletionEvidence: true,
          findings: [{ id: "P1", resolved: false }],
        },
      ],
    };
    assert.equal(
      evaluateFence(scenario).mergeReady,
      false,
      `finding must survive the move to ${finalTarget}`,
    );
  }

  // And the converse: the finding is owed even though its run is not bound.
  const owed = outstandingFindings(
    { name: "auto-reviewer" },
    [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P1", resolved: false }],
      },
    ],
    "c2b99f69",
  );
  assert.equal(owed.length, 1);
  assert.equal(owed[0].bound, false, "the owed finding is explicitly not target-bound");
});

// Shape taken from the real incident: the automatic reviewer had completed on
// exactly the frozen target, and its finding was never collected because the
// reviewer was never in the review set.
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
        findings: [{ id: "P2", resolved: false }],
      },
    ],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "a finding on the final target must block merge-ready");
  assert.ok(blockers.includes("unresolved-finding:auto-reviewer:1"));

  // The load-bearing part: the reviewer entered the set purely through observed
  // review participation, with no consumer declaration. Without that closure the
  // finding is never collected and the fence is vacuous.
  assert.equal(classifyActor(scenario.actors[0]), "expected");

  // Guard against binding on a head-following field: had the model trusted a
  // field that drifts to the head, an ancestor run would be misread as clean
  // evidence for the current head.
  assert.equal(
    isTargetBoundEvidence(
      { reviewedTarget: "29447ce3", reviewedTargetIsStable: false, positiveCompletionEvidence: true },
      "29447ce3",
    ),
    false,
    "an unstable (head-following) field must not establish binding",
  );
});

test("regression 3: bounded accepted-fix does not re-require full discovery at the head", () => {
  // Review stopping rules: a bounded fix is handled by targeted closure. The
  // fence must not escalate that into "the automatic reviewer must complete
  // again at the final head". The member's ancestor finding is resolved, and
  // its silence is not being used as clean evidence for the new head.
  const scenario = {
    finalTarget: "6800b796", // post-fix head
    actors: [
      {
        name: "auto-reviewer",
        participation: "review",
        boundedClosureSufficient: true,
      },
    ],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da", // completed here; never re-ran at the head
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P1", resolved: true }],
      },
    ],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(
    mergeReady,
    true,
    `bounded closure must not be blocked on a head re-review: ${blockers.join(", ")}`,
  );

  // Contrast: absent a recorded stopping-rules decision, an expected member
  // that never completed at the final target blocks. The exception must be
  // claimed explicitly — it is not the default.
  const noDecision = structuredClone(scenario);
  delete noDecision.actors[0].boundedClosureSufficient;
  assert.deepEqual(evaluateFence(noDecision).blockers, ["unknown-completion:auto-reviewer"]);
});

test("the post-fix exception requires every one of its preconditions", () => {
  // The exception was over-broad in two independent ways: it could exempt a
  // member that had never completed at all, and it could exempt waiting for a
  // run already in flight at the current target.
  //
  // Both routes into the `expected` class are exercised. Keying only on
  // observed participation left per-precondition mutations scoped to
  // `declaredAutomatic` members alive — and a declared automatic reviewer is
  // exactly the actor shape of the PR #51 incident.
  for (const route of [{ participation: "review" }, { declaredAutomatic: true }]) {
    const label = JSON.stringify(route);
    const priorCompletion = {
      actor: "auto-reviewer",
      reviewedTarget: "354187da", // completed at an earlier target in this flow
      reviewedTargetIsStable: true,
      positiveCompletionEvidence: true,
      findings: [],
    };
    const base = {
      finalTarget: "6800b796",
      actors: [{ name: "auto-reviewer", ...route, boundedClosureSufficient: true }],
      runs: [priorCompletion],
    };
    assert.equal(evaluateFence(base).mergeReady, true, `all preconditions met ${label}`);

    // (a) never completed anywhere in this flow => the exception must not
    // apply, or the member's initial completion obligation is bypassed.
    const neverCompleted = structuredClone(base);
    neverCompleted.runs = [];
    assert.deepEqual(
      evaluateFence(neverCompleted).blockers,
      ["unknown-completion:auto-reviewer"],
      `never-completed must not get the exception ${label}`,
    );

    // (a') completed, but only per an unstable (head-following) field => the
    // completion was never established, so the exception must not apply.
    const unstable = structuredClone(base);
    unstable.runs[0].reviewedTargetIsStable = false;
    assert.deepEqual(
      evaluateFence(unstable).blockers,
      ["unknown-completion:auto-reviewer"],
      `unstable binding must not establish the prior completion ${label}`,
    );

    // (b) a run is in flight at the current target => must await it. Exempting
    // here is exactly the PR #51 late-arrival failure mode.
    const inFlight = structuredClone(base);
    inFlight.actors[0].runInFlightAtCurrentTarget = true;
    assert.deepEqual(
      evaluateFence(inFlight).blockers,
      ["unknown-completion:auto-reviewer"],
      `in-flight run must be awaited ${label}`,
    );

    // (c) no recorded stopping-rules decision => not the default.
    const noDecision = structuredClone(base);
    delete noDecision.actors[0].boundedClosureSufficient;
    assert.deepEqual(
      evaluateFence(noDecision).blockers,
      ["unknown-completion:auto-reviewer"],
      `the exception must be claimed explicitly ${label}`,
    );
  }
});

test("the post-fix exception can never discharge a required member", () => {
  // The exception lives in the `expected` bullet only. An implementation that
  // honoured it in the required branch would let a required reviewer be
  // exempted without a valid run or an explicit Selection change.
  const scenario = {
    finalTarget: "abc1234",
    actors: [
      {
        name: "required-reviewer",
        declaredRequired: true,
        boundedClosureSufficient: true,
      },
    ],
    runs: [],
  };
  assert.deepEqual(evaluateFence(scenario).blockers, ["required-run-missing:required-reviewer"]);
});

test("a required run stays valid against its own stage target after the head moves", () => {
  // policy/core.md judges a required run's validity against the expected
  // target of the stage it belongs to, NOT the final target. Comparing to the
  // final target would demand a fresh required run at every accepted fix —
  // the opposite of what the stopping rules allow, and the shape of this very
  // PR (independent discovery at an earlier target, closure at the head).
  const scenario = {
    finalTarget: "46fc0ea",
    actors: [{ name: "independent-reviewer", declaredRequired: true }],
    runs: [
      {
        actor: "independent-reviewer",
        reviewedTarget: "e11ee55",
        stageTarget: "e11ee55", // the discovery stage's expected target
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "F1", resolved: true, triage: "fix" }],
      },
    ],
  };
  assert.deepEqual(
    evaluateFence(scenario).blockers,
    [],
    "a discovery-stage run must not be invalidated by a later closure target",
  );

  // But a run that was not valid even for its own stage still blocks.
  const invalidForStage = structuredClone(scenario);
  invalidForStage.runs[0].stageTarget = "some-other-target";
  assert.deepEqual(evaluateFence(invalidForStage).blockers, [
    "required-run-missing:independent-reviewer",
  ]);
});

test("an optional member's unresolved finding blocks merge-ready via step 7", () => {
  // Step 7 must evaluate the whole expected review set. Scoping it to
  // `required ∪ expected` would leave the optional member's Resolution
  // obligation defined but never applied.
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "advisory-bot", declaredAdvisory: true }],
    runs: [
      {
        actor: "advisory-bot",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P3", resolved: false, triage: "needs-verification" }],
      },
    ],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "a triaged-but-unresolved optional finding still blocks");
  assert.deepEqual(blockers, ["unresolved-finding:advisory-bot:1"]);
});

test("expected membership survives a target move (ancestor-only participation)", () => {
  // Closure round: keying membership off the *current* target would drop a
  // reviewer that only ever participated on an ancestor, and its ancestor
  // findings would escape collection — reopening the PR #42 failure mode.
  const ancestorOnly = {
    name: "auto-reviewer",
    participation: "review",
    participationTargets: ["354187da"], // never reappeared at the final target
  };
  assert.equal(
    classifyActor(ancestorOnly),
    "expected",
    "an ancestor-only participant remains an expected member",
  );

  const scenario = {
    finalTarget: "6800b796",
    actors: [ancestorOnly],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P1", resolved: false, triage: "fix" }],
      },
    ],
  };
  assert.ok(
    evaluateFence(scenario).blockers.includes("unresolved-finding:auto-reviewer:1"),
    "the ancestor finding must still be collected after the target moved",
  );
});

test("regression 4: optional reviewer — unknown does not block, findings do", () => {
  const unknownOnly = {
    finalTarget: "abc1234",
    actors: [{ name: "advisory-bot", declaredAdvisory: true }],
    runs: [], // no completion evidence at all
  };
  assert.equal(
    evaluateFence(unknownOnly).mergeReady,
    true,
    "an optional reviewer being unknown must not block merge-ready",
  );

  const withFinding = {
    ...unknownOnly,
    runs: [
      {
        actor: "advisory-bot",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P3", resolved: false }],
      },
    ],
  };
  const result = evaluateFence(withFinding);
  assert.equal(result.mergeReady, false, "an optional reviewer's actual finding is in scope");
  assert.ok(result.blockers.includes("unresolved-finding:advisory-bot:1"));

  // Precedence: an explicit advisory declaration outranks an observed review
  // act, so performing a review does not silently promote it to a blocker.
  assert.equal(classifyActor({ name: "advisory-bot", declaredAdvisory: true, participation: "review" }), "optional");
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
        findings: [],
      },
    ],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, true, `non-review actors must not create blockers: ${blockers.join(", ")}`);
});

test("regression 6: a required member is not exempted by declaring non-participation", () => {
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "required-reviewer", declaredRequired: true, declinedParticipation: true }],
    runs: [], // declined, so no run
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "a required reviewer cannot self-exempt by declining");
  assert.deepEqual(blockers, ["required-run-missing:required-reviewer"]);

  // Only an explicit Selection change (or a valid run) discharges it.
  const reselected = structuredClone(scenario);
  reselected.actors[0].selectionChangedToDropRequired = true;
  assert.equal(evaluateFence(reselected).mergeReady, true);

  // An expected member's *completion* obligation may be discharged by declining.
  assert.equal(
    evaluateFence({
      finalTarget: "abc1234",
      actors: [{ name: "auto", declaredAutomatic: true, declinedParticipation: true }],
      runs: [],
    }).mergeReady,
    true,
  );
});

test("declining non-participation never discharges a finding already produced", () => {
  // The exemption covers the completion obligation only. A reviewer that filed
  // a finding on an ancestor target and then declined at the new target still
  // owes that finding's Resolution — otherwise the PR #42 failure mode reopens
  // through the decline path.
  const scenario = {
    finalTarget: "6800b796",
    actors: [{ name: "auto-reviewer", declaredAutomatic: true, declinedParticipation: true }],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "354187da", // ancestor
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P1", resolved: false, triage: "fix" }],
      },
    ],
  };

  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "a declined member still owes Resolution for findings it produced");
  assert.deepEqual(blockers, ["unresolved-finding:auto-reviewer:1"]);

  // A permissive implementation — `if (member.declinedParticipation) continue;`
  // placed before the finding axis — would return merge-ready here. That is the
  // specific wrong implementation this test exists to reject.
  const resolvedNow = structuredClone(scenario);
  resolvedNow.runs[0].findings[0].resolved = true;
  assert.equal(evaluateFence(resolvedNow).mergeReady, true, "resolving it is what clears the block");
});

test("silence is `unknown`, never 0 findings, when relied on as clean evidence", () => {
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "declared-auto", declaredAutomatic: true }],
    runs: [
      {
        actor: "declared-auto",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: false, // silence, not a clean result
        findings: [],
      },
    ],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false, "silence must not be converted into `0 findings`");
  assert.deepEqual(blockers, ["unknown-completion:declared-auto"]);
});

test("fence blocks while a finding on a review surface has not been triaged", () => {
  // Derived from the finding itself, not from a caller-supplied count: a
  // finding with no triage category is untriaged, and blocks on that ground
  // separately from being unresolved.
  const scenario = {
    finalTarget: "abc1234",
    actors: [{ name: "auto-reviewer", participation: "review" }],
    runs: [
      {
        actor: "auto-reviewer",
        reviewedTarget: "abc1234",
        reviewedTargetIsStable: true,
        positiveCompletionEvidence: true,
        findings: [{ id: "P2", resolved: false }], // no triage category
      },
    ],
  };
  const { mergeReady, blockers } = evaluateFence(scenario);
  assert.equal(mergeReady, false);
  assert.ok(blockers.includes("untriaged-finding:auto-reviewer:1"));

  // Assigning a triage category clears the triage blocker but not Resolution:
  // policy states a triage category alone is not Resolution completion.
  const triaged = structuredClone(scenario);
  triaged.runs[0].findings[0].triage = "needs-verification";
  const after = evaluateFence(triaged);
  assert.ok(!after.blockers.some((b) => b.startsWith("untriaged-finding")));
  assert.ok(after.blockers.includes("unresolved-finding:auto-reviewer:1"));
});

// ---------------------------------------------------------------------------
// The decision model above is only meaningful if the normative source actually
// states these rules. These assertions bind the model to policy/core.md and the
// review skills so the two cannot drift apart silently.
// ---------------------------------------------------------------------------

test("core policy states the expected review set closure rule", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(containsText(core, "expected review set は、agent が選択した reviewer だけでは閉じません"));
  assert.ok(containsText(core, "consumer が configured automatic reviewer として明示している"));
  assert.ok(
    containsText(core, "取得済み evidence が、その actor による review 行為をその review target 上で識別させる"),
  );
  // Membership must carry across target moves within the same review flow,
  // or an ancestor-only participant silently leaves the set.
  assert.ok(containsText(core, "**この判定は current target に限りません。**"));
  assert.ok(
    containsText(core, "ancestor target を含むいずれかの target 上で review 行為を識別できた actor は、以降の target でも expected member として残ります"),
  );
  assert.ok(containsText(core, "target が移動しただけで member から外してはいけません"));

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

  // Precedence between overlapping classes must be stated.
  assert.ok(containsText(core, "consumer による明示的な宣言が observed evidence に優先します"));
  assert.ok(containsText(core, "consumer が advisory と宣言した reviewer は、実際に review 行為を行っても optional のまま"));

  // The declaration must have a stated home, so agents do not diverge on where
  // to look for it. Issue #72 Phase 1 made that home a single named artifact
  // (the consumer-owned reviewer capability record) instead of a choice between
  // two places, and gave Selection an obligation to consult it — the Kernel
  // still owns neither the schema nor the record's contents.
  assert.ok(containsText(core, "consumer-owned な **reviewer capability record** に置きます"));
  assert.ok(containsText(core, "Kernel はこの record が存在すること、および Selection がそれを参照することを要求します"));
  assert.ok(containsText(core, "schema / template と、その存在 / parse / 最小妥当性の check は Foundation tooling"));
  assert.ok(containsText(core, "record の内容は consumer-owned のままです"));
  assert.ok(
    containsText(core, "当該 Task の required / expected obligation の正本ではありません"),
    "the record must not become a second source of truth for the Selection Contract",
  );

  // Provider-neutrality: identification is the adapter's job, not the Kernel's.
  assert.ok(containsText(core, "どの surface item が review participation を構成するかの識別は Review Adapter"));
  assert.ok(containsText(core, "その actor を expected member とした根拠"));

  // Residual limitation is stated rather than papered over.
  assert.ok(containsText(core, "review participation evidence を出していない reviewer を含められません"));

  // optional/advisory stays non-blocking, but its findings do not.
  assert.ok(containsText(core, "target completion state が `unknown` であること自体は blocker にしません"));
  assert.ok(containsText(core, "actual finding が観測された場合、その finding は Resolution Contract の対象です"));
});

test("a required member cannot be exempted by declaring non-participation", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(
    containsText(core, "expected / optional の member については、その reviewer の target completion state を理由に blocker としません"),
  );
  assert.ok(containsText(core, "required member は非参加の宣言によって blocker から外れません"));

  // The exemption must not leak into the finding axis (round-2 F2).
  assert.ok(
    containsText(core, "非参加の宣言は、その reviewer が既に出した finding の Resolution obligation を discharge しません"),
  );
  assert.ok(containsText(core, "ancestor target で出した finding についても同じです"));
  assert.ok(
    containsText(core, "非参加の宣言が免除するのは、その target について新たな completion evidence を得ることだけです"),
  );
  assert.ok(
    containsText(core, "valid な代替 run を得るか、Selection Contract を明示的に変更して required 構成を確定し直す"),
  );
  assert.ok(containsText(core, "required review 数の gate を迂回する経路にしてはいけません"));
});

test("core policy separates run record state from target completion state", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(containsText(core, "run record state と target completion state は別の対象です"));
  assert.ok(containsText(core, "両者は同じ語で呼ばず、混同してはいけません"));
  // The pre-existing record vocabulary must be reconciled explicitly, not left
  // to collide with the new reviewer-level vocabulary.
  assert.ok(
    containsText(
      core,
      "run record としては `status: completed` かつ `validity: invalid` であり、同時にその reviewer の current target に対する target completion state は `not-bound` です",
    ),
  );
  assert.ok(containsText(core, "この 2 つは矛盾しません"));
});

test("core policy requires target-bound positive completion evidence on stable fields", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(containsText(core, "positive completion evidence は target-bound です"));
  assert.ok(containsText(core, "その target への resolvable な参照を持つ positive completion evidence"));
  assert.ok(containsText(core, "`0 findings` へ変換してはいけません"));

  assert.ok(containsText(core, "target を安定して表す field / surface"));
  assert.ok(
    containsText(core, "review target の移動に追随して値が変化する field / surface を binding の根拠にしてはいけません"),
  );
  assert.ok(containsText(core, "binding の根拠を記録すること"));

  // The fallback when stability cannot be confirmed is normative and must live
  // in the Kernel, not only in the Executable-only skill.
  assert.ok(
    containsText(
      core,
      "どちらが安定かを必要な精度で確認できない場合、その binding は成立しておらず、target completion state は `unknown` です",
    ),
  );

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

  // Step 6 must be provider-neutral: tied to triage, not to a provider's thread
  // concept, and not stricter than the Resolution Contract.
  assert.ok(containsText(core, "triage されていない finding が review surface 上に残っていないことを確認する"));
  assert.ok(!core.includes("unresolved review thread"), "the Kernel must not name a provider thread concept");

  // R4: obligation satisfaction. Step 7 must span the WHOLE expected review
  // set — scoping it to `required ∪ expected` would leave the optional
  // member's Resolution obligation defined but never evaluated.
  assert.ok(
    containsText(core, "**expected review set の各 member（optional / advisory を含む）の review obligation が satisfied している**"),
  );
  // The R2 carve-out must remain true when read standalone: it is about not
  // demanding a NEW full re-review per target move, not about waiving the
  // default condition.
  assert.ok(
    containsText(
      core,
      "accepted fix による target 変更のたびに、全 member へ final target の full re-review を新たに要求するものではありません",
    ),
  );
  assert.ok(containsText(core, "上記の例外がその範囲を定めます"));

  // The obligation must actually be defined, per class — otherwise step 7 is
  // circular and two agents can read it opposite ways.
  assert.ok(containsText(core, "**review obligation** は、member の class ごとに次を指します"));
  assert.ok(containsText(core, "**required member**:"));
  assert.ok(containsText(core, "**expected member**:"));
  assert.ok(containsText(core, "**optional / advisory member**:"));
  // The expected-member obligation must be decidable from observable state,
  // not from an agent's unstated intention (round-2 F1).
  assert.ok(
    containsText(core, "target completion state が `completed@target` または `declined` であること"),
  );
  // The exception must be narrow: all three preconditions, and it must not
  // exempt awaiting an in-flight run or a member's first completion.
  assert.ok(containsText(core, "**ただし、次をすべて満たす場合に限り、この条件を要求しません。**"));
  // The exception must compose across successive bounded target moves, or a
  // second targeted closure silently loses it and forces a full re-review.
  assert.ok(
    containsText(core, "その member が、この review flow のいずれかの target で `completed@target` になっている"),
  );
  assert.ok(
    containsText(core, "その completion 以降の target 移動がすべて accepted fix によるものであり"),
  );
  assert.ok(containsText(core, "連続する targeted closure を跨いでこの条件を辿れます"));
  assert.ok(containsText(core, "current target に対する run が in-flight でない"));
  assert.ok(
    containsText(core, "**既に走っている run の終端を待つ義務と、その member の初回 completion 義務は免除しません。**"),
  );
  assert.ok(containsText(core, "一度も `completed@target` になっていない member へこの例外を適用してはいけません"));

  // A permanently failed/unknown expected member must have a stated exit —
  // carrying the same anti-bypass guard its required-member sibling has.
  assert.ok(containsText(core, "条件 2 の成立を無期限に待ちません"));
  assert.ok(
    containsText(core, "Selection Contract を明示的に変更してその member の class を確定し直し"),
  );
  assert.ok(containsText(core, "この route を、条件 2 の gate を迂回する経路にしてはいけません"));

  // The wait is on run-record state, not target completion state — the policy
  // forbids using one vocabulary for both objects.
  assert.ok(containsText(core, "ここで待つ対象は run record state であり、target completion state ではありません"));

  // The residual-limitation sentence must not re-assert current-target-only
  // membership after the carry-over rule above it.
  assert.ok(
    containsText(core, "**この review flow のいずれの target 上にも**まだ review participation evidence を出していない reviewer"),
  );
  assert.ok(
    containsText(core, "ancestor target で participation evidence を出している reviewer は、上記の carry-over により member です"),
  );
  assert.ok(
    containsText(core, "agent の内心の申告（「この member の沈黙には依拠していない」等）で満たしたことにしてはいけません"),
  );
  assert.ok(containsText(core, "判定は observable な target completion state と、上記の記録された stopping rules 判断に基づきます"));

  // required-member validity is judged per review stage, not against the final
  // target (round-2 F7).
  assert.ok(
    containsText(core, "その run が属する review stage の expected target"),
  );
  assert.ok(containsText(core, "必ずしも final target に対して判定するのではありません"));

  // Ordering property: the fence is invalidated by later review-relevant state
  // changes — bounded, and not self-triggering.
  assert.ok(containsText(core, "**review-relevant な state 変化**があった場合、その fence 評価は無効となり、再評価します"));
  // The self-exemption must name the referent explicitly (round-2 F5).
  assert.ok(
    containsText(
      core,
      "agent 自身が Review Protocol の各 Contract および本 fence に従って persist する durable evidence（acquisition record、triage / Resolution の記録、merge-ready report を含む）の記録そのもの",
    ),
  );
  assert.ok(containsText(core, "fence を無効化しません"));
  assert.ok(containsText(core, "この再評価は無制限に繰り返しません"));

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

test("both review skills keep non-valid runs' findings in Resolution scope", async () => {
  // The Kernel rule is only deterministic if every aggregation site in the
  // procedures agrees. Issue #45's review found three such sites.
  const code = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const doc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  for (const [name, text] of [
    ["review-code.md", code],
    ["review-doc.md", doc],
  ]) {
    assert.ok(
      containsText(text, "finding の集約対象は valid な run に限りません") ||
        containsText(text, "集約対象は valid な run に限りません"),
      `${name} must not restrict finding aggregation to valid runs`,
    );
    assert.ok(
      containsText(text, "`validity` は evidence 軸の判定であり、finding を捨ててよい根拠ではありません"),
      `${name} must state that validity is not grounds for dropping findings`,
    );
    // The superseded instruction must be gone, not merely contradicted later.
    assert.ok(
      !containsText(text, "invalid / unknown / failure な run の finding は triage に使用しません"),
      `${name} still contains the superseded discard instruction`,
    );
    assert.ok(
      !containsText(text, "valid な run の finding だけを triage へ進めます"),
      `${name} still contains the superseded valid-only triage instruction`,
    );
  }

  // The second-discovery sub-step must not reintroduce the valid-only filter.
  assert.ok(
    !containsText(code, "valid な run の finding を Resolution Contract で triage します"),
    "review-code.md second discovery still filters findings on validity",
  );
});

test("the Normative review procedure reaches the fence and the expected review set", async () => {
  // review-doc.md governs Normative artifacts. Issue #45's failure modes are
  // reachable from Normative reviews too, so the procedure must close the set
  // and evaluate the fence rather than ending at "procedure complete".
  const doc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  assert.ok(containsText(doc, "expected review set を確定します"));
  assert.ok(containsText(doc, "expected review set は自分が trigger した reviewer だけでは閉じません"));
  assert.ok(containsText(doc, "Merge-ready completion fence"));
  assert.ok(containsText(doc, "会話内で既に見た snapshot をこの判定の根拠にせず"));
  assert.ok(containsText(doc, "target completion state"));
});

test("review-code skill carries the procedural detail for the fence", async () => {
  const skill = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  // Selection: close the set and record the basis.
  assert.ok(containsText(skill, "expected review set を確定します"));
  assert.ok(containsText(skill, "自分が trigger した reviewer だけを set に入れて終わりにしません"));
  assert.ok(containsText(skill, "どの surface item を review participation とみなしたか"));

  // Acquisition: record which evidence and which field backed the binding.
  assert.ok(containsText(skill, "どの field / surface を安定と判断して binding の根拠にしたか"));
  assert.ok(containsText(skill, "安定性を必要な精度で確認できないまま binding が成立したものとして扱わないでください"));

  // Merge-ready: fence evaluated last, from fresh acquisition.
  assert.ok(containsText(skill, "merge-ready を宣言する直前の最後の action として"));
  assert.ok(containsText(skill, "会話内で既に見た snapshot をこの判定の根拠にしません"));
  assert.ok(containsText(skill, "triage されていない finding が review surface 上に残っていないことを確認します"));

  // Provider observations stay observations — and, since Issue #72 Phase 1,
  // they live in the reviewer capability record rather than in the skill, with
  // an observed_at date that makes their staleness visible. The specific
  // observation guarded here is the one that is easiest to get wrong: a green
  // status that means review was SKIPPED, not review completed.
  const example = JSON.parse(await readFile(path.join(root, "templates", "reviewers.example.json"), "utf8"));
  const observed = JSON.stringify(example);
  assert.ok(observed.includes("check/status surface を一切生成しない"));
  assert.ok(observed.includes("green な status が review 完了ではなく review 未実施を意味する"));
  assert.ok(
    example.reviewers.every((reviewer) => /^\d{4}-\d{2}-\d{2}$/.test(reviewer.observed_at)),
    "every reviewer's markers must carry the date they were last observed",
  );
});

test("both skills reference the Kernel rules rather than restating them", async () => {
  // policy/core.md owns the normative rules; skills explain procedure. The
  // sentences below are the Kernel's and must not be duplicated into either
  // skill, where the copies could drift silently. Round 2 found the guard had
  // covered only review-code.md while review-doc.md gained a fresh (and
  // incomplete) copy in the same commit — so both are checked here, and the
  // paraphrase that slipped past the exact-match check is included.
  const code = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const doc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  const kernelSentences = [
    "全 member が final target で completed であることを要求するものではありません",
    "同じ reviewer による final target の full re-review を強制しません",
    "review target 上に presence があるだけでは足りず",
    "review target の移動に追随して値が変化する field / surface を binding の根拠にしてはいけません",
    // the review-doc paraphrase of the same rule
    "review target の移動に追随して値が変化するものを根拠にしません",
    "その target への resolvable な参照を持つ positive completion evidence が必要です",
  ];

  for (const [name, text] of [
    ["review-code.md", code],
    ["review-doc.md", doc],
  ]) {
    for (const kernelSentence of kernelSentences) {
      assert.ok(
        !containsText(text, kernelSentence),
        `${name} restates a Kernel rule: ${kernelSentence}`,
      );
    }
    // Each must point at the owner instead of carrying its own copy.
    assert.ok(
      containsText(text, "`policy/core.md`"),
      `${name} must reference the owning policy`,
    );
  }

  assert.ok(containsText(code, "は、いずれも `policy/core.md` が定めます"));
  assert.ok(containsText(code, "merge-ready の成立条件、review obligation の定義"));
  assert.ok(
    containsText(doc, "いずれも Acquisition & Validity Contract（`policy/core.md`）が定めます"),
  );
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
