import assert from "node:assert/strict";
import test from "node:test";
import { collectReviewEvidence, fetchBaseDelta } from "../tooling/review-evidence-lib.mjs";
import { evaluateReviewerTargetStates } from "../tooling/review-evidence-state-lib.mjs";
import {
  BASE_DRIFT_ASSESSMENT_VERDICTS,
  evaluateMergeReadyFence,
  parseBaseDriftAssessment,
  parseMergeReadyFenceArgs,
} from "../tooling/merge-ready-fence-lib.mjs";

// ---------------------------------------------------------------------------
// Behavior fixtures for safe base drift carry-forward (Issue #102).
//
// The lifecycle under test is exactly one: a PR whose reviewed head has NOT
// moved, whose base branch alone advanced. Every fixture is executed by the
// shipping tooling — the acquisition function that reads the intervening base
// delta, the real #74 reviewer-state evaluator, and the real fence evaluator.
// Nothing here asserts on prose.
//
// The split under test is the one the mechanism exists to hold:
//
//   deterministic fact  -> acquisition + fence
//   semantic judgment   -> agent, recorded as a durable PR comment
//
// so the decisive negative fixtures are the ones proving the fence never
// derives the semantic half from the deterministic half.
// ---------------------------------------------------------------------------

const TARGET = "abcdef1234567890abcdef1234567890abcdef12";
const MOVED_HEAD = "1234567890abcdef1234567890abcdef12345678";
const BASE = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";
const ADVANCED_BASE = "0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d";
const OTHER_BASE = "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";
const ANCHOR = "2026-09-03T00:00:00.000Z";
const OBSERVED = "2026-09-03T01:00:00.000Z";

const ASSESSMENT_ID = 900;
const ASSESSMENT_URL = "https://github.com/org/repo/pull/102#issuecomment-900";

const REVIEWED_ARTIFACTS = ["src/reviewed.ts"];
const INTERVENING_ARTIFACTS = ["src/elsewhere.ts", "docs/prd.md"];

const RECORD = {
  reviewers: [
    {
      id: "primary",
      actors: ["primary-bot"],
      completion_marker: { any_of: ["Reviewed commit:"], target_pattern: "Reviewed commit:[^0-9a-fA-F]*([0-9a-fA-F]{7,40})" },
      rate_limit_marker: null,
      failure_marker: null,
      non_participation_marker: null,
      in_flight_marker: null,
    },
  ],
};

function comment(id, login, body, fields = {}) {
  return {
    id,
    actor: login,
    actor_database_id: `db-${login}`,
    actor_node_id: `node-${login}`,
    body,
    created_at: OBSERVED,
    updated_at: OBSERVED,
    locator: id === ASSESSMENT_ID ? ASSESSMENT_URL : `conversation-${id}`,
    ...fields,
  };
}

/**
 * The durable record shape the agent writes: a plain PR comment whose fields
 * name the exact drift the verdict covers, with the reasoning in prose the
 * fence never reads.
 */
function assessmentBody({
  reviewedHead = TARGET,
  frozenBase = BASE,
  currentBaseTip = ADVANCED_BASE,
  verdict = "independent",
  basis = "reviewed delta only rewrites the local selection helper; the intervening delta adds an unrelated document surface and touches no module the reviewed delta imports, exports to, or shares state with",
  extra = "",
} = {}) {
  const lines = [
    "## safe-base-drift-assessment",
    "",
    `reviewed_head: ${reviewedHead ?? ""}`,
    `frozen_base: ${frozenBase ?? ""}`,
    `current_base_tip: ${currentBaseTip ?? ""}`,
    `verdict: ${verdict ?? ""}`,
  ];
  if (basis !== null) lines.push(`basis: ${basis}`);
  return lines.join("\n") + extra;
}

function assessmentComment(options = {}) {
  return comment(ASSESSMENT_ID, "implementer", assessmentBody(options));
}

function surface(items, fetchStatus = "fetched") {
  return { fetch_status: fetchStatus, count: items.length, items };
}

/** The intervening base delta fact of one acquisition, in its observable shapes. */
function baseDelta({
  fetchStatus = "fetched",
  ancestry = "ahead",
  fromSha = BASE,
  toSha = ADVANCED_BASE,
  artifactPaths = INTERVENING_ARTIFACTS,
  aheadBy = 3,
  behindBy = 0,
} = {}) {
  if (fetchStatus === "not_applicable") {
    return { fetch_status: "not_applicable", failure: null, repo: null, from_sha: null, to_sha: null, ancestry: null, ahead_by: null, behind_by: null, total_commits: null, artifact_paths: null, note: "nothing to compare" };
  }
  return {
    fetch_status: fetchStatus,
    failure: fetchStatus === "fetched" ? null : { status: 404, message: "No common ancestor between the two commits" },
    repo: "org/repo",
    from_sha: fromSha,
    to_sha: toSha,
    ancestry,
    ahead_by: aheadBy,
    behind_by: behindBy,
    total_commits: aheadBy,
    artifact_paths: fetchStatus === "fetched" ? artifactPaths : null,
  };
}

function evidence({
  headSha = TARGET,
  baseTipSha = ADVANCED_BASE,
  comments = [comment(1, "primary-bot", `Review complete\nReviewed commit: ${TARGET}`), assessmentComment()],
  commentsStatus = "fetched",
  files = REVIEWED_ARTIFACTS,
  threads = [],
  delta = baseDelta(),
} = {}) {
  return {
    repo: "org/repo",
    pull_number: 102,
    generated_at: OBSERVED,
    pr_metadata: { fetch_status: "fetched", failure: null, head_sha: headSha, base_sha: BASE, base_ref: "main", state: "open", html_url: null, updated_at: OBSERVED, body: "Refs #102" },
    base_branch: { fetch_status: "fetched", failure: null, repo: "org/repo", ref: "main", tip_sha: baseTipSha },
    base_delta: delta,
    surfaces: {
      conversation_comments: surface(comments, commentsStatus),
      review_submissions: surface([]),
      inline_review_comments: surface([]),
      review_threads: surface(threads),
      pull_request_files: surface(files.map((path) => ({ path, status: "modified", previous_path: null }))),
    },
    fetch_failures: 0,
  };
}

function stateFor(snapshot) {
  return evaluateReviewerTargetStates(snapshot, { record: RECORD, target: { sha: TARGET }, runAnchor: { ids: [], after: ANCHOR } });
}

function acknowledgeAll(state) {
  return state.reviewer_states.flatMap((entry) =>
    (entry.evidence ?? []).map((item) => ({ canonical_id: item.canonical_id, body_digest: item.revision.body_digest })),
  );
}

/**
 * The eligible declaration: the reviewed head as target, the OLD base as the
 * frozen base (which is the whole point — it is what drifted), verification
 * re-run against the composed state, and the assessment comment named.
 */
function carryForwardInputs(overrides = {}) {
  return {
    targetSha: TARGET,
    baseSha: BASE,
    artifacts: REVIEWED_ARTIFACTS,
    verifySha: TARGET,
    verifyBaseSha: ADVANCED_BASE,
    driftAssessment: String(ASSESSMENT_ID),
    requiredReviewers: ["primary"],
    declaredSkills: ["review-code"],
    ...overrides,
  };
}

function runFence({ snapshot = evidence(), inputs = {}, acknowledged } = {}) {
  const state = stateFor(snapshot);
  return evaluateMergeReadyFence({
    evidence: snapshot,
    state,
    inputs: { ...carryForwardInputs(inputs), acknowledged: acknowledged === undefined ? acknowledgeAll(state) : acknowledged },
  });
}

function checkOf(fence, id) {
  const found = fence.checks.find((entry) => entry.id === id);
  assert.ok(found, `fence is missing check ${id}`);
  return found;
}

/** Assert the drift was NOT carried forward, whatever the specific reason. */
function assertNotCarriedForward(fence, expectedReason) {
  const carry = checkOf(fence, "base-drift-carry-forward");
  const base = checkOf(fence, "target-base");
  assert.notEqual(carry.status, "pass", "carry-forward must not pass");
  assert.equal(carry.detail.carry_forward, false);
  assert.equal(base.status, "fail");
  assert.deepEqual(base.reason_codes, ["target_base_moved"]);
  assert.notEqual(fence.status, "pass");
  if (expectedReason) {
    assert.ok(
      carry.reason_codes.includes(expectedReason),
      `expected reason ${expectedReason}, got ${JSON.stringify(carry.reason_codes)}`,
    );
  }
  return carry;
}

// ---------------------------------------------------------------------------
// Positive candidate
// ---------------------------------------------------------------------------

test("the eligible safe-base-drift candidate carries prior review evidence forward", () => {
  const fence = runFence();
  const carry = checkOf(fence, "base-drift-carry-forward");

  assert.equal(carry.status, "pass");
  assert.deepEqual(carry.reason_codes, []);
  assert.equal(carry.detail.carry_forward, true);
  assert.equal(carry.detail.base_drifted, true);

  // Every deterministic fact the route rests on is present in the record, not
  // merely implied by the verdict.
  assert.equal(carry.detail.intervening_delta.ancestry, "ahead");
  assert.equal(carry.detail.intervening_delta.behind_by, 0);
  assert.equal(carry.detail.intervening_delta.artifact_count, INTERVENING_ARTIFACTS.length);
  assert.deepEqual(carry.detail.artifact_overlap, []);
  assert.equal(carry.detail.composed_verify_base_sha, ADVANCED_BASE);
  assert.equal(carry.detail.assessment.verdict, "independent");
  assert.equal(carry.detail.assessment.basis_present, true);
  assert.equal(carry.detail.assessment.comment_locator, ASSESSMENT_URL);
  for (const entry of carry.detail.prerequisites) assert.equal(entry.status, "pass", `${entry.id} was ${entry.status}`);

  // The base moved, and the fence says so — the pass is named as a carry
  // forward rather than presented as a base that never drifted.
  const base = checkOf(fence, "target-base");
  assert.equal(base.status, "pass");
  assert.deepEqual(base.reason_codes, ["base_drift_carried_forward"]);
  assert.equal(base.detail.frozen_base_sha, BASE);
  assert.equal(base.detail.current_base_tip_sha, ADVANCED_BASE);
  assert.equal(fence.status, "pass");
});

test("the assessment comment can be named by its durable URL as well as its id", () => {
  const fence = runFence({ inputs: { driftAssessment: ASSESSMENT_URL } });
  assert.equal(checkOf(fence, "base-drift-carry-forward").status, "pass");
  assert.equal(fence.status, "pass");
});

// ---------------------------------------------------------------------------
// Fail-closed: the lifecycle boundary
// ---------------------------------------------------------------------------

test("a head that moved since the review is not a base-drift candidate at all (#70 boundary)", () => {
  // A post-review head mutation is a different lifecycle (Issue #70, closed as
  // not planned). Declaring an assessment must not convert it into one, even
  // when every base-side fact is otherwise perfect.
  const fence = runFence({
    snapshot: evidence({ headSha: MOVED_HEAD }),
    acknowledged: [],
  });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "fail");
  assert.ok(carry.reason_codes.includes("carry_forward_precondition_failed:target-head"));
  assert.equal(carry.detail.carry_forward, false);
  assert.equal(checkOf(fence, "target-head").status, "fail");
  assert.equal(checkOf(fence, "target-base").status, "fail");
  assert.equal(fence.status, "fail");
});

test("an assessment written for the head before a rebase does not authorise the new head", () => {
  // The reviewed patch may be "the same change", but the reviewed target SHA
  // is not the current one. That inference is explicitly out of scope.
  const fence = runFence({
    snapshot: evidence({ headSha: MOVED_HEAD, comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ reviewedHead: MOVED_HEAD })] }),
    acknowledged: [],
  });
  assert.equal(checkOf(fence, "base-drift-carry-forward").status, "fail");
  assert.equal(fence.status, "fail");
});

test("a base rewind is not a forward-only drift", () => {
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ ancestry: "behind", aheadBy: 0, behindBy: 4 }) }) });
  assertNotCarriedForward(fence, "base_drift_rewind");
});

test("a diverged base history is not a forward-only drift", () => {
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ ancestry: "diverged", aheadBy: 2, behindBy: 2 }) }) });
  assertNotCarriedForward(fence, "base_drift_diverged_history");
});

test("an unrecognised ancestry relation stays unknown rather than being read as forward", () => {
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ ancestry: null }) }) });
  const carry = assertNotCarriedForward(fence, "base_drift_ancestry_unknown");
  assert.equal(carry.status, "unknown");
});

test("an unrelated base history — which the provider reports as a plain fetch failure — is not eligible", () => {
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ fetchStatus: "failed", ancestry: null }) }) });
  const carry = assertNotCarriedForward(fence, "intervening_delta_unavailable");
  assert.equal(carry.status, "unknown");
});

test("an intervening delta the provider truncated is incomplete, not empty", () => {
  // A truncated changed-path list that claimed completeness would let an
  // artifact the base delta really touched pass the overlap check by absence.
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ fetchStatus: "partial", artifactPaths: null }) }) });
  const carry = assertNotCarriedForward(fence, "intervening_delta_unavailable");
  assert.equal(carry.status, "unknown");
});

test("an intervening delta fetched for other endpoints does not answer for this drift", () => {
  const fence = runFence({ snapshot: evidence({ delta: baseDelta({ fromSha: OTHER_BASE }) }) });
  assertNotCarriedForward(fence, "intervening_delta_endpoint_mismatch");
});

test("a base delta fact that is absent altogether is unknown, not a pass", () => {
  const snapshot = evidence();
  delete snapshot.base_delta;
  const fence = runFence({ snapshot });
  const carry = assertNotCarriedForward(fence, "intervening_delta_unavailable");
  assert.equal(carry.status, "unknown");
});

test("a direct artifact overlap removes the candidate", () => {
  const fence = runFence({
    snapshot: evidence({ delta: baseDelta({ artifactPaths: ["docs/prd.md", ...REVIEWED_ARTIFACTS] }) }),
  });
  const carry = assertNotCarriedForward(fence, "base_drift_artifact_overlap");
  assert.equal(carry.status, "fail");
  assert.deepEqual(carry.detail.artifact_overlap, REVIEWED_ARTIFACTS);
});

test("an unavailable changed-file list is unknown, never an empty overlap", () => {
  const snapshot = evidence();
  snapshot.surfaces.pull_request_files = { fetch_status: "failed", count: null, items: [] };
  const fence = runFence({ snapshot });
  const carry = assertNotCarriedForward(fence, "changed_files_unavailable");
  assert.equal(carry.status, "unknown");
  assert.equal(carry.detail.artifact_overlap, null);
});

// ---------------------------------------------------------------------------
// Fail-closed: fresh composed verification
// ---------------------------------------------------------------------------

test("a verification green at the old base is not carried into the new composed state", () => {
  // --verify-sha still matches the reviewed head, so the existing
  // verify-coherence check passes exactly as before. What is missing is the
  // statement of which base that verification composed.
  const fence = runFence({ inputs: { verifyBaseSha: null } });
  const carry = assertNotCarriedForward(fence, "composed_verify_base_missing");
  assert.equal(carry.status, "unknown");
  assert.equal(checkOf(fence, "verify-coherence").status, "pass");
});

test("a composed verification run against a base that has since moved on is stale", () => {
  const fence = runFence({ inputs: { verifyBaseSha: OTHER_BASE } });
  const carry = assertNotCarriedForward(fence, "composed_verify_base_stale");
  assert.equal(carry.status, "fail");
});

// ---------------------------------------------------------------------------
// Fail-closed: the semantic assessment
// ---------------------------------------------------------------------------

test("an absent semantic assessment leaves every deterministic fact insufficient", () => {
  // This is the decisive fixture: forward-only, complete, disjoint, freshly
  // verified, every reviewer obligation discharged — and still not carried
  // forward, because nobody judged the semantics.
  const fence = runFence({ inputs: { driftAssessment: null } });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "pass");
  assert.equal(carry.detail.requested, false);
  assert.equal(carry.detail.carry_forward, false);
  // The base drift is still reported by the check that always reported it.
  const base = checkOf(fence, "target-base");
  assert.equal(base.status, "fail");
  assert.deepEqual(base.reason_codes, ["target_base_moved"]);
  assert.equal(fence.status, "fail");
});

test("a named assessment comment that is not on this PR is unknown, not absent-and-fine", () => {
  const fence = runFence({ inputs: { driftAssessment: "404404" } });
  const carry = assertNotCarriedForward(fence, "drift_assessment_not_found");
  assert.equal(carry.status, "unknown");
});

test("an assessment on an incompletely acquired comment surface is unknown", () => {
  const fence = runFence({ snapshot: evidence({ commentsStatus: "partial" }) });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "unknown");
  assert.ok(carry.reason_codes.includes("drift_assessment_surface_unavailable"));
});

test("an explicit `unknown` verdict is not converted into eligibility", () => {
  const fence = runFence({ snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ verdict: "unknown" })] }) });
  const carry = assertNotCarriedForward(fence, "drift_assessment_verdict_unknown");
  assert.equal(carry.status, "unknown");
});

test("an explicit `coupled` verdict fails the route", () => {
  const fence = runFence({ snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ verdict: "coupled" })] }) });
  const carry = assertNotCarriedForward(fence, "drift_assessment_semantic_coupling");
  assert.equal(carry.status, "fail");
});

test("a verdict outside the closed vocabulary is malformed, not a fourth meaning", () => {
  const fence = runFence({ snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ verdict: "probably-fine" })] }) });
  assertNotCarriedForward(fence, "drift_assessment_malformed");
});

test("a comment that is not an assessment at all cannot stand in for one", () => {
  const fence = runFence({
    snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), comment(ASSESSMENT_ID, "implementer", "main を取り込んでも問題なさそうです。")] }),
  });
  assertNotCarriedForward(fence, "drift_assessment_malformed");
});

test("an assessment recorded without a basis is not a durable record", () => {
  // A verdict with no reasoning is the bare-boolean shape the design rules
  // out: a later session could not reconstruct what was judged.
  const fence = runFence({ snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ basis: null })] }) });
  const carry = assertNotCarriedForward(fence, "drift_assessment_basis_missing");
  assert.equal(carry.status, "unknown");
  assert.equal(carry.detail.assessment.basis_present, false);
});

test("an assessment of a different drift does not authorise this one", () => {
  // The base advanced again after the assessment was written. The verdict
  // covered the earlier advance and says nothing about what has landed since.
  const fence = runFence({
    snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ currentBaseTip: OTHER_BASE })] }),
  });
  const carry = assertNotCarriedForward(fence, "drift_assessment_scope_mismatch");
  assert.equal(carry.status, "fail");
  assert.deepEqual(carry.detail.assessment.scope_mismatch_fields, ["current_base_tip"]);
});

test("an assessment that never named the drift it covers is malformed, not merely mismatched", () => {
  const fence = runFence({
    snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ currentBaseTip: null })] }),
  });
  const carry = assertNotCarriedForward(fence, "drift_assessment_malformed");
  assert.equal(carry.status, "unknown");
  assert.deepEqual(carry.detail.assessment.absent_scope_fields, ["current_base_tip"]);
});

test("an assessment naming a different frozen base does not authorise this one", () => {
  const fence = runFence({
    snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ frozenBase: OTHER_BASE })] }),
  });
  assertNotCarriedForward(fence, "drift_assessment_scope_mismatch");
});

test("an assessment edited after the fact is evaluated as it now stands", () => {
  // The fence reads the CURRENT body from this acquisition, so appending a
  // contradicting verdict line cannot leave the original reading in force.
  const fence = runFence({
    snapshot: evidence({
      comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ extra: "\n\nverdict: coupled\n" })],
    }),
  });
  assertNotCarriedForward(fence, "drift_assessment_malformed");
});

// ---------------------------------------------------------------------------
// Fail-closed: the existing obligations the route may not relax
// ---------------------------------------------------------------------------

test("an unresolved review thread blocks the carry-forward route", () => {
  const fence = runFence({ snapshot: evidence({ threads: [{ id: "T1", is_resolved: false, is_outdated: true, comments: [] }] }) });
  const carry = assertNotCarriedForward(fence, "carry_forward_precondition_failed:review-threads");
  assert.equal(carry.status, "fail");
});

test("a review result edited after triage blocks the carry-forward route", () => {
  const fence = runFence({ acknowledged: [] });
  assertNotCarriedForward(fence, "carry_forward_precondition_failed:result-revision-coherence");
});

test("a required reviewer that never completed at the reviewed target blocks the route", () => {
  const fence = runFence({
    snapshot: evidence({ comments: [comment(1, "primary-bot", "Review complete"), assessmentComment()] }),
  });
  assertNotCarriedForward(fence, "carry_forward_precondition_unknown:reviewer-completion");
});

test("an artifact set that grew since the freeze blocks the route", () => {
  const fence = runFence({ snapshot: evidence({ files: [...REVIEWED_ARTIFACTS, "src/new.ts"] }) });
  assertNotCarriedForward(fence, "carry_forward_precondition_failed:artifact-set");
});

test("an under-routed review skill blocks the route", () => {
  const fence = runFence({ inputs: { declaredSkills: null } });
  assertNotCarriedForward(fence, "carry_forward_precondition_unknown:skill-routing");
});

test("every prerequisite status is recorded, so a later session can see what the route rested on", () => {
  const carry = checkOf(runFence(), "base-drift-carry-forward");
  assert.deepEqual(
    carry.detail.prerequisites.map((entry) => entry.id),
    ["target-head", "artifact-set", "skill-routing", "reviewer-completion", "result-revision-coherence", "acquisition-coverage", "review-threads", "verify-coherence"],
  );
  // target-base is deliberately not a prerequisite of the check it feeds.
  assert.ok(!carry.detail.prerequisites.some((entry) => entry.id === "target-base"));
});

// ---------------------------------------------------------------------------
// The boundary the design exists to hold
// ---------------------------------------------------------------------------

test("artifact disjointness alone never produces the semantic conclusion", () => {
  // Identical deterministic facts, three different agent verdicts, three
  // different outcomes. If the fence were inferring semantic safety from the
  // disjoint artifact sets, all three would agree.
  const outcomes = ["independent", "coupled", "unknown"].map((verdict) => {
    const fence = runFence({
      snapshot: evidence({ comments: [comment(1, "primary-bot", `Reviewed commit: ${TARGET}`), assessmentComment({ verdict })] }),
    });
    const carry = checkOf(fence, "base-drift-carry-forward");
    assert.deepEqual(carry.detail.artifact_overlap, [], "every variant has disjoint artifact sets");
    assert.equal(carry.detail.intervening_delta.ancestry, "ahead");
    return carry.status;
  });
  assert.deepEqual(outcomes, ["pass", "fail", "unknown"]);
});

test("the closed verdict vocabulary is the whole vocabulary", () => {
  assert.deepEqual(BASE_DRIFT_ASSESSMENT_VERDICTS, ["independent", "coupled", "unknown"]);
});

test("the fence never invents an assessment: no route reaches carry-forward without a declared one", () => {
  // Sweep the deterministic dimensions that could plausibly be mistaken for
  // evidence of semantic safety. None of them, alone or together, produces a
  // carried-forward base.
  const temptations = [
    { label: "tiny intervening delta", snapshot: evidence({ delta: baseDelta({ artifactPaths: ["docs/typo.md"], aheadBy: 1 }) }) },
    { label: "empty intervening delta", snapshot: evidence({ delta: baseDelta({ artifactPaths: [], aheadBy: 1 }) }) },
    { label: "single reviewed artifact", snapshot: evidence({ files: ["src/reviewed.ts"] }) },
  ];
  for (const { label, snapshot } of temptations) {
    const fence = evaluateMergeReadyFence({
      evidence: snapshot,
      state: stateFor(snapshot),
      inputs: { ...carryForwardInputs({ driftAssessment: null }), acknowledged: acknowledgeAll(stateFor(snapshot)) },
    });
    assert.equal(checkOf(fence, "base-drift-carry-forward").detail.carry_forward, false, label);
    assert.equal(checkOf(fence, "target-base").status, "fail", label);
    assert.equal(fence.status, "fail", label);
  }
});

// ---------------------------------------------------------------------------
// Regression boundary: the route is additive
// ---------------------------------------------------------------------------

test("with no drift, a declared assessment changes nothing and the ordinary path stands", () => {
  const fence = runFence({
    snapshot: evidence({ baseTipSha: BASE, delta: baseDelta({ fetchStatus: "not_applicable" }) }),
    inputs: { verifyBaseSha: null },
  });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "pass");
  assert.deepEqual(carry.reason_codes, ["base_drift_absent"]);
  assert.equal(carry.detail.carry_forward, false);
  const base = checkOf(fence, "target-base");
  assert.equal(base.status, "pass");
  assert.deepEqual(base.reason_codes, [], "an undrifted base is not reported as a carry forward");
  assert.equal(fence.status, "pass");
});

test("an undeterminable drift is unknown on both checks, never eligible", () => {
  const snapshot = evidence();
  snapshot.base_branch = { fetch_status: "failed", failure: { status: 404, message: "Branch not found" }, repo: "org/repo", ref: "main", tip_sha: null };
  const fence = runFence({ snapshot });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "unknown");
  assert.deepEqual(carry.reason_codes, ["base_drift_undetermined"]);
  assert.equal(checkOf(fence, "target-base").status, "unknown");
  assert.equal(fence.status, "unknown");
});

test("the route introduces no bounded pre-review tier and no new reviewer arithmetic (#71 boundary)", () => {
  // The required set is unchanged by the route: dropping the required reviewer
  // from the declaration is still the same `unknown` it always was, and a
  // carried-forward base does not stand in for a missing review.
  const fence = runFence({ inputs: { requiredReviewers: [] } });
  assert.equal(checkOf(fence, "reviewer-completion").status, "unknown");
  assertNotCarriedForward(fence, "carry_forward_precondition_unknown:reviewer-completion");
});

test("--verify-base-sha and --drift-assessment are optional arguments", () => {
  const without = parseMergeReadyFenceArgs(["--repo", "org/repo", "--pr", "102", "--target-sha", TARGET]);
  assert.equal(without.verifyBaseSha, undefined);
  assert.equal(without.driftAssessment, undefined);
  const withBoth = parseMergeReadyFenceArgs([
    "--repo", "org/repo", "--pr", "102", "--target-sha", TARGET,
    "--verify-base-sha", ADVANCED_BASE, "--drift-assessment", ASSESSMENT_URL,
  ]);
  assert.equal(withBoth.verifyBaseSha, ADVANCED_BASE);
  assert.equal(withBoth.driftAssessment, ASSESSMENT_URL);
});

// ---------------------------------------------------------------------------
// Assessment parsing
// ---------------------------------------------------------------------------

test("assessment fields survive the markdown a comment body normally carries", () => {
  const parsed = parseBaseDriftAssessment(
    [
      "**safe-base-drift-assessment**",
      "",
      `- **reviewed_head:** \`${TARGET}\``,
      `- **frozen_base:** \`${BASE}\``,
      `- **current_base_tip:** \`${ADVANCED_BASE}\``,
      "- **verdict:** `independent`",
      "- **basis:** intervening delta は document surface のみで、reviewed delta の import graph と交差しない",
    ].join("\n"),
  );
  assert.equal(parsed.reviewed_head, TARGET);
  assert.equal(parsed.frozen_base, BASE);
  assert.equal(parsed.current_base_tip, ADVANCED_BASE);
  assert.equal(parsed.verdict, "independent");
  assert.ok(parsed.basis.length > 0);
  assert.deepEqual(parsed.ambiguous_fields, []);
});

test("a body with no marker is not an assessment", () => {
  assert.equal(parseBaseDriftAssessment(`verdict: independent\nreviewed_head: ${TARGET}`), null);
  assert.equal(parseBaseDriftAssessment(null), null);
});

test("a repeated field with differing values is ambiguous, not first-wins", () => {
  const parsed = parseBaseDriftAssessment(
    `safe-base-drift-assessment\nverdict: independent\nverdict: coupled\nreviewed_head: ${TARGET}`,
  );
  assert.deepEqual(parsed.ambiguous_fields, ["verdict"]);
  assert.equal(parsed.verdict, null);
});

test("a field repeated with the same value is not ambiguous", () => {
  const parsed = parseBaseDriftAssessment(`safe-base-drift-assessment\nverdict: independent\nverdict: independent`);
  assert.deepEqual(parsed.ambiguous_fields, []);
  assert.equal(parsed.verdict, "independent");
});

// ---------------------------------------------------------------------------
// Acquisition: the intervening base delta
// ---------------------------------------------------------------------------

const PR_BODY = { base: { ref: "main", repo: { owner: { login: "org" }, name: "repo" } } };

function compareResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

test("a forward-only advance yields the ancestry relation and the changed-path set together", async () => {
  let requested = null;
  const fetchImpl = async (url) => {
    requested = url;
    return compareResponse({
      status: "ahead",
      ahead_by: 2,
      behind_by: 0,
      total_commits: 2,
      commits: [{ sha: "c1" }, { sha: "c2" }],
      files: [{ filename: "src/elsewhere.ts" }, { filename: "docs/prd.md" }],
    });
  };
  const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, BASE, ADVANCED_BASE);
  assert.ok(requested.includes(`/compare/${BASE}...${ADVANCED_BASE}`));
  assert.equal(delta.fetch_status, "fetched");
  assert.equal(delta.ancestry, "ahead");
  assert.equal(delta.behind_by, 0);
  assert.deepEqual(delta.artifact_paths, ["docs/prd.md", "src/elsewhere.ts"]);
});

test("a rename in the base delta contributes both of its paths", async () => {
  // The pre-rename path is exactly the one a reviewed PR may still refer to,
  // so dropping it would hide a real overlap.
  const fetchImpl = async () =>
    compareResponse({
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      commits: [{ sha: "c1" }],
      files: [{ filename: "src/new-name.ts", previous_filename: "src/old-name.ts" }],
    });
  const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, BASE, ADVANCED_BASE);
  assert.deepEqual(delta.artifact_paths, ["src/new-name.ts", "src/old-name.ts"]);
});

test("a comparison at the provider's file ceiling is partial, not a complete short list", async () => {
  const files = Array.from({ length: 300 }, (_, index) => ({ filename: `src/file-${index}.ts` }));
  const fetchImpl = async () =>
    compareResponse({ status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: "c1" }], files });
  const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, BASE, ADVANCED_BASE);
  assert.equal(delta.fetch_status, "partial");
  assert.equal(delta.artifact_paths, null);
  assert.equal(delta.ancestry, "ahead");
});

test("a comparison whose commit list the provider truncated is partial", async () => {
  const fetchImpl = async () =>
    compareResponse({ status: "ahead", ahead_by: 400, behind_by: 0, total_commits: 400, commits: [{ sha: "c1" }], files: [{ filename: "a.ts" }] });
  const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, BASE, ADVANCED_BASE);
  assert.equal(delta.fetch_status, "partial");
  assert.equal(delta.artifact_paths, null);
});

test("unrelated history — answered as a 404 — is a failure, never an empty delta", async () => {
  const fetchImpl = async () => compareResponse({ message: "Not Found" }, { ok: false, status: 404 });
  const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, BASE, ADVANCED_BASE);
  assert.equal(delta.fetch_status, "failed");
  assert.equal(delta.ancestry, null);
  assert.equal(delta.artifact_paths, null);
});

test("no frozen base, no base tip, and an unmoved base all mean there is nothing to compare", async () => {
  const fetchImpl = async () => {
    throw new Error("must not fetch");
  };
  for (const [from, to] of [[null, ADVANCED_BASE], [BASE, null], [BASE, BASE]]) {
    const delta = await fetchBaseDelta(fetchImpl, "t", "org", "repo", PR_BODY, from, to);
    assert.equal(delta.fetch_status, "not_applicable");
    assert.equal(delta.artifact_paths, null);
  }
});

test("collectReviewEvidence acquires the base delta in the same single snapshot", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/graphql")) {
      return compareResponse({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    }
    if (String(url).endsWith("/pulls/102")) {
      return compareResponse({ head: { sha: TARGET }, base: { ref: "main", sha: BASE, repo: { owner: { login: "org" }, name: "repo" } }, body: "", state: "open" });
    }
    if (String(url).includes("/git/ref/heads/main")) return compareResponse({ object: { sha: ADVANCED_BASE } });
    if (String(url).includes("/compare/")) {
      return compareResponse({ status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: "c1" }], files: [{ filename: "docs/prd.md" }] });
    }
    if (String(url).includes("/status")) return compareResponse({ state: "success", total_count: 0, statuses: [] });
    if (String(url).includes("/check-runs")) return compareResponse({ check_runs: [] });
    return compareResponse([]);
  };
  const result = await collectReviewEvidence({ owner: "org", repo: "repo", pullNumber: 102, token: "t", fetchImpl, frozenBaseSha: BASE });
  assert.equal(result.base_delta.fetch_status, "fetched");
  assert.equal(result.base_delta.ancestry, "ahead");
  assert.deepEqual(result.base_delta.artifact_paths, ["docs/prd.md"]);
  assert.equal(calls.filter((url) => url.includes("/compare/")).length, 1);
});

test("collectReviewEvidence issues no comparison when no frozen base was declared", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/graphql")) {
      return compareResponse({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    }
    if (String(url).endsWith("/pulls/102")) {
      return compareResponse({ head: { sha: TARGET }, base: { ref: "main", sha: BASE, repo: { owner: { login: "org" }, name: "repo" } }, body: "", state: "open" });
    }
    if (String(url).includes("/git/ref/heads/main")) return compareResponse({ object: { sha: ADVANCED_BASE } });
    if (String(url).includes("/status")) return compareResponse({ state: "success", total_count: 0, statuses: [] });
    if (String(url).includes("/check-runs")) return compareResponse({ check_runs: [] });
    return compareResponse([]);
  };
  const result = await collectReviewEvidence({ owner: "org", repo: "repo", pullNumber: 102, token: "t", fetchImpl });
  assert.equal(result.base_delta.fetch_status, "not_applicable");
  assert.equal(calls.filter((url) => url.includes("/compare/")).length, 0);
});
