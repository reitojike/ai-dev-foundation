import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { REVIEWER_RECORD_SCHEMA_ID, readReviewerRecordFile, validateReviewerRecord } from "../tooling/reviewer-record-lib.mjs";

// Issue #72 Phase 1: the reviewer capability record makes "which reviewers
// exist, how are they triggered, what counts as completion" machine-readable
// instead of prose an agent rediscovers each session.
//
// The record deliberately does NOT say where a reviewer's output appears.
// Predicting the surface is a negative claim the Kernel forbids, and it does
// not hold: the same reviewer posts its result as a review submission when it
// has findings and as a plain comment when it does not.
//
// Phase 1 owns the record, its schema, and the check that a consumer has one.
// Deriving a target completion state from it is Phase 1b: doing that mechanically
// needs a canonical identity model across the REST and GraphQL representations of
// the same GitHub objects, which Phase 1 does not define.

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
  // `result_surfaces` and a marker's `surfaces` are negative claims ("it does
  // not post anywhere else"), and `target_field` is a property of the surface
  // rather than of the reviewer — all three are decided when the surfaces are
  // read, not declared per reviewer.
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

test("the completion marker is required, the rest are optional", () => {
  // Completion is what the review procedure has to decide, and the marker is
  // the only thing that distinguishes a finished review from a progress note.
  assert.match(
    validateReviewerRecord(baseRecord({ reviewers: [baseReviewer({ completion_marker: undefined })] })).join("\n"),
    /completion_marker: is required so completion can be told from progress/,
  );

  // A reviewer that never declines, rate-limits or fails omits those markers.
  assert.deepEqual(validateReviewerRecord(baseRecord()), []);
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

  // Without this block a record passes every other check while still leaving
  // Selection undecidable.
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

  // Execution dispatches on the record's own trigger.kind. A single "post
  // trigger.value as a comment" instruction is wrong for the automatic /
  // operator_configured kinds, which have no value to post.
  assert.ok(containsText(skill, "起動方法は record の `trigger.kind` で分岐します"));
  for (const kind of ["comment_command", "automatic", "operator_configured"]) {
    assert.ok(containsText(skill, `- \`${kind}\`:`), `Execution must define a route for trigger.kind ${kind}`);
  }

  // Marker evidence has to be attributable to the reviewer it is claimed for.
  // Without this, any comment carrying a generic "Reviewed commit: <target>" —
  // including the agent's own trigger comment, which contains exactly that —
  // would satisfy a required reviewer's completion.
  assert.ok(
    containsText(skill, "marker evidence として扱ってよいのは、record の `actors` に帰属する item だけです"),
    "marker evidence must be attributable to the record's declared actors",
  );
  assert.ok(
    containsText(
      skill,
      "comment / review 型の surface で actor を確認できない item は、positive completion evidence に使いません",
    ),
    "an item whose author cannot be confirmed must not carry a completion claim",
  );

  // A marker left by an earlier run on the same PR must not decide this one.
  // The anchor is defined per trigger kind, so it exists for every kind rather
  // than only for the one that posts a trigger comment.
  assert.ok(containsText(skill, "marker は、current run を識別する anchor 以後の evidence にのみ適用します"));
  assert.ok(containsText(skill, "`comment_command` では、実際に投稿した trigger comment を run anchor とします"));
  assert.ok(
    containsText(
      skill,
      "`automatic` / `operator_configured` では、Selection / Execution で記録した run 開始時点、またはその run に帰属すると確認できる participation evidence を anchor とします",
    ),
  );
  assert.ok(
    containsText(
      skill,
      "current run への帰属を確定できない marker は、その run の completion / rate-limit / failure / 非参加 のいずれの判定にも使いません",
    ),
    "a marker that cannot be tied to this run must decide nothing about it",
  );

  // The happy path defers the trigger branching to the procedure instead of
  // restating it — a second copy would drift, and the copy it had told an
  // automatic reviewer to post a command it does not have.
  assert.ok(containsText(skill, "5. record の `trigger.kind` に従って reviewer を起動する（分岐の詳細は手順 4）。"));

  // Symptom 3 (#72): waiting for a result that already arrived.
  assert.ok(
    containsText(skill, "in-place 編集される surface では、新着 comment ではなく既存 comment の本文変化を見ます。"),
  );
  assert.ok(
    containsText(skill, "取得した surface を record の marker と突き合わせて"),
    "the skill must send the agent to the record's markers rather than to remembered state",
  );

  // The happy path has to be reachable before the exception handling. Compared
  // on heading position (line-anchored), not on the inline `## 手順` references
  // the header paragraph already makes.
  const headingIndex = (heading) => skill.search(new RegExp(`^${heading}$`, "m"));
  assert.ok(headingIndex("## Happy path") > -1 && headingIndex("## Happy path") < headingIndex("## 手順"));
});
