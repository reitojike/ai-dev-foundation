import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateReviewerTargetStates } from "../tooling/review-evidence-state-lib.mjs";
import { evaluateMergeReadyFence } from "../tooling/merge-ready-fence-lib.mjs";

// ---------------------------------------------------------------------------
// Real consumer replay for safe base drift (Issue #102, Consumer validation).
//
// The fixture beside this file is observed evidence from reitojike/stage-tracker,
// not a constructed scenario: the head SHAs, base SHAs, ancestry relations and
// changed-path sets were read from that repository's real history. No product
// PR was created to manufacture a base drift, and no consumer behavior is
// changed by this test.
//
// The replay drives the shipping fence with those facts and asserts what the
// mechanism concludes from them. The point is not that the fence agrees with a
// stored answer — it is that on real evidence the mechanism-owned half stops
// exactly where the design says it stops, and hands the rest to the agent.
// ---------------------------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const replay = JSON.parse(
  await readFile(path.join(root, "test", "fixtures", "safe-base-drift", "stage-tracker-replay.json"), "utf8"),
);

const ANCHOR = "2026-09-03T00:00:00.000Z";
const OBSERVED = "2026-09-03T01:00:00.000Z";
const ASSESSMENT_ID = 9001;

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

function comment(id, actor, body) {
  return {
    id,
    actor,
    actor_database_id: `db-${actor}`,
    actor_node_id: `node-${actor}`,
    body,
    created_at: OBSERVED,
    updated_at: OBSERVED,
    locator: `conversation-${id}`,
  };
}

function assessmentComment(caseData, verdict) {
  return comment(
    ASSESSMENT_ID,
    "implementer",
    [
      "## safe-base-drift-assessment",
      "",
      `reviewed_head: ${caseData.reviewed_head}`,
      `frozen_base: ${caseData.frozen_base}`,
      `current_base_tip: ${caseData.advanced_base}`,
      `verdict: ${verdict}`,
      `basis: replayed from ${replay.repo} PR #${caseData.pull_number}; see the fixture's story field for the observed history`,
    ].join("\n"),
  );
}

/**
 * Rebuilds one acquisition snapshot from replayed facts. The base_delta block
 * is the shape fetchBaseDelta() produces for the compare the fixture records.
 */
function snapshotFor(caseData, { verdict = "independent" } = {}) {
  const head = caseData.reviewed_head;
  return {
    repo: replay.repo,
    pull_number: caseData.pull_number,
    generated_at: OBSERVED,
    pr_metadata: {
      fetch_status: "fetched",
      failure: null,
      head_sha: head,
      base_sha: caseData.frozen_base,
      base_ref: "main",
      state: "open",
      html_url: null,
      updated_at: OBSERVED,
      body: `Replay of ${replay.repo} PR #${caseData.pull_number}`,
    },
    base_branch: { fetch_status: "fetched", failure: null, repo: replay.repo, ref: "main", tip_sha: caseData.advanced_base },
    base_delta: {
      fetch_status: "fetched",
      failure: null,
      repo: replay.repo,
      from_sha: caseData.frozen_base,
      to_sha: caseData.advanced_base,
      ancestry: caseData.ancestry,
      ahead_by: caseData.ahead_by,
      behind_by: caseData.behind_by,
      total_commits: caseData.ahead_by,
      artifact_paths: [...caseData.intervening_artifacts].sort(),
    },
    surfaces: {
      conversation_comments: {
        fetch_status: "fetched",
        count: 2,
        items: [comment(1, "primary-bot", `Review complete\nReviewed commit: ${head}`), assessmentComment(caseData, verdict)],
      },
      review_submissions: { fetch_status: "fetched", count: 0, items: [] },
      inline_review_comments: { fetch_status: "fetched", count: 0, items: [] },
      review_threads: { fetch_status: "fetched", count: 0, items: [] },
      pull_request_files: {
        fetch_status: "fetched",
        count: caseData.reviewed_artifacts.length,
        items: caseData.reviewed_artifacts.map((filePath) => ({ path: filePath, status: "modified", previous_path: null })),
      },
    },
    fetch_failures: 0,
  };
}

function fenceFor(caseData, { verdict = "independent", declareAssessment = true } = {}) {
  const snapshot = snapshotFor(caseData, { verdict });
  const state = evaluateReviewerTargetStates(snapshot, {
    record: RECORD,
    target: { sha: caseData.reviewed_head },
    runAnchor: { ids: [], after: ANCHOR },
  });
  const acknowledged = state.reviewer_states.flatMap((entry) =>
    (entry.evidence ?? []).map((item) => ({ canonical_id: item.canonical_id, body_digest: item.revision.body_digest })),
  );
  return evaluateMergeReadyFence({
    evidence: snapshot,
    state,
    inputs: {
      targetSha: caseData.reviewed_head,
      baseSha: caseData.frozen_base,
      artifacts: caseData.reviewed_artifacts,
      verifySha: caseData.reviewed_head,
      verifyBaseSha: caseData.advanced_base,
      driftAssessment: declareAssessment ? String(ASSESSMENT_ID) : null,
      requiredReviewers: ["primary"],
      declaredSkills: ["review-code", "review-doc"],
      acknowledged,
    },
  });
}

function caseById(id) {
  const found = replay.cases.find((entry) => entry.id === id);
  assert.ok(found, `replay fixture is missing case ${id}`);
  return found;
}

function checkOf(fence, id) {
  const found = fence.checks.find((entry) => entry.id === id);
  assert.ok(found, `fence is missing check ${id}`);
  return found;
}

test("replay fixture records every field a later session needs to re-derive the cases", () => {
  assert.ok(replay.cases.length >= 3);
  for (const entry of replay.cases) {
    for (const key of ["id", "pull_number", "story", "reviewed_head", "frozen_base", "advanced_base", "ancestry", "reviewed_artifacts", "intervening_artifacts", "expected"]) {
      assert.ok(entry[key] !== undefined, `case ${entry.id} is missing ${key}`);
    }
    assert.notEqual(entry.frozen_base, entry.advanced_base, `case ${entry.id} records no base movement`);
  }
});

test("real case: PR #321 forward-only drift satisfies every mechanism-owned fact", () => {
  const caseData = caseById("pr-321-forward-only-disjoint");
  const carry = checkOf(fenceFor(caseData), "base-drift-carry-forward");

  assert.equal(carry.detail.intervening_delta.ancestry, "ahead");
  assert.equal(carry.detail.intervening_delta.behind_by, 0);
  assert.equal(carry.detail.intervening_delta.artifact_count, caseData.intervening_artifacts.length);
  assert.deepEqual(carry.detail.artifact_overlap, caseData.expected.artifact_overlap);
  for (const entry of carry.detail.prerequisites) assert.equal(entry.status, "pass", `${entry.id} was ${entry.status}`);
  assert.equal(carry.status, "pass");
  assert.equal(carry.detail.carry_forward, true);
  assert.equal(checkOf(fenceFor(caseData), "target-base").status, "pass");
});

test("real case: PR #321 stays ineligible when the agent recorded no assessment", () => {
  // This is the whole shape of the design on real evidence: the deterministic
  // half is fully satisfied and the base is still not carried forward.
  const caseData = caseById("pr-321-forward-only-disjoint");
  const fence = fenceFor(caseData, { declareAssessment: false });
  assert.equal(checkOf(fence, "base-drift-carry-forward").detail.carry_forward, false);
  assert.equal(checkOf(fence, "target-base").status, "fail");
  assert.equal(fence.status, "fail");
});

test("real case: PR #321 stays ineligible when the agent judged the deltas coupled", () => {
  // The fixture's semantic_observation is the reason this outcome is not
  // hypothetical: these artifact-disjoint deltas touch the same component and
  // the same in-flight convention.
  const caseData = caseById("pr-321-forward-only-disjoint");
  const fence = fenceFor(caseData, { verdict: "coupled" });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "fail");
  assert.ok(carry.reason_codes.includes("drift_assessment_semantic_coupling"));
  assert.deepEqual(carry.detail.artifact_overlap, [], "the disjointness fact is unchanged; only the verdict differs");
  assert.equal(checkOf(fence, "target-base").status, "fail");
});

test("real case: PR #311 is removed by artifact overlap before any verdict is consulted", () => {
  const caseData = caseById("pr-311-artifact-overlap");
  const fence = fenceFor(caseData, { verdict: "independent" });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "fail");
  assert.ok(carry.reason_codes.includes("base_drift_artifact_overlap"));
  assert.ok(carry.detail.artifact_overlap.length > 0);
  // The overlap the fence found is exactly the intersection the fixture records.
  const expected = caseData.reviewed_artifacts.filter((entry) => caseData.intervening_artifacts.includes(entry)).sort();
  assert.deepEqual(carry.detail.artifact_overlap, expected);
  assert.ok(expected.includes("src/app/catalog/_components/EventWriteForm.module.css"));
  assert.equal(checkOf(fence, "target-base").status, "fail");
});

test("real case: the same two commits transposed are a rewind, not a forward-only drift", () => {
  const caseData = caseById("pr-321-rewind-probe");
  const fence = fenceFor(caseData, { verdict: "independent" });
  const carry = checkOf(fence, "base-drift-carry-forward");
  assert.equal(carry.status, "fail");
  assert.ok(carry.reason_codes.includes("base_drift_rewind"));
  assert.equal(checkOf(fence, "target-base").status, "fail");
});

test("every replayed case agrees with the eligibility the fixture recorded", () => {
  for (const caseData of replay.cases) {
    const carry = checkOf(fenceFor(caseData, { verdict: "independent" }), "base-drift-carry-forward");
    const expectedEligible = caseData.expected.deterministic_facts_satisfied === true;
    assert.equal(
      carry.detail.carry_forward,
      expectedEligible,
      `case ${caseData.id}: expected carry_forward ${expectedEligible}, got ${carry.detail.carry_forward} (${carry.reason_codes.join(", ")})`,
    );
  }
});
