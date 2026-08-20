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

test("core policy defines the Foundation Change Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("## Foundation Change Protocol"));
  assert.ok(
    containsText(core, "Observation は、そのままでは Issue や mandatory rule へ自動的に昇格しません。"),
  );

  for (const reason of [
    "既存の mandatory / manual step を置き換える",
    "material defect を deterministically 防止する",
    "demonstrated recurring / escaped failure へ対処する",
  ]) {
    assert.ok(core.includes(reason), `missing Foundation Change justification: ${reason}`);
  }

  for (const field of [
    "Problem",
    "Evidence",
    "Proposed Change",
    "Expected Effect",
    "Trade-off",
    "Scope",
    "Success Criterion",
  ]) {
    assert.ok(core.includes(field), `Change Proposal must express: ${field}`);
  }

  assert.ok(
    containsText(
      core,
      "単発の friction、style、prompt nicety、効率改善のみを理由に、自動的に mandatory 化しません。",
    ),
  );

  // Foundation Change Protocol stays provider-neutral, like the rest of the Kernel.
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("core policy separates merge-readiness from merge execution authority", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  assert.ok(core.includes("### Merge readiness and merge authority"));
  assert.ok(
    containsText(
      core,
      "review completion（Resolution Contract の完了を含む）が成立した状態を **merge-ready** と呼びます。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "merge execution authority は、Review Protocol とは別の contract / context として扱います。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "current Task、Execution Envelope、または explicit な authority が merge の実行を許可している場合に限り、agent は merge を実行してよいです。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "merge authority が明示されていない場合、または別 authority の承認が必要な場合、agent は merge を実行せず、merge-ready の状態を報告した上で停止し、authority escalation / handoff します。",
    ),
  );

  // This is a stop/report gate, not a new mandatory Human diff-approval or
  // GitHub-required-approval-count rule, and it stays provider-neutral.
  assert.ok(
    containsText(
      core,
      "この分離は、すべての PR で Human diff approval を mandatory にすることを意味しません。GitHub の required approval 数を増やす rule でもありません。provider や model 固有の rule にもしません。",
    ),
  );
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // review-code.md's own merge step must defer execution to the canonical
  // authority contract instead of treating review completion as license to merge.
  assert.ok(
    containsText(
      reviewCode,
      "merge の実行は `policy/core.md` の Merge readiness and merge authority に従い、current Task / Execution Envelope / explicit authority が merge execution を許可している場合のみ行います。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "authority が明示されていない、または別 authority の承認が必要な場合は merge を実行せず、merge-ready の状態を報告して停止し、authority escalation / handoff します。",
    ),
  );

  // Regression proof (converged CodeRabbit + independent Claude Discovery finding
  // on this PR): Step 13 must not contain an unqualified "...時点で merge します"
  // completion sentence a skimming reader/agent could act on as an unconditional
  // merge instruction. Both completion branches must read as a merge-ready
  // determination instead.
  assert.doesNotMatch(
    stripWhitespace(reviewCode),
    /時点でmergeします/,
    "review-code.md Step 13 must not phrase review completion as an unqualified merge instruction",
  );
  assert.ok(
    containsText(
      reviewCode,
      "required review 数の valid discovery と Resolution（手順 6）が完了した時点で merge-ready と判定します。",
    ),
  );
  assert.ok(
    containsText(
      reviewCode,
      "Closure Acquisition & Validity・Closure Resolution が完了した時点で merge-ready と判定します。",
    ),
  );
});
