import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewerTargetStates } from "../tooling/review-evidence-state-lib.mjs";
import {
  FENCE_CHECK_IDS,
  MERGE_READY_FENCE_SCHEMA_ID,
  classifyArtifactPath,
  classifyArtifactPaths,
  evaluateMergeReadyFence,
  findClosingKeywordReferences,
  normalizeSkillName,
  parseAcknowledgedRevisions,
  parseMergeReadyFenceArgs,
} from "../tooling/merge-ready-fence-lib.mjs";

// ---------------------------------------------------------------------------
// Behavior fixtures for the deterministic merge-ready fence (Issue #76).
//
// These replace the test-only decision model that previously stood in for a
// production fence: every rule asserted here is executed by tooling/ code that
// ships, and the reviewer-state half is evaluated by the real #74 evaluator
// rather than a re-implementation. Fixtures are written as behavior classes —
// no provider name and no provider's current wording appears in an assertion.
// ---------------------------------------------------------------------------

const TARGET = "abcdef1234567890abcdef1234567890abcdef12";
const OTHER_TARGET = "1234567890abcdef1234567890abcdef12345678";
const BASE = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";
const OTHER_BASE = "0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e";
const ANCHOR = "2026-09-03T00:00:00.000Z";
const OBSERVED = "2026-09-03T01:00:00.000Z";

// Two distinct marker vocabularies, so a fixture never accidentally matches
// the other reviewer's completion marker and the clean path stays clean.
const PRIMARY_TARGET_PATTERN = "Reviewed commit:[^0-9a-fA-F]*([0-9a-fA-F]{7,40})";
const ADVISOR_TARGET_PATTERN = "Advisory target:[^0-9a-fA-F]*([0-9a-fA-F]{7,40})";

const RECORD = {
  reviewers: [
    {
      id: "primary",
      actors: ["primary-bot"],
      completion_marker: { any_of: ["Reviewed commit:"], target_pattern: PRIMARY_TARGET_PATTERN },
      rate_limit_marker: { any_of: ["Review rate limited"] },
      failure_marker: { any_of: ["run encountered an error"] },
      non_participation_marker: { any_of: ["Skipping this review"] },
      in_flight_marker: { any_of: ["Review is working"] },
    },
    {
      id: "advisor",
      actors: ["advisor-bot"],
      completion_marker: { any_of: ["Actionable comments posted:"], target_pattern: ADVISOR_TARGET_PATTERN },
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
    locator: `conversation-${id}`,
    ...fields,
  };
}

function completionComment(id, login, targetSha, extra = "") {
  const body =
    login === "advisor-bot"
      ? `Actionable comments posted: 0\nAdvisory target: ${targetSha}`
      : `Review complete\nReviewed commit: ${targetSha}`;
  return comment(id, login, `${body}${extra}`);
}

function surface(items, fetchStatus = "fetched") {
  return { fetch_status: fetchStatus, count: items.length, items };
}

function thread(id, isResolved, isOutdated = false) {
  return { id, is_resolved: isResolved, is_outdated: isOutdated, comments: [] };
}

function file(path, status = "modified") {
  return { path, status, previous_path: null };
}

function evidence({
  headSha = TARGET,
  baseSha = BASE,
  body = "Refs #76",
  metadataStatus = "fetched",
  comments = [completionComment(1, "primary-bot", TARGET), completionComment(2, "advisor-bot", TARGET)],
  threads = [],
  threadsStatus = "fetched",
  files = [file("src/app.ts")],
  filesStatus = "fetched",
  reviewSubmissionsStatus = "fetched",
} = {}) {
  return {
    repo: "org/repo",
    pull_number: 76,
    generated_at: OBSERVED,
    pr_metadata:
      metadataStatus === "fetched"
        ? { fetch_status: "fetched", failure: null, head_sha: headSha, base_sha: baseSha, base_ref: "main", state: "open", html_url: null, updated_at: OBSERVED, body }
        : { fetch_status: "failed", failure: { status: 500, message: "boom" }, head_sha: null, base_sha: null, base_ref: null, state: null, html_url: null, updated_at: null, body: null },
    surfaces: {
      conversation_comments: surface(comments),
      review_submissions: surface([], reviewSubmissionsStatus),
      inline_review_comments: surface([]),
      review_threads: surface(threads, threadsStatus),
      pull_request_files: surface(files, filesStatus),
    },
    fetch_failures: 0,
  };
}

function stateFor(snapshot) {
  return evaluateReviewerTargetStates(snapshot, {
    record: RECORD,
    target: { sha: TARGET },
    runAnchor: { ids: [], after: ANCHOR },
  });
}

/** Acknowledge every result revision exactly as it currently stands. */
function acknowledgeAll(state) {
  return state.reviewer_states.flatMap((entry) =>
    (entry.evidence ?? []).map((item) => ({
      canonical_id: item.canonical_id,
      body_digest: item.revision.body_digest,
    })),
  );
}

function baseInputs(overrides = {}) {
  return {
    targetSha: TARGET,
    baseSha: BASE,
    artifacts: ["src/app.ts"],
    verifySha: TARGET,
    requiredReviewers: ["primary"],
    declaredSkills: ["review-code"],
    ...overrides,
  };
}

/** Build snapshot -> #74 state -> fence, auto-acknowledging unless told otherwise. */
function runFence({ snapshot = evidence(), inputs = {}, acknowledged } = {}) {
  const state = stateFor(snapshot);
  const resolved = baseInputs(inputs);
  return {
    state,
    fence: evaluateMergeReadyFence({
      evidence: snapshot,
      state,
      inputs: { ...resolved, acknowledged: acknowledged === undefined ? acknowledgeAll(state) : acknowledged },
    }),
  };
}

function checkOf(fence, id) {
  const found = fence.checks.find((entry) => entry.id === id);
  assert.ok(found, `fence is missing check ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Output shape (Issue #76: the CLI output shape is a production contract, not
// a durable record schema — so it is pinned here rather than validated at
// runtime by a schema validator)
// ---------------------------------------------------------------------------

test("fence output shape is stable: schema, ordered checks, tri-state status", () => {
  const { fence } = runFence();
  assert.equal(fence.schema, MERGE_READY_FENCE_SCHEMA_ID);
  assert.equal(fence.repo, "org/repo");
  assert.equal(fence.pull_number, 76);
  assert.equal(fence.captured_at, OBSERVED);
  assert.deepEqual(fence.target, { sha: TARGET, base_sha: BASE });
  assert.deepEqual(
    fence.checks.map((entry) => entry.id),
    FENCE_CHECK_IDS,
  );
  for (const entry of fence.checks) {
    assert.ok(["pass", "fail", "unknown"].includes(entry.status));
    assert.ok(Array.isArray(entry.reason_codes));
    assert.equal(typeof entry.detail, "object");
  }
  assert.equal(fence.status, "pass");
  assert.deepEqual(fence.reason_codes, []);
});

test("fixture 1 (clean path): current target, complete review, no thread, correct routing", () => {
  const { fence } = runFence();
  assert.equal(fence.status, "pass");
  for (const entry of fence.checks) assert.equal(entry.status, "pass", `${entry.id} was ${entry.status}`);
});

test("fail outranks unknown when both are present", () => {
  const { fence } = runFence({
    snapshot: evidence({ headSha: OTHER_TARGET }),
    inputs: { verifySha: null },
  });
  assert.equal(checkOf(fence, "target-head").status, "fail");
  assert.equal(checkOf(fence, "verify-coherence").status, "unknown");
  assert.equal(fence.status, "fail");
});

// ---------------------------------------------------------------------------
// Target drift
// ---------------------------------------------------------------------------

test("fixture 2: head moved away from the frozen target -> fail", () => {
  const { fence } = runFence({ snapshot: evidence({ headSha: OTHER_TARGET }) });
  const check = checkOf(fence, "target-head");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["target_head_moved"]);
  assert.equal(fence.status, "fail");
});

test("an abbreviated frozen SHA still matches the full current head", () => {
  const { fence } = runFence({ inputs: { targetSha: TARGET.slice(0, 7) } });
  assert.equal(checkOf(fence, "target-head").status, "pass");
});

test("fixture 3: base moved under the frozen range -> fail", () => {
  const { fence } = runFence({ snapshot: evidence({ baseSha: OTHER_BASE }) });
  const check = checkOf(fence, "target-base");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["target_base_moved"]);
});

test("a frozen base that was never recorded is unknown, never a silent pass", () => {
  const { fence } = runFence({ inputs: { baseSha: null } });
  const check = checkOf(fence, "target-base");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["frozen_base_missing"]);
});

test("fixture 4: an artifact appearing outside the frozen set -> fail", () => {
  const { fence } = runFence({
    snapshot: evidence({ files: [file("src/app.ts"), file("src/extra.ts")] }),
  });
  const check = checkOf(fence, "artifact-set");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["artifact_set_expanded"]);
  assert.deepEqual(check.detail.added, ["src/extra.ts"]);
});

test("fixture 4b: an artifact disappearing from the frozen set -> fail (no subset tolerance)", () => {
  const { fence } = runFence({
    inputs: { artifacts: ["src/app.ts", "src/gone.ts"] },
  });
  const check = checkOf(fence, "artifact-set");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["artifact_set_reduced"]);
  assert.deepEqual(check.detail.removed, ["src/gone.ts"]);
});

test("a changed-file surface that did not complete its fetch is unknown, not an empty set", () => {
  const { fence } = runFence({ snapshot: evidence({ files: [], filesStatus: "failed" }) });
  assert.equal(checkOf(fence, "artifact-set").status, "unknown");
  assert.deepEqual(checkOf(fence, "artifact-set").reason_codes, ["changed_files_unavailable"]);
  assert.equal(checkOf(fence, "skill-routing").status, "unknown");
});

// ---------------------------------------------------------------------------
// Required reviewer completion (evaluated by the #74 evaluator, not re-parsed)
// ---------------------------------------------------------------------------

test("fixture 5: completed@target is the only state that satisfies a required reviewer", () => {
  const { state, fence } = runFence();
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "primary").state, "completed@target");
  assert.equal(checkOf(fence, "reviewer-completion").status, "pass");
});

test("fixture 6: not-bound (completed at another target) -> fail", () => {
  const snapshot = evidence({
    comments: [completionComment(1, "primary-bot", OTHER_TARGET), completionComment(2, "advisor-bot", TARGET)],
  });
  const { state, fence } = runFence({ snapshot });
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "primary").state, "not-bound");
  const check = checkOf(fence, "reviewer-completion");
  assert.equal(check.status, "fail");
  assert.ok(check.reason_codes.includes("required_reviewer_not_completed_at_target"));
});

test("fixture 7: in-flight is unknown, never a terminal failure and never a pass", () => {
  const snapshot = evidence({
    comments: [comment(1, "primary-bot", "Review is working on it"), completionComment(2, "advisor-bot", TARGET)],
  });
  const { state, fence } = runFence({ snapshot });
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "primary").state, "in-flight");
  const check = checkOf(fence, "reviewer-completion");
  assert.equal(check.status, "unknown");
  assert.ok(check.reason_codes.includes("required_reviewer_incomplete"));
  assert.equal(fence.status, "unknown");
});

test("fixture 8: silence is unknown and is never converted to 0 findings", () => {
  const snapshot = evidence({
    comments: [comment(1, "primary-bot", "Thanks, taking a look"), completionComment(2, "advisor-bot", TARGET)],
  });
  const { state, fence } = runFence({ snapshot });
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "primary").state, "unknown");
  assert.equal(checkOf(fence, "reviewer-completion").status, "unknown");
  assert.equal(fence.status, "unknown");
});

test("fixture 23: a required reviewer declaring non-participation does not pass the gate", () => {
  const snapshot = evidence({
    comments: [comment(1, "primary-bot", "Skipping this review"), completionComment(2, "advisor-bot", TARGET)],
  });
  const { state, fence } = runFence({ snapshot });
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "primary").state, "declined");
  const check = checkOf(fence, "reviewer-completion");
  assert.equal(check.status, "fail");
  assert.ok(check.reason_codes.includes("required_reviewer_not_completed_at_target"));
});

test("a rate-limited required reviewer is not a pass and not a silent skip", () => {
  const snapshot = evidence({
    comments: [comment(1, "primary-bot", "Review rate limited"), completionComment(2, "advisor-bot", TARGET)],
  });
  const { fence } = runFence({ snapshot });
  assert.equal(checkOf(fence, "reviewer-completion").status, "fail");
});

test("the fence never infers the required set from the record's portfolio defaults", () => {
  const { fence } = runFence({ inputs: { requiredReviewers: [] } });
  const check = checkOf(fence, "reviewer-completion");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["required_reviewers_missing"]);
});

test("a required id absent from the record is unknown, not vacuously satisfied", () => {
  const { fence } = runFence({ inputs: { requiredReviewers: ["nobody"] } });
  const check = checkOf(fence, "reviewer-completion");
  assert.equal(check.status, "unknown");
  assert.ok(check.reason_codes.includes("required_reviewer_unknown_id"));
});

test("the evaluator's own reason codes are propagated rather than re-derived", () => {
  const snapshot = evidence({
    comments: [comment(1, "primary-bot", "Thanks, taking a look"), completionComment(2, "advisor-bot", TARGET)],
  });
  const { state, fence } = runFence({ snapshot });
  const evaluatorCodes = state.reviewer_states.find((entry) => entry.reviewer === "primary").reason_codes;
  assert.ok(evaluatorCodes.length > 0);
  for (const code of evaluatorCodes) {
    assert.ok(checkOf(fence, "reviewer-completion").reason_codes.includes(`reviewer_completion:${code}`));
  }
});

// ---------------------------------------------------------------------------
// Acquisition coverage and result revision coherence
// ---------------------------------------------------------------------------

test("fixture 9: an incomplete acquisition is unknown, on its own check", () => {
  const { fence } = runFence({ snapshot: evidence({ reviewSubmissionsStatus: "partial" }) });
  const check = checkOf(fence, "acquisition-coverage");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["coverage_incomplete"]);
  assert.ok(check.detail.incomplete_surfaces.includes("surface:review_submissions"));
  assert.equal(fence.status, "unknown");
});

test("fixture 10: a result edited in place after triage fails, even though it is still completed@target", () => {
  // The canary #270 class: the completion marker survives the edit, so the
  // reviewer state is unchanged — only the body digest moves.
  const before = evidence();
  const stateBefore = stateFor(before);
  const acknowledged = acknowledgeAll(stateBefore);

  const after = evidence({
    comments: [
      completionComment(1, "primary-bot", TARGET, "\n\nP1: this was added by an in-place edit"),
      completionComment(2, "advisor-bot", TARGET),
    ],
  });
  const stateAfter = stateFor(after);
  assert.equal(stateAfter.reviewer_states.find((entry) => entry.reviewer === "primary").state, "completed@target");

  const fence = evaluateMergeReadyFence({
    evidence: after,
    state: stateAfter,
    inputs: { ...baseInputs(), acknowledged },
  });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "fail");
  assert.ok(check.reason_codes.includes("review_result_changed_after_triage"));
  assert.equal(checkOf(fence, "reviewer-completion").status, "pass");
  assert.equal(fence.status, "fail");
});

test("fixture 10b: an arrived result with no acknowledged revision at all -> fail", () => {
  const { fence } = runFence({ acknowledged: null });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "fail");
  assert.ok(check.reason_codes.includes("result_revision_unacknowledged"));
});

test("an advisory reviewer whose result has already arrived owes revision coherence", () => {
  const state = stateFor(evidence());
  const advisorEvidence = state.reviewer_states.find((entry) => entry.reviewer === "advisor").evidence;
  assert.equal(advisorEvidence.length, 1);
  const onlyPrimary = acknowledgeAll(state).filter(
    (entry) => entry.canonical_id !== advisorEvidence[0].canonical_id,
  );
  const { fence } = runFence({ acknowledged: onlyPrimary });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "fail");
  assert.ok(check.detail.required.some((row) => row.reviewer === "advisor" && row.result === "unacknowledged"));
});

test("an advisory reviewer that has not reported yet does not block", () => {
  const snapshot = evidence({ comments: [completionComment(1, "primary-bot", TARGET)] });
  const { state, fence } = runFence({ snapshot });
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "advisor").state, "unknown");
  assert.equal(checkOf(fence, "result-revision-coherence").status, "pass");
  assert.equal(fence.status, "pass");
});

test("a completed run bound to another target still owes revision coherence", () => {
  const snapshot = evidence({
    comments: [completionComment(1, "primary-bot", TARGET), completionComment(2, "advisor-bot", OTHER_TARGET)],
  });
  const state = stateFor(snapshot);
  assert.equal(state.reviewer_states.find((entry) => entry.reviewer === "advisor").state, "not-bound");
  const fence = evaluateMergeReadyFence({
    evidence: snapshot,
    state,
    inputs: { ...baseInputs(), acknowledged: [] },
  });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "fail");
  assert.ok(check.detail.required.some((row) => row.reviewer === "advisor"));
});

test("revision coherence is unknown, not pass, while the acquisition is incomplete", () => {
  const { fence } = runFence({ snapshot: evidence({ reviewSubmissionsStatus: "partial" }) });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["coverage_incomplete"]);
});

test("an acknowledgement for an id that is not a current result is reported, not silently accepted", () => {
  const state = stateFor(evidence());
  const acknowledged = [...acknowledgeAll(state), { canonical_id: "github://org/repo/pull/76/review/database:999", body_digest: "sha256:deadbeef" }];
  const { fence } = runFence({ acknowledged });
  const check = checkOf(fence, "result-revision-coherence");
  assert.equal(check.status, "pass");
  assert.deepEqual(check.detail.unmatched_acknowledgements, ["github://org/repo/pull/76/review/database:999"]);
});

test("revision coherence judges only sameness — it never inspects the result's content", () => {
  // Two results whose bodies differ only in findings text both pass, as long
  // as each was acknowledged at its current revision. The check says nothing
  // about what the findings mean; that stays with the agent.
  const snapshot = evidence({
    comments: [
      completionComment(1, "primary-bot", TARGET, "\n\nP0: unresolved authorization gap"),
      completionComment(2, "advisor-bot", TARGET),
    ],
  });
  const { fence } = runFence({ snapshot });
  assert.equal(checkOf(fence, "result-revision-coherence").status, "pass");
});

// ---------------------------------------------------------------------------
// Review threads
// ---------------------------------------------------------------------------

test("fixture 11: an unresolved thread blocks even when the finding was semantically fixed", () => {
  const { fence } = runFence({ snapshot: evidence({ threads: [thread("T1", false)] }) });
  const check = checkOf(fence, "review-threads");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["unresolved_review_thread"]);
  assert.deepEqual(check.detail.unresolved_thread_ids, ["T1"]);
});

test("fixture 11b: an outdated unresolved thread is still unresolved", () => {
  const { fence } = runFence({ snapshot: evidence({ threads: [thread("T1", false, true)] }) });
  const check = checkOf(fence, "review-threads");
  assert.equal(check.status, "fail");
  assert.equal(check.detail.unresolved_outdated_count, 1);
});

test("fixture 12: resolved threads pass", () => {
  const { fence } = runFence({ snapshot: evidence({ threads: [thread("T1", true), thread("T2", true)] }) });
  assert.equal(checkOf(fence, "review-threads").status, "pass");
  assert.equal(fence.status, "pass");
});

test("a thread whose resolution state was not returned is unknown, never resolved", () => {
  const { fence } = runFence({ snapshot: evidence({ threads: [thread("T1", null)] }) });
  const check = checkOf(fence, "review-threads");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["thread_resolution_unknown"]);
});

test("a review-thread surface that did not complete its fetch is unknown, not zero threads", () => {
  const { fence } = runFence({ snapshot: evidence({ threads: [], threadsStatus: "failed" }) });
  assert.equal(checkOf(fence, "review-threads").status, "unknown");
});

// ---------------------------------------------------------------------------
// Artifact classification and skill routing
// ---------------------------------------------------------------------------

test("fixture 13: an Executable-only target routes to review-code", () => {
  const classification = classifyArtifactPaths(["src/app.ts", "supabase/migrations/1_init.sql", "package.json"]);
  assert.deepEqual(classification.classes, ["Executable"]);
  assert.deepEqual(classification.required_skills, ["review-code"]);
  assert.deepEqual(classification.unresolved_paths, []);
});

test("fixture 14: a Normative-only target routes to review-doc", () => {
  const classification = classifyArtifactPaths([
    "policy/core.md",
    "AGENTS.md",
    ".ai-dev-foundation/product-rules.md",
    "docs/ADR-0004-review.md",
  ]);
  assert.deepEqual(classification.classes, ["Normative"]);
  assert.deepEqual(classification.required_skills, ["review-doc"]);
});

test("fixture 15: a Mixed target requires both skills", () => {
  const classification = classifyArtifactPaths(["src/app.ts", "policy/core.md"]);
  assert.deepEqual(classification.classes, ["Executable", "Normative"]);
  assert.deepEqual(classification.required_skills, ["review-code", "review-doc"]);
});

test("fixture 16: Informational artifacts add no mandatory review skill", () => {
  const classification = classifyArtifactPaths(["README.md", "CHANGELOG.md"]);
  assert.deepEqual(classification.classes, ["Informational"]);
  assert.deepEqual(classification.required_skills, []);
});

test("fixture 17: an added artifact turning Executable into Mixed is caught by routing, not only by drift", () => {
  const { fence } = runFence({
    snapshot: evidence({ files: [file("src/app.ts"), file("policy/core.md")] }),
    inputs: { artifacts: ["src/app.ts", "policy/core.md"], declaredSkills: ["review-code"] },
  });
  const check = checkOf(fence, "skill-routing");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["required_skill_missing"]);
  assert.deepEqual(check.detail.missing_skills, ["review-doc"]);
  assert.equal(checkOf(fence, "artifact-set").status, "pass");
});

test("declaring more skills than derived is safe and passes", () => {
  const { fence } = runFence({ inputs: { declaredSkills: ["review-code", "review-doc"] } });
  assert.equal(checkOf(fence, "skill-routing").status, "pass");
});

test("the declared skill accepts the distributed skill path form", () => {
  assert.equal(normalizeSkillName(".ai-dev-foundation/skills/review-code.md"), "review-code");
  assert.equal(normalizeSkillName("skills/review-doc.md"), "review-doc");
  assert.equal(normalizeSkillName("review-code"), "review-code");
  const { fence } = runFence({ inputs: { declaredSkills: [".ai-dev-foundation/skills/review-code.md"] } });
  assert.equal(checkOf(fence, "skill-routing").status, "pass");
});

test("fixture 17b: a path the table cannot place is unresolved, never guessed into a class", () => {
  assert.equal(classifyArtifactPath("test/cold-start-validation.md"), null);
  assert.equal(classifyArtifactPath("Dockerfile"), null);
  const { fence } = runFence({
    snapshot: evidence({ files: [file("src/app.ts"), file("test/cold-start-validation.md")] }),
    inputs: { artifacts: ["src/app.ts", "test/cold-start-validation.md"] },
  });
  const check = checkOf(fence, "skill-routing");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["artifact_class_unresolved"]);
  assert.deepEqual(check.detail.unresolved_paths, ["test/cold-start-validation.md"]);
});

test("an unresolved path cannot under-route a Selection that already declared every mandatory skill", () => {
  const { fence } = runFence({
    snapshot: evidence({ files: [file("src/app.ts"), file("test/cold-start-validation.md")] }),
    inputs: {
      artifacts: ["src/app.ts", "test/cold-start-validation.md"],
      declaredSkills: ["review-code", "review-doc"],
    },
  });
  const check = checkOf(fence, "skill-routing");
  assert.equal(check.status, "pass");
  assert.deepEqual(check.reason_codes, ["artifact_class_unresolved_covered_by_declaration"]);
});

test("a Selection that declared no skill at all is unknown, not vacuously routed", () => {
  const { fence } = runFence({ inputs: { declaredSkills: null } });
  assert.equal(checkOf(fence, "skill-routing").status, "unknown");
  assert.deepEqual(checkOf(fence, "skill-routing").reason_codes, ["declared_skills_missing"]);
});

// ---------------------------------------------------------------------------
// Deterministic verification coherence
// ---------------------------------------------------------------------------

test("fixture 18: verify target equal to the frozen target passes", () => {
  const { fence } = runFence();
  assert.equal(checkOf(fence, "verify-coherence").status, "pass");
});

test("fixture 19: verify target different from the frozen target -> fail", () => {
  const { fence } = runFence({ inputs: { verifySha: OTHER_TARGET } });
  const check = checkOf(fence, "verify-coherence");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["verify_target_mismatch"]);
});

test("fixture 20: missing verification evidence is unknown, never assumed current", () => {
  const { fence } = runFence({ inputs: { verifySha: null } });
  const check = checkOf(fence, "verify-coherence");
  assert.equal(check.status, "unknown");
  assert.deepEqual(check.reason_codes, ["verify_evidence_missing"]);
});

// ---------------------------------------------------------------------------
// Auto-close hygiene
// ---------------------------------------------------------------------------

test("fixture 21: a closing keyword in the current PR body -> fail", () => {
  const { fence } = runFence({ snapshot: evidence({ body: "Implements the fence.\n\nCloses #76" }) });
  const check = checkOf(fence, "autoclose-hygiene");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.reason_codes, ["autoclose_keyword_present"]);
  assert.deepEqual(check.detail.references, [{ keyword: "closes", reference: "#76" }]);
});

test("fixture 22: a body that only references an issue passes", () => {
  const { fence } = runFence({ snapshot: evidence({ body: "Refs #76\nDepends on #74" }) });
  assert.equal(checkOf(fence, "autoclose-hygiene").status, "pass");
});

test("every documented closing keyword form is detected, and plain references are not", () => {
  const detected = findClosingKeywordReferences(
    [
      "close #1",
      "closes #2",
      "closed: #3",
      "fix #4",
      "fixes #5",
      "fixed #6",
      "resolve #7",
      "resolves #8",
      "resolved #9",
      "fixes org/repo#10",
      "closes https://github.com/org/repo/issues/11",
    ].join("\n"),
  );
  assert.equal(detected.length, 11);
  assert.deepEqual(findClosingKeywordReferences("Refs #12\nSee #13\nPart of #14"), []);
  assert.deepEqual(findClosingKeywordReferences("this closes the gap"), []);
});

test("an empty PR body passes and a failed metadata fetch is unknown", () => {
  assert.equal(checkOf(runFence({ snapshot: evidence({ body: null }) }).fence, "autoclose-hygiene").status, "pass");
  const { fence } = runFence({ snapshot: evidence({ metadataStatus: "failed" }) });
  assert.equal(checkOf(fence, "autoclose-hygiene").status, "unknown");
  assert.equal(checkOf(fence, "target-head").status, "unknown");
  assert.equal(checkOf(fence, "target-base").status, "unknown");
});

// ---------------------------------------------------------------------------
// Argument contract
// ---------------------------------------------------------------------------

test("the fence CLI accepts no snapshot argument, so stale evidence cannot be supplied", () => {
  assert.throws(
    () => parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1", "--target-sha", TARGET, "--snapshot", "x.json"]),
    /Unrecognized argument: --snapshot/,
  );
});

test("the mandatory arguments are exactly repo, pr and target-sha", () => {
  assert.throws(() => parseMergeReadyFenceArgs(["--pr", "1", "--target-sha", TARGET]), /--repo/);
  assert.throws(() => parseMergeReadyFenceArgs(["--repo", "o/r", "--target-sha", TARGET]), /--pr/);
  assert.throws(() => parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1"]), /--target-sha/);
  assert.throws(() => parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1", "--target-sha"]), /Missing value/);
  const args = parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1", "--target-sha", TARGET]);
  assert.equal(args.artifacts, null);
  assert.equal(args.acknowledged, null);
  assert.deepEqual(args.requiredReviewers, []);
  assert.deepEqual(args.declaredSkills, []);
});

test("repeatable arguments accumulate", () => {
  const args = parseMergeReadyFenceArgs([
    "--repo", "o/r", "--pr", "1", "--target-sha", TARGET,
    "--artifact", "a.ts", "--artifact", "b.md",
    "--required", "primary", "--required", "second",
    "--declared-skill", "review-code", "--declared-skill", "review-doc",
    "--acknowledged", "id-1=sha256:aa", "--acknowledged", "id-2=sha256:bb",
  ]);
  assert.deepEqual(args.artifacts, ["a.ts", "b.md"]);
  assert.deepEqual(args.requiredReviewers, ["primary", "second"]);
  assert.deepEqual(args.declaredSkills, ["review-code", "review-doc"]);
  assert.deepEqual(args.acknowledged, ["id-1=sha256:aa", "id-2=sha256:bb"]);
});

test("acknowledged revisions parse from either separator and report malformed lines", () => {
  const parsed = parseAcknowledgedRevisions(
    ["# comment", "", "github://org/repo/pull/76/review/database:1=sha256:aa", "github://org/repo/pull/76/conversation_comment/database:2 sha256:bb", "garbage"].join("\n"),
  );
  assert.deepEqual(parsed.entries, [
    { canonical_id: "github://org/repo/pull/76/review/database:1", body_digest: "sha256:aa" },
    { canonical_id: "github://org/repo/pull/76/conversation_comment/database:2", body_digest: "sha256:bb" },
  ]);
  assert.deepEqual(parsed.malformed, ["garbage"]);
});

// ---------------------------------------------------------------------------
// Boundary: what the fence must never decide
// ---------------------------------------------------------------------------

test("the fence has no input by which an agent can assert that Resolution is complete", () => {
  const accepted = parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1", "--target-sha", TARGET]);
  for (const key of Object.keys(accepted)) {
    assert.ok(
      !/resolution|resolved|triage|merge_ready|mergeReady|approve/i.test(key),
      `fence argument ${key} would let an agent assert a semantic judgment`,
    );
  }
  assert.throws(
    () => parseMergeReadyFenceArgs(["--repo", "o/r", "--pr", "1", "--target-sha", TARGET, "--resolution-complete"]),
    /Unrecognized argument/,
  );
});

test("a fence pass is not a merge-ready claim: findings can be present and every check still pass", () => {
  // The clean-path fixture carries a result body with a P0 in it. The fence
  // reports pass because every machine-checkable precondition holds; whether
  // the finding is resolved is the agent's judgment, not the fence's.
  const snapshot = evidence({
    comments: [
      completionComment(1, "primary-bot", TARGET, "\n\nP0: something the agent must still triage"),
      completionComment(2, "advisor-bot", TARGET),
    ],
  });
  const { fence } = runFence({ snapshot });
  assert.equal(fence.status, "pass");
});
