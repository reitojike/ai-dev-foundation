import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The reviewer portfolio and its runtime preferences (which reviewers are
// required vs. advisory, which acquisition route each uses, what happens when
// one is unavailable) live in the consumer-owned reviewer capability record.
// These guards check that record, plus the provider-neutral procedure in the
// skill that consumes it.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripWhitespace(text) {
  return text.replace(/\s+/g, "");
}

function containsText(haystack, needle) {
  return stripWhitespace(haystack).includes(stripWhitespace(needle));
}

test("root .coderabbit.yaml disables automatic review and every misleading progress/status surface", async () => {
  const config = await readFile(path.join(root, ".coderabbit.yaml"), "utf8");

  assert.match(config, /auto_review:\s*\n\s*enabled:\s*false/);
  assert.match(config, /review_status:\s*false/);
  assert.match(config, /review_progress:\s*false/);
  assert.match(config, /commit_status:\s*false/);
});

// Issue #72 Phase 1 replaced the prose "Manual-on-demand review runtime
// preference" section with the consumer-owned reviewer capability record plus a
// provider-neutral procedure in the skill. The runtime-preference decisions the
// #59 section encoded are still decisions — they just have a machine-readable
// home now, and the PO makes them once when writing the record instead of the
// agent re-deriving them per Task.
test("the reviewer capability record materializes the reviewer portfolio without hardcoding a mandatory pairing", async () => {
  const example = JSON.parse(await readFile(path.join(root, "templates", "reviewers.example.json"), "utf8"));
  const byId = Object.fromEntries(example.reviewers.map((reviewer) => [reviewer.id, reviewer]));

  // Declared advisory: its completion is not a blocker — which is not the same
  // as permission to skip the findings it did produce.
  assert.equal(byId.coderabbitai.default_class, "advisory");
  assert.equal(byId.coderabbitai.trigger.kind, "comment_command");
  assert.ok(byId.coderabbitai.trigger.value.includes("@coderabbitai review"));
  assert.ok(
    byId.coderabbitai.notes.includes("finding の triage / Resolution obligation は class に関係なく残る"),
    "advisory must not read as permission to ignore the findings that did arrive",
  );

  // Rate limit stays a first-class, detectable state that routes to a fallback
  // instead of being converted to success or 0 findings.
  assert.deepEqual(byId.coderabbitai.rate_limit_marker.any_of, ["Review rate limited", "0 remain"]);

  // Required slot: one slot, filled preferring a different provider family from
  // the implementer, with an explicit successor when the first choice is
  // unavailable. Never a fixed pairing of every required-class reviewer.
  assert.equal(example.required_selection.count, 1);
  assert.equal(example.required_selection.prefer, "different-provider-family-from-implementer");
  assert.notEqual(byId.codex.provider_family, byId.claude.provider_family);
  assert.deepEqual(byId.codex.fallback_order, ["claude"]);
  assert.deepEqual(byId.claude.fallback_order, ["codex"]);
  assert.ok(
    example.required_selection.note.includes("Selection amendment で required slot を代替 reviewer の run へ移す"),
    "fallback must be an explicit Selection amendment, not a silent substitution",
  );
  assert.ok(
    example.required_selection.note.includes("Task 固有の Selection Contract の第二正本ではない"),
    "the record must not be promoted to a second source of truth for the Selection Contract",
  );

  // Operator boundary: repo code must not claim to have completed an
  // account/UI-level automatic-review setting change.
  assert.ok(
    byId.codex.notes.includes(
      "operator/account 側の設定であり、その変更を repository code から完了したものとして扱わない",
    ),
  );
});

test("review-code.md keeps the rate-limit and advisory procedure provider-neutral", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  assert.ok(!reviewCode.includes("## Manual-on-demand review runtime preference"));

  // Symptom 2 (#72): waiting for a rate limit to clear instead of falling back.
  assert.ok(
    containsText(
      reviewCode,
      "rate-limit marker を観測したら復帰を待ちません。record の `fallback_order` で次の reviewer へ進み、Selection amendment を記録します。待つのは in-flight な run の終端だけです。",
    ),
  );

  // Advisory semantics must be procedural, not only a policy definition.
  assert.ok(
    containsText(
      reviewCode,
      "advisory member の completion は待たず、blocker にしません。ただし merge-ready 判定までに review surface へ到着した finding は、class に関係なく triage / Resolution の対象です。",
    ),
  );
});

test("policy/core.md Kernel stays provider-neutral after the Issue #59 runtime preference update", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("Next.js + Supabase profile promotes a Code/Build/Database Verify lane reference while keeping the one-command verify contract", async () => {
  const readme = await readFile(
    path.join(root, "profiles", "next-supabase", "quality", "README.md"),
    "utf8",
  );

  assert.ok(readme.includes("## `verify` への集約と responsibility lane"));
  assert.ok(readme.includes("### GitHub Actions verification lane"));

  // The local/agent one-command contract composes the three lanes, in order.
  assert.ok(
    containsText(
      readme,
      '"verify": "npm run verify:code && npm run verify:build && npm run verify:database"',
    ),
    "the profile's suggested verify script must remain a single command composing the three lanes",
  );
  assert.ok(containsText(readme, '"verify:build": "npm run build"'));

  // Reference workflow is documented as non-normative and not auto-distributed.
  assert.ok(readme.includes("profiles/next-supabase/ci/verify-lanes.example.yml"));
  assert.ok(
    containsText(
      readme,
      "このfileは`sync` / `bootstrap-next-supabase.mjs`のどちらからもconsumerへ自動配布されません。",
    ),
  );

  // Must not fragment into more than the three named lanes.
  assert.ok(containsText(readme, "`Verify / Code`・`Verify / Build`・`Verify / Database`"));
});

test("the reference Verify-lane workflow example defines exactly the three named jobs and is not part of the bootstrapped quality directory", async () => {
  const workflow = await readFile(
    path.join(root, "profiles", "next-supabase", "ci", "verify-lanes.example.yml"),
    "utf8",
  );

  for (const jobName of ["Verify / Code", "Verify / Build", "Verify / Database"]) {
    assert.ok(workflow.includes(`name: ${jobName}`), `missing job: ${jobName}`);
  }
  const jobNameCount = [...workflow.matchAll(/^\s{4}name: Verify \/ /gm)].length;
  assert.equal(jobNameCount, 3, "must not fragment into more than the three documented lanes");

  assert.ok(workflow.includes("npm run verify:code"));
  assert.ok(workflow.includes("npm run verify:build"));
  assert.ok(workflow.includes("npm run verify:database"));

  // tooling/lib.mjs's qualityProfileSourceDirectory is scoped to
  // profiles/next-supabase/quality only, so this example must live outside
  // it to stay non-auto-distributed, per the profile README's own claim.
  const lib = await readFile(path.join(root, "tooling", "lib.mjs"), "utf8");
  assert.match(lib, /qualityProfileSourceDirectory\s*=\s*path\.join\(foundationRoot,\s*"profiles",\s*"next-supabase",\s*"quality"\)/);
});
