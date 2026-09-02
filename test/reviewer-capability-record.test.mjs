import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseReviewEvidenceArgs } from "../tooling/review-evidence-lib.mjs";
import { evaluateReviewerStates } from "../tooling/reviewer-state-lib.mjs";
import { REVIEWER_RECORD_SCHEMA_ID, readReviewerRecordFile, validateReviewerRecord } from "../tooling/reviewer-record-lib.mjs";

// Issue #72 Phase 1: the reviewer capability record makes "which reviewers
// exist, how are they triggered, what counts as completion" machine-readable
// instead of prose an agent rediscovers each session.
//
// The record deliberately does NOT say where a reviewer's output appears.
// Predicting the surface is a negative claim the Kernel forbids, and PR #73
// broke it twice in one day: the same reviewer posted its result as a review
// submission when it had findings and as a plain comment when it did not.
// Completion is therefore read structurally where GitHub gives it meaning (a
// submitted review bound to a commit), and from a declared marker only on the
// surfaces GitHub leaves semantics-free.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "consumer");
const TARGET_PATTERN = "Reviewed commit:[^0-9a-fA-F]*([0-9a-fA-F]{7,40})";

function containsText(haystack, needle) {
  return haystack.replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
}

function baseReviewer(overrides = {}) {
  return {
    id: "r1",
    display_name: "Reviewer One",
    default_class: "required",
    provider_family: "family-one",
    actors: ["r1-bot"],
    trigger: { kind: "comment_command", value: "@r1 review" },
    completion_marker: { any_of: ["Reviewed commit:"], target_pattern: TARGET_PATTERN },
    fallback_order: [],
    observed_at: "2026-09-02",
    ...overrides,
  };
}

function baseRecord(overrides = {}) {
  return {
    schema: REVIEWER_RECORD_SCHEMA_ID,
    required_selection: { count: 1, prefer: "different-provider-family-from-implementer" },
    reviewers: [baseReviewer()],
    ...overrides,
  };
}

// --- schema -----------------------------------------------------------------

test("the shipped example record and both in-repo copies satisfy the schema", async () => {
  for (const relative of [
    path.join("templates", "reviewers.example.json"),
    path.join(".ai-dev-foundation", "reviewers.json"),
    path.join("test", "fixtures", "consumer", ".ai-dev-foundation", "reviewers.json"),
  ]) {
    const loaded = await readReviewerRecordFile(path.join(root, relative));
    assert.equal(loaded.status, "ok", `${relative}: ${loaded.errors.join("; ")}`);
  }
});

test("the two Foundation-maintained record instances stay identical to the example", async () => {
  // Real consumers own their record and may diverge freely. These two are
  // Foundation-maintained copies (this repo reviewing itself, and the reference
  // consumer fixture), so a drift between them and the example would ship an
  // example nobody actually runs.
  const example = await readFile(path.join(root, "templates", "reviewers.example.json"), "utf8");
  for (const relative of [
    path.join(".ai-dev-foundation", "reviewers.json"),
    path.join("test", "fixtures", "consumer", ".ai-dev-foundation", "reviewers.json"),
  ]) {
    assert.equal(await readFile(path.join(root, relative), "utf8"), example, `${relative} drifted from the example`);
  }
});

test("validateReviewerRecord accepts a minimal record and names each missing requirement", () => {
  assert.deepEqual(validateReviewerRecord(baseRecord()), []);

  assert.deepEqual(validateReviewerRecord({ schema: "wrong", reviewers: [] }), [
    `schema: must be "${REVIEWER_RECORD_SCHEMA_ID}"`,
    "reviewers: must be a non-empty array",
  ]);

  const errors = validateReviewerRecord(
    baseRecord({
      reviewers: [
        {
          id: "r1",
          display_name: "",
          default_class: "blocking",
          actors: [],
          trigger: { kind: "comment_command" },
          completion_marker: { any_of: [] },
          fallback_order: ["ghost", "r1"],
          observed_at: "yesterday",
        },
      ],
    }),
  );
  const joined = errors.join("\n");
  assert.match(joined, /display_name: must be a non-empty string/);
  assert.match(joined, /default_class: must be one of required \/ expected \/ advisory/);
  assert.match(joined, /actors: must be a non-empty array/);
  assert.match(joined, /trigger\.value: comment_command needs the literal command/);
  assert.match(joined, /completion_marker\.any_of: must be a non-empty array/);
  assert.match(joined, /fallback_order: unknown reviewer id "ghost"/);
  assert.match(joined, /fallback_order: must not list the reviewer itself/);
  assert.match(joined, /observed_at: must be a YYYY-MM-DD date/);
});

test("the record may not predict which surface a reviewer posts to", () => {
  // The defect this rejects is the one PR #73 hit twice. `result_surfaces` and
  // a marker's `surfaces` are negative claims ("it does not post anywhere
  // else"), and `target_field` is a property of the surface rather than of the
  // reviewer — all three are the evaluator's job, not the record's.
  const errors = validateReviewerRecord(
    baseRecord({
      reviewers: [
        baseReviewer({
          result_surfaces: ["conversation_comments"],
          completion_marker: {
            surfaces: ["review_submissions"],
            any_of: ["done"],
            target_field: "reviewed_sha",
          },
        }),
      ],
    }),
  ).join("\n");

  assert.match(errors, /result_surfaces: not supported/);
  assert.match(errors, /completion_marker\.surfaces: not supported/);
  assert.match(errors, /completion_marker\.target_field: not supported/);
});

test("every marker is optional, because structural evidence needs none", () => {
  // A reviewer that submits GitHub reviews is fully readable without any
  // declared text at all.
  assert.deepEqual(
    validateReviewerRecord(baseRecord({ reviewers: [baseReviewer({ completion_marker: undefined })] })),
    [],
  );
});

test("a target_pattern must compile and actually capture something", () => {
  assert.match(
    validateReviewerRecord(
      baseRecord({
        reviewers: [baseReviewer({ completion_marker: { any_of: ["done"], target_pattern: "Reviewed commit: [0-9a-f]+" } })],
      }),
    ).join("\n"),
    /must contain at least one capture group/,
  );

  assert.match(
    validateReviewerRecord(
      baseRecord({ reviewers: [baseReviewer({ completion_marker: { any_of: ["done"], target_pattern: "([" } })] }),
    ).join("\n"),
    /invalid regular expression/,
  );
});

test("the portfolio decision is required and internally consistent", () => {
  assert.deepEqual(
    validateReviewerRecord(
      baseRecord({ required_selection: { count: 1, prefer: "different-provider-family-from-implementer" } }),
    ),
    [],
  );

  // Codex P2 on PR #73: a record without this block passed every other check
  // while still leaving Selection undecidable.
  assert.match(
    validateReviewerRecord(baseRecord({ required_selection: undefined })).join("\n"),
    /required_selection: is required so Selection can fill the required slot mechanically/,
  );

  const errors = validateReviewerRecord(
    baseRecord({
      required_selection: { count: 2, prefer: "coin-flip" },
      reviewers: [baseReviewer({ provider_family: undefined })],
    }),
  ).join("\n");
  assert.match(errors, /required_selection\.prefer: must be one of/);
  assert.match(errors, /required_selection\.count: 2 exceeds the 1 reviewer/);

  assert.match(
    validateReviewerRecord(
      baseRecord({
        required_selection: { count: 1, prefer: "different-provider-family-from-implementer" },
        reviewers: [baseReviewer({ provider_family: undefined })],
      }),
    ).join("\n"),
    /needs provider_family to be comparable against the implementer's family/,
  );
});

test("the durable record posting convention is decided by the schema, not per consumer", () => {
  assert.deepEqual(validateReviewerRecord(baseRecord({ durable_record: { posting: "new-comment-per-stage" } })), []);
  assert.match(
    validateReviewerRecord(baseRecord({ durable_record: { posting: "edit-one-comment" } })).join("\n"),
    /durable_record\.posting: the only supported value is "new-comment-per-stage"/,
  );
});

test("duplicate reviewer ids are rejected", () => {
  assert.match(
    validateReviewerRecord(baseRecord({ reviewers: [baseReviewer(), baseReviewer()] })).join("\n"),
    /duplicate reviewer id "r1"/,
  );
});

// --- check.mjs --------------------------------------------------------------

function runCheck(consumer) {
  return spawnSync(process.execPath, [path.join(root, "tooling", "check.mjs"), "--consumer", consumer], {
    encoding: "utf8",
  });
}

test("check blocks on a missing, unparsable, or invalid reviewer capability record", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-reviewers-"));
  const consumer = path.join(temporaryRoot, "consumer");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const recordPath = path.join(consumer, ".ai-dev-foundation", "reviewers.json");
  const original = await readFile(recordPath, "utf8");

  assert.equal(runCheck(consumer).status, 0);

  await rm(recordPath);
  const missing = runCheck(consumer);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Reviewer capability record is missing/);
  assert.match(missing.stderr, /reviewers\.example\.json/, "the message must point at the template to copy");

  await writeFile(recordPath, "{ not json");
  const unparsable = runCheck(consumer);
  assert.notEqual(unparsable.status, 0);
  assert.match(unparsable.stderr, /Reviewer capability record is unparsable/);

  await writeFile(recordPath, JSON.stringify({ schema: REVIEWER_RECORD_SCHEMA_ID, reviewers: [] }));
  const invalid = runCheck(consumer);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Reviewer capability record is invalid/);
  assert.match(invalid.stderr, /reviewers: must be a non-empty array/);

  await writeFile(recordPath, original);
  assert.equal(runCheck(consumer).status, 0);
});

test("check reports artifact byte sizes as advisory output that never changes the exit code", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-sizes-"));
  const consumer = path.join(temporaryRoot, "consumer");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const green = runCheck(consumer);
  assert.equal(green.status, 0);
  assert.match(green.stdout, /Artifact sizes \(advisory, no threshold\):/);
  for (const label of ["policy/core.md", "skills/review-code.md", "skills/review-doc.md", "generated AGENTS.md"]) {
    assert.ok(green.stdout.includes(label), `advisory size output missing: ${label}`);
  }
  assert.match(green.stdout, /^ {2}total: \d+ bytes$/m);

  // No threshold: the sizes are reported, never enforced. The only thing that
  // moves the exit code here is real drift.
  await writeFile(path.join(consumer, "AGENTS.md"), "drift\n");
  const drifted = runCheck(consumer);
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stdout, /Artifact sizes \(advisory, no threshold\):/);
});

// --- target completion state ------------------------------------------------

const HEAD = "abc1234def5678";
const ANCESTOR = "9999999aaaa111";

function comment(body, { actor = "r1-bot", created = "2026-09-01T00:00:00Z", updated = null, id = 1 } = {}) {
  return {
    id,
    actor,
    actor_type: "Bot",
    created_at: created,
    updated_at: updated ?? created,
    locator: `https://github.com/octo/demo/pull/1#issuecomment-${id}`,
    body,
  };
}

function submission({
  actor = "r1-bot",
  sha = HEAD,
  state = "COMMENTED",
  body = "",
  at = "2026-09-01T00:00:00Z",
  id = 1,
} = {}) {
  return {
    id,
    actor,
    actor_type: "Bot",
    state,
    reviewed_sha: sha,
    submitted_at: at,
    locator: `https://github.com/octo/demo/pull/1#pullrequestreview-${id}`,
    body,
  };
}

function snapshot({ conversation = [], submissions = [], headSha = HEAD, failedSurfaces = [] } = {}) {
  const surface = (key, items) => ({
    fetch_status: failedSurfaces.includes(key) ? "failed" : "fetched",
    count: failedSurfaces.includes(key) ? null : items.length,
    pages_fetched: 1,
    items: failedSurfaces.includes(key) ? [] : items,
    failure: null,
  });
  return {
    repo: "octo/demo",
    pull_number: 1,
    pr_metadata: { fetch_status: "fetched", head_sha: headSha },
    surfaces: {
      conversation_comments: surface("conversation_comments", conversation),
      review_submissions: surface("review_submissions", submissions),
      inline_review_comments: surface("inline_review_comments", []),
      review_threads: surface("review_threads", []),
      commit_status: { fetch_status: "fetched", failure: null, status: { state: "success", statuses: [] } },
      check_runs: surface("check_runs", []),
    },
    fetch_failures: 0,
  };
}

const FULL_REVIEWER = baseReviewer({
  non_participation_marker: { any_of: ["review skipped"] },
  rate_limit_marker: { any_of: ["Review rate limited"] },
  failure_marker: { any_of: ["max-turns"] },
  in_flight_marker: { any_of: ["is working"] },
  fallback_order: [],
});

function stateFor(conversation, { targetSha = HEAD, reviewer = FULL_REVIEWER, since, ...rest } = {}) {
  const record = {
    schema: REVIEWER_RECORD_SCHEMA_ID,
    required_selection: { count: 1, prefer: "record-order" },
    reviewers: [reviewer],
  };
  return evaluateReviewerStates(snapshot({ conversation, ...rest }), record, { targetSha, since }).reviewers[0];
}

test("a submitted review bound to the target completes without any declared marker", () => {
  // GitHub's own schema says a review submission is a review act on commit_id.
  // Nothing about the provider's output format is needed to read it.
  const reviewer = baseReviewer({ completion_marker: undefined });
  const state = stateFor([], { reviewer, submissions: [submission({ sha: HEAD, id: 9 })] });

  assert.equal(state.target_completion_state, "completed@target");
  assert.equal(state.reason, "structural_review_submission_at_target");
  assert.equal(state.matched_evidence[0].marker_kind, "structural_review_submission");
  assert.equal(state.matched_evidence[0].marker, null);
  assert.equal(state.matched_evidence[0].locator, "https://github.com/octo/demo/pull/1#pullrequestreview-9");
});

test("a submitted review bound to an ancestor is not-bound, and a draft is not a review act", () => {
  const ancestor = stateFor([], { submissions: [submission({ sha: ANCESTOR })] });
  assert.equal(ancestor.target_completion_state, "not-bound");
  assert.equal(ancestor.reason, "completion_evidence_bound_to_other_target");

  const draft = stateFor([], { submissions: [submission({ sha: HEAD, state: "PENDING" })] });
  assert.equal(draft.target_completion_state, "unknown");
});

test("a submission by a different actor never completes this reviewer's slot", () => {
  const state = stateFor([], { submissions: [submission({ actor: "someone-else", sha: HEAD })] });
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "no_completion_evidence");
});

test("the declared marker is the fallback when the reviewer left no submission", () => {
  // PR #73 closure round 2: with no findings the reviewer posted only a plain
  // comment. GitHub gives that no review semantics, so the marker is what makes
  // it readable — and the record does not have to know it was a comment.
  const state = stateFor([comment(`Review done. **Reviewed commit:** \`${HEAD}\``, { id: 7 })]);

  assert.equal(state.target_completion_state, "completed@target");
  assert.equal(state.reason, "completion_marker_bound_to_target");
  assert.equal(state.matched_evidence[0].marker, "Reviewed commit:");
  assert.equal(state.matched_evidence[0].bound_target, HEAD);
});

test("a marker is searched on every fetched surface, not a declared one", () => {
  // The same marker text is read wherever the reviewer put it. Switching
  // surfaces cannot break the record.
  const viaComment = stateFor([comment(`Reviewed commit: ${HEAD}`)]);
  assert.equal(viaComment.target_completion_state, "completed@target");

  // In a submission body the surface's own commit field wins over the text, and
  // here it points elsewhere — so this is not-bound rather than a false pass.
  const viaSubmissionBody = stateFor([], {
    submissions: [submission({ sha: ANCESTOR, body: `Reviewed commit: ${HEAD}` })],
  });
  assert.equal(viaSubmissionBody.target_completion_state, "not-bound");
});

test("an abbreviated SHA binds, but a too-short prefix does not", () => {
  assert.equal(stateFor([comment("Reviewed commit: abc1234")]).target_completion_state, "completed@target");
  assert.equal(stateFor([comment("Reviewed commit: abc123")]).target_completion_state, "unknown");
});

test("a completion marker whose target cannot be resolved stays unknown", () => {
  const state = stateFor([comment("Reviewed commit: (see job log)")]);
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "completion_marker_target_unresolved");
});

test("positive non-participation is declined, and a failure marker is failed", () => {
  const trigger = comment("@r1 review", { actor: "a-maintainer", created: "2026-09-01T00:00:00Z", id: 1 });
  const after = (body) => [trigger, comment(body, { created: "2026-09-01T00:10:00Z", id: 2 })];
  assert.equal(stateFor(after("automatic review skipped")).target_completion_state, "declined");
  assert.equal(stateFor(after("stopped: max-turns reached")).target_completion_state, "failed");
});

test("a rate limit is an unknown state with a rate-limited signal and the declared fallback", () => {
  const reviewer = { ...FULL_REVIEWER, fallback_order: ["r2"] };
  const state = stateFor(
    [
      comment("@r1 review", { actor: "a-maintainer", created: "2026-09-01T00:00:00Z", id: 1 }),
      comment("Review rate limited. 0 remain.", { created: "2026-09-01T00:10:00Z", id: 2 }),
    ],
    { reviewer },
  );

  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.operational_signal, "rate-limited");
  assert.deepEqual(state.fallback_order, ["r2"]);
});

test("an in-flight run is signalled separately, so only that run's end is worth waiting for", () => {
  const state = stateFor([
    comment("@r1 review", { actor: "a-maintainer", created: "2026-09-01T00:00:00Z", id: 1 }),
    comment("Claude Code is working on it", { created: "2026-09-01T00:10:00Z", id: 2 }),
  ]);
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.operational_signal, "in-flight");
});

test("completion at the target is not undone by a later rate limit or in-flight comment", () => {
  const state = stateFor([
    comment(`Reviewed commit: ${HEAD}`, { created: "2026-09-01T00:00:00Z", id: 1 }),
    comment("Review rate limited", { created: "2026-09-02T00:00:00Z", id: 2 }),
  ]);
  assert.equal(state.target_completion_state, "completed@target");
  assert.equal(state.operational_signal, "none");
});

test("markers only count when the item's actor is one of the reviewer's declared actors", () => {
  const state = stateFor([comment(`Reviewed commit: ${HEAD}`, { actor: "someone-else" })]);
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "no_completion_evidence");
});

test("an in-place edited comment is judged on its current body, via updated_at", () => {
  // The single-comment-edited-in-place surface is exactly the one that makes an
  // arrived result look like it never came: the comment is old, its body is new.
  const state = stateFor([
    comment(`Done. Reviewed commit: ${HEAD}`, { created: "2026-09-01T00:00:00Z", updated: "2026-09-02T10:00:00Z" }),
  ]);
  assert.equal(state.target_completion_state, "completed@target");
  assert.equal(state.matched_evidence[0].timestamp, "2026-09-02T10:00:00Z");
});

test("an incomplete fetch is reported as such and never becomes a no-evidence conclusion", () => {
  const state = stateFor([], { failedSurfaces: ["conversation_comments"] });
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "fetch_incomplete");
  assert.equal(state.evidence_complete, false);
  assert.deepEqual(state.incomplete_surfaces, ["conversation_comments"]);
});

test("the expected target defaults to the snapshot head and says so", () => {
  const record = {
    schema: REVIEWER_RECORD_SCHEMA_ID,
    required_selection: { count: 1, prefer: "record-order" },
    reviewers: [FULL_REVIEWER],
  };
  const evidence = snapshot({ conversation: [comment(`Reviewed commit: ${HEAD}`)] });

  const defaulted = evaluateReviewerStates(evidence, record, {});
  assert.equal(defaulted.expected_target, HEAD);
  assert.equal(defaulted.expected_target_source, "snapshot_head");

  const explicit = evaluateReviewerStates(evidence, record, { targetSha: ANCESTOR });
  assert.equal(explicit.expected_target_source, "explicit");
  assert.equal(explicit.reviewers[0].target_completion_state, "not-bound");
});

// --- regressions found by the PR #73 canary review --------------------------

test("a stale non-completion marker from an earlier run does not decide the current target", () => {
  // Codex P1 / CodeRabbit: a `max-turns` or rate-limit comment posted for an
  // earlier run stayed on the PR forever and kept deciding every later target.
  // The reviewer's own trigger command anchors "the current run".
  const conversation = [
    comment("stopped: max-turns reached", { created: "2026-09-01T00:00:00Z", id: 1 }),
    comment("Review rate limited", { created: "2026-09-01T00:05:00Z", id: 2 }),
    comment("@r1 review", { actor: "a-maintainer", created: "2026-09-02T00:00:00Z", id: 3 }),
  ];

  const state = stateFor(conversation);
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "no_completion_evidence", "a pre-anchor failure marker must not report `failed`");
  assert.equal(state.operational_signal, "none", "a pre-anchor rate limit must not trigger a fallback");
  assert.equal(state.run_anchor, "2026-09-02T00:00:00Z");

  const stale = state.matched_evidence.find((match) => match.marker_kind === "failure_marker");
  assert.equal(stale.applies, false);
  assert.equal(stale.scope, "before-run-anchor");

  const fresh = stateFor([
    ...conversation,
    comment("stopped: max-turns reached", { created: "2026-09-02T00:01:00Z", id: 4 }),
  ]);
  assert.equal(fresh.target_completion_state, "failed");
});

test("an unscoped marker is never applied, and --since supplies the missing anchor", () => {
  // Codex P1 on the closure round: with no anchor, every non-target-bound
  // marker was applied, which reintroduced the stale-marker defect for the
  // trigger kinds that have no trigger comment to anchor on.
  const reviewer = { ...FULL_REVIEWER, trigger: { kind: "automatic" } };
  const conversation = [comment("Review rate limited", { created: "2026-09-02T00:10:00Z" })];

  const unscoped = stateFor(conversation, { reviewer });
  assert.equal(unscoped.operational_signal, "none", "an unanchored marker must not decide the current run");
  assert.equal(unscoped.matched_evidence[0].applies, false);
  assert.equal(unscoped.matched_evidence[0].scope, "unscoped");

  assert.equal(stateFor(conversation, { reviewer, since: "2026-09-02T00:00:00Z" }).operational_signal, "rate-limited");
  assert.equal(stateFor(conversation, { reviewer, since: "2026-09-02T01:00:00Z" }).operational_signal, "none");
});

test("run scoping compares instants, not timestamp strings", () => {
  // Codex P2 on the closure round: --since accepts any UTC offset while GitHub
  // returns Z-suffixed timestamps, and those two do not sort lexicographically.
  // 2026-09-02T12:00:00+09:00 is 03:00Z, so a 03:30Z marker is after it.
  const reviewer = { ...FULL_REVIEWER, trigger: { kind: "automatic" } };
  const conversation = [comment("Review rate limited", { created: "2026-09-02T03:30:00Z" })];

  assert.equal(
    stateFor(conversation, { reviewer, since: "2026-09-02T12:00:00+09:00" }).operational_signal,
    "rate-limited",
  );
  assert.equal(stateFor(conversation, { reviewer, since: "2026-09-02T13:00:00+09:00" }).operational_signal, "none");
});

test("a comment whose author is unknown never stands in for the reviewer", () => {
  // Codex P2: `actor: null` (e.g. a deleted account) bypassed the actor check
  // entirely, so any comment carrying a generic marker could complete a
  // required review.
  const state = stateFor([comment(`Reviewed commit: ${HEAD}`, { actor: null })]);
  assert.equal(state.target_completion_state, "unknown");
  assert.equal(state.reason, "no_completion_evidence");
});

test("the CLI rejects a flag with no value instead of silently ignoring it", () => {
  // CodeRabbit: a trailing `--reviewers` left the field undefined, which the
  // `!== undefined` guards then skipped, and `--reviewers --json` consumed the
  // next flag as the record path.
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "1", "--reviewers"]),
    /--reviewers must be followed by a value/,
  );
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "1", "--reviewers", "--json"]),
    /--reviewers must be followed by a value/,
  );
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "1", "--target-sha"]),
    /must be followed by a value/,
  );
  assert.throws(() => parseReviewEvidenceArgs(["--repo", "--pr", "1"]), /--repo must be followed by a value/);
});

test("the CLI accepts --reviewers, --target-sha and --since, and rejects malformed values", () => {
  assert.deepEqual(
    parseReviewEvidenceArgs([
      "--repo",
      "octo/demo",
      "--pr",
      "1",
      "--reviewers",
      "r.json",
      "--target-sha",
      "abc1234",
      "--since",
      "2026-09-02T00:00:00Z",
    ]),
    {
      json: false,
      repo: "octo/demo",
      pr: "1",
      reviewers: "r.json",
      targetSha: "abc1234",
      since: "2026-09-02T00:00:00Z",
    },
  );
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "1", "--target-sha", "nope"]),
    /--target-sha must be a commit SHA/,
  );
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "1", "--since", "yesterday"]),
    /--since must be an ISO 8601 timestamp/,
  );
});

test("the record carries identity and trigger, and only the observed fallback text", () => {
  // What survived three review rounds on PR #73: the record says who posts and
  // how to start them, plus the minimum text needed on surfaces GitHub leaves
  // semantics-free. It says nothing about where the output lands.
  const example = JSON.parse(readFileSync(path.join(root, "templates", "reviewers.example.json"), "utf8"));
  const byId = Object.fromEntries(example.reviewers.map((reviewer) => [reviewer.id, reviewer]));

  for (const reviewer of example.reviewers) {
    assert.ok(!("result_surfaces" in reviewer), `${reviewer.id} must not declare result surfaces`);
    for (const kind of [
      "completion_marker",
      "non_participation_marker",
      "rate_limit_marker",
      "failure_marker",
      "in_flight_marker",
    ]) {
      const marker = reviewer[kind];
      if (!marker) continue;
      assert.ok(!("surfaces" in marker), `${reviewer.id}.${kind} must not declare surfaces`);
      assert.ok(!("target_field" in marker), `${reviewer.id}.${kind} must not declare a target field`);
    }
  }

  // Identity is measured, not guessed: the login carries the [bot] suffix the
  // API actually returns.
  assert.deepEqual(byId.codex.actors, ["chatgpt-codex-connector[bot]"]);
  assert.ok(byId.coderabbitai.actors.includes("coderabbitai[bot]"));

  // The untested entry has to say so rather than look equally measured.
  assert.ok(byId.claude.notes.includes("未実測"));
});

// --- skill binding ----------------------------------------------------------

test("review-code.md binds Selection, Execution and Acquisition to the record", async () => {
  const skill = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  // Symptom 1 (#72): proceeding without knowing which reviewers exist.
  assert.ok(
    containsText(
      skill,
      "最初に reviewer capability record を読みます。record が存在しない、または parse / 最小妥当性 check を通らない場合は、Selection へ進まず停止して escalate します。",
    ),
    "Selection must start by reading the record and stop when it is absent",
  );

  // Execution dispatches on the record's own trigger.kind. CodeRabbit on PR
  // #73: a single "post trigger.value as a comment" instruction was wrong for
  // the automatic / operator_configured kinds, which have no value to post.
  assert.ok(containsText(skill, "起動方法は record の `trigger.kind` で分岐します"));
  for (const kind of ["comment_command", "automatic", "operator_configured"]) {
    assert.ok(containsText(skill, `- \`${kind}\`:`), `Execution must define a route for trigger.kind ${kind}`);
  }

  // Symptom 3 (#72): waiting for a result that already arrived.
  assert.ok(
    containsText(skill, "in-place 編集される surface では、新着 comment ではなく既存 comment の本文変化を見ます。"),
  );
  assert.ok(containsText(skill, "node tooling/review-evidence.mjs --reviewers"));

  // The happy path has to be reachable before the exception handling. Compared
  // on heading position (line-anchored), not on the inline `## 手順` references
  // the header paragraph already makes.
  const headingIndex = (heading) => skill.search(new RegExp(`^${heading}$`, "m"));
  assert.ok(headingIndex("## Happy path") > -1 && headingIndex("## Happy path") < headingIndex("## 手順"));
});
