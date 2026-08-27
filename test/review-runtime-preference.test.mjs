import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Issue #59: stage-tracker #118 canary promotion (Verify lane split,
// CodeRabbit misleading-status removal) and manual-on-demand review runtime
// preference (Claude GitHub-native + CodeRabbit manual primary, Codex manual
// on-demand/fallback, Codex automatic no longer assumed as default baseline).

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

test("review-code.md materializes CodeRabbit manual acquisition as a primary candidate without hardcoding a mandatory pairing", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  assert.ok(reviewCode.includes("## Manual-on-demand review runtime preference"));
  assert.ok(
    containsText(
      reviewCode,
      "CodeRabbitのmanual acquisition（明示的な`@coderabbitai review`系command）を、複数perspectiveが必要な場合のprimary candidateの一つとして扱ってよいです。",
    ),
  );

  // CodeRabbit rate-limit/unavailable/invalid acquisition must stay
  // unknown/failure, never converted to success or 0 findings.
  assert.ok(
    containsText(
      reviewCode,
      "CodeRabbit acquisitionがquota / rate limit / unavailable、またはstructurally invalid（intended targetをreviewしていない等）でcompletion evidenceを得られない場合、そのrunはFailure / retry（`policy/core.md`）に従い`unknown`または`failure`として扱い、successや`0findings`へ変換しません。",
    ),
  );

  // Codex manual is an explicit fallback that requires an explicit Selection
  // amendment, not a silent substitution.
  assert.ok(
    containsText(
      reviewCode,
      "alternate reviewerとしてCodexのmanual acquisition（明示的な`@codex review`系command）を選択でき、Selection Contractを明示的にamendした上でそのrunをrequired/expected memberとして扱えます。",
    ),
  );

  // Codex automatic (PR-open) review is no longer assumed as the default
  // baseline runtime preference, but Selection may still choose Codex.
  assert.ok(
    containsText(
      reviewCode,
      "Codexのautomatic（PR-open）reviewを、current runtime preferenceのdefault / baselineとして前提にしません。Selectionで明示的にCodex（automatic / manualのいずれも）を選ぶこと自体は禁止しません。",
    ),
  );

  // Operator boundary: repo code must not claim to have completed an
  // account/UI-level automatic-review setting change.
  assert.ok(
    containsText(
      reviewCode,
      "この skill および Foundation は、review 対象 repository の operator がこの automatic review 設定を変更したことを、repository code から完了したものとして偽装しません。",
    ),
  );

  // Must not upgrade this to a permanent Kernel mandate (e.g. fixed count 2).
  assert.ok(
    containsText(
      reviewCode,
      "required reviewer数を常に固定数（例えば2）へ固定するmandatory pairingにも昇格させません。",
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
