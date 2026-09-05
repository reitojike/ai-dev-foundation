import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_REVIEWER_RECORD_PATH,
  readReviewerRecordFile,
  resolveConsumerReviewerRecordPath,
} from "../tooling/reviewer-record-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fenceCli = path.join(root, "tooling", "merge-ready-fence.mjs");
const evidenceCli = path.join(root, "tooling", "review-evidence.mjs");

// ---------------------------------------------------------------------------
// Issue #96: the review helpers live in the Foundation checkout's tooling/, but
// a consumer following review-code.md / review-doc.md runs them with the
// CONSUMER repository as cwd. Two things have to hold at once, and asserting
// either alone hides the other:
//
//   1. the helper module is reachable from a consumer that has no tooling/ of
//      its own (the documented `node tooling/...` form was not);
//   2. the reviewer capability record it reads is the CONSUMER's, not this
//      Foundation checkout's — the failure the obvious remedy (cd to the
//      Foundation root) would introduce silently.
//
// Path existence proves neither. So the fixtures below give the consumer a
// record that is DISTINGUISHABLE from Foundation's by behaviour: Foundation's
// own record is valid, the consumer's is deliberately invalid and names a
// reviewer id that exists nowhere else. If a run ever fell back to the
// Foundation-local record it would sail past record loading instead of
// reporting that reviewer id, so the assertions below cannot pass by accident.
//
// Every invocation stops before any network call: the record is resolved and
// loaded first, and `--artifacts-file` is read before the acquisition. `--help`
// is deliberately not used — it proves nothing about which record was read.
// ---------------------------------------------------------------------------

const CONSUMER_ONLY_REVIEWER = "consumer-only-reviewer";

function consumerRecord({ valid }) {
  return {
    schema: "ai-dev-foundation/reviewer-capability-record@1",
    required_selection: { count: 1, prefer: "record-order" },
    reviewers: [
      {
        id: CONSUMER_ONLY_REVIEWER,
        display_name: "Consumer Only Reviewer",
        default_class: "required",
        actors: ["consumer-only-bot"],
        trigger: { kind: "comment_command", value: "@consumer-only-bot review" },
        completion_marker: { any_of: ["consumer review complete"] },
        fallback_order: [],
        // The single field that separates the two fixtures. An invalid
        // observed_at makes the helper name this reviewer in its setup error,
        // which is what turns "which record was read" into an observable fact.
        observed_at: valid ? "2026-01-01" : "not-a-date",
      },
    ],
  };
}

async function makeConsumer(t, { valid }) {
  const consumer = await mkdtemp(path.join(os.tmpdir(), "adf-consumer-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await mkdir(path.join(consumer, ".ai-dev-foundation"), { recursive: true });
  await writeFile(
    path.join(consumer, ".ai-dev-foundation", "reviewers.json"),
    `${JSON.stringify(consumerRecord({ valid }), null, 2)}\n`,
    "utf8",
  );
  return consumer;
}

// The documented consumer command path, minus the placeholders: the helper is
// addressed inside the Foundation checkout while cwd stays the consumer.
function runFenceFromConsumer(consumer, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      fenceCli,
      "--repo", "org/repo",
      "--pr", "1",
      "--target-sha", "abc1234",
      "--declared-skill", "review-code",
      "--required", CONSUMER_ONLY_REVIEWER,
      "--run-after", "2026-01-01T00:00:00Z",
      "--artifacts-file", path.join(consumer, "frozen-artifacts.txt"),
      "--token", "dummy",
      ...extraArgs,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
}

function runEvidenceStateFromConsumer(consumer, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      evidenceCli,
      "--repo", "org/repo",
      "--pr", "1",
      "--state",
      "--target-sha", "abc1234",
      "--run-after", "2026-01-01T00:00:00Z",
      "--token", "dummy",
      ...extraArgs,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
}

test("Foundation's own reviewer record stays valid, so a fallback to it is observable", async () => {
  // The whole discriminator below rests on this: Foundation's record loads
  // cleanly. If it ever stopped doing so, a run that silently read it would
  // fail for the same reason a consumer-bound run does, and the tests in this
  // file would stop distinguishing the two.
  const foundation = await readReviewerRecordFile(FOUNDATION_REVIEWER_RECORD_PATH);
  assert.equal(foundation.status, "ok");
  assert.ok(
    !foundation.record.reviewers.some((reviewer) => reviewer.id === CONSUMER_ONLY_REVIEWER),
    "the consumer-only reviewer id must not exist in Foundation's own record",
  );
});

test("merge-ready-fence run from a consumer cwd reads the CONSUMER reviewer record", async (t) => {
  const consumer = await makeConsumer(t, { valid: false });

  const result = runFenceFromConsumer(consumer);

  // Reachability: a consumer has no tooling/ of its own, so this only runs at
  // all because the helper is addressed inside the Foundation checkout.
  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);

  // Consumer binding, by content: the reviewer id and the invalid field come
  // from the consumer's record. Foundation's record is valid and contains
  // neither, so this output is unreachable from a Foundation-local read.
  assert.match(result.stderr, /Reviewer record invalid/);
  assert.match(result.stderr, new RegExp(CONSUMER_ONLY_REVIEWER));
  assert.match(result.stderr, /observed_at/);
  assert.ok(
    result.stderr.includes(path.join(consumer, ".ai-dev-foundation", "reviewers.json")),
    "the helper must report the consumer record path it read",
  );
  assert.ok(
    !result.stderr.includes(FOUNDATION_REVIEWER_RECORD_PATH),
    "the helper must not have touched this Foundation checkout's own record",
  );
  assert.equal(result.stdout.trim(), "", "a setup failure is not a fence verdict");
});

test("a valid consumer record is accepted and the documented fence arguments are consumed", async (t) => {
  const consumer = await makeConsumer(t, { valid: true });

  const result = runFenceFromConsumer(consumer);

  // Same invocation, valid consumer record: the run now gets PAST record
  // loading and stops at the next consumer-owned input on the documented
  // command path, which is where a supported path is meant to stop when the
  // frozen artifact list is absent. That is the proof the record was used
  // rather than merely located.
  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /Reviewer record/);
  assert.match(result.stderr, /frozen-artifacts\.txt/);
  assert.match(result.stderr, /Usage: node tooling\/merge-ready-fence\.mjs/);
});

test("review-evidence --state run from a consumer cwd reads the CONSUMER reviewer record", async (t) => {
  const consumer = await makeConsumer(t, { valid: false });

  const result = runEvidenceStateFromConsumer(consumer);

  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr, /Reviewer record invalid/);
  assert.match(result.stderr, new RegExp(CONSUMER_ONLY_REVIEWER));
  assert.ok(
    !result.stderr.includes(FOUNDATION_REVIEWER_RECORD_PATH),
    "the helper must not have touched this Foundation checkout's own record",
  );
});

test("no cwd switch lets a helper consume Foundation-local record state silently", () => {
  // The remedy Issue #96 rules out: `cd` to the Foundation checkout so the
  // relative `node tooling/...` command resolves. The helper refuses instead of
  // substituting its own record, and refuses BEFORE the acquisition, so the
  // substitution can never reach a verdict.
  for (const [label, cli] of [["fence", fenceCli], ["evidence", evidenceCli]]) {
    const args = cli === fenceCli
      ? [cli, "--repo", "org/repo", "--pr", "1", "--target-sha", "abc1234", "--token", "dummy"]
      : [cli, "--repo", "org/repo", "--pr", "1", "--state", "--target-sha", "abc1234",
         "--run-after", "2026-01-01T00:00:00Z", "--token", "dummy"];
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 2, `${label}: ${result.stderr}`);
    assert.match(result.stderr, /Refusing to default the reviewer capability record/, label);
    assert.match(result.stderr, /--record/, label);
    assert.equal(result.stdout.trim(), "", `${label}: a setup failure emits no verdict`);
  }
});

test("Foundation reviewing itself still works, by naming the record explicitly", () => {
  // The guard is on the SILENT default only. Foundation is a consumer of its
  // own skills, and an explicit --record — the form the skills document — keeps
  // that path open.
  const result = spawnSync(
    process.execPath,
    [
      fenceCli,
      "--repo", "org/repo",
      "--pr", "1",
      "--target-sha", "abc1234",
      "--record", ".ai-dev-foundation/reviewers.json",
      "--artifacts-file", "no-such-artifacts-file.txt",
      "--token", "dummy",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /Refusing to default/);
  assert.match(result.stderr, /no-such-artifacts-file/);
});

test("record resolution binds to the cwd it is given, and refuses only the Foundation default", () => {
  const consumer = path.join(os.tmpdir(), "adf-resolve-consumer");

  assert.equal(
    resolveConsumerReviewerRecordPath(undefined, consumer),
    path.join(consumer, ".ai-dev-foundation", "reviewers.json"),
  );
  // An explicit path is honoured even when it IS Foundation's own record.
  assert.equal(
    resolveConsumerReviewerRecordPath(".ai-dev-foundation/reviewers.json", root),
    FOUNDATION_REVIEWER_RECORD_PATH,
  );
  assert.throws(() => resolveConsumerReviewerRecordPath(undefined, root), /Refusing to default/);
});

test("both review skills document a helper path that does not depend on a consumer-local tooling/", async () => {
  for (const name of ["review-code.md", "review-doc.md"]) {
    const skill = await readFile(path.join(root, "skills", name), "utf8");

    // Every runnable example addresses the Foundation checkout explicitly. The
    // bare `node tooling/...` form is what a consumer cannot resolve, so its
    // absence is the contract, not a style preference.
    assert.ok(
      !/^\s*node tooling\//m.test(skill),
      `${name} must not tell a consumer to run a consumer-local tooling/ path`,
    );
    for (const helper of ["review-evidence.mjs", "merge-ready-fence.mjs", "check.mjs"]) {
      const bare = new RegExp(`node (?!<foundation-checkout>/)\\S*tooling/${helper.replace(".", "\\.")}`);
      assert.ok(!bare.test(skill), `${name} must address ${helper} inside <foundation-checkout>/`);
    }

    // The consumer-owned record is named on the documented command path rather
    // than left to a cwd default.
    for (const start of [...skill.matchAll(/node <foundation-checkout>\/tooling\/(merge-ready-fence|review-evidence)\.mjs/g)]) {
      const end = skill.indexOf("```", start.index);
      const block = skill.slice(start.index, end === -1 ? undefined : end);
      assert.ok(
        block.includes("--record .ai-dev-foundation/reviewers.json"),
        `${name}: every helper example must bind --record to the consumer record`,
      );
    }
  }

  // review-doc defers rather than duplicating, in the consumer-resolvable form.
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");
  assert.ok(reviewDoc.includes("## Foundation helper の実行（consumer cwd）"));
  assert.ok(reviewDoc.includes(".ai-dev-foundation/skills/review-code.md"));
});

test("the distributed consumer skill bundle carries the same helper path contract", async () => {
  // A consumer reads .ai-dev-foundation/skills/, never skills/. If the fixture
  // bundle still carried the old command the contract would be fixed only in
  // the source the consumer does not read.
  for (const name of ["review-code.md", "review-doc.md"]) {
    const distributed = await readFile(
      path.join(root, "test", "fixtures", "consumer", ".ai-dev-foundation", "skills", name),
      "utf8",
    );
    assert.ok(!/^\s*node tooling\//m.test(distributed), `distributed ${name} still uses a consumer-local tooling/ path`);
    assert.ok(distributed.includes("node <foundation-checkout>/tooling/"), `distributed ${name} must address the Foundation checkout`);
  }
});
