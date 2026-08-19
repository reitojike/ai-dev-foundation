import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripWhitespace(text) {
  return text.replace(/\s+/g, "");
}

// Ignores all whitespace (not just line-wrap points) on both sides, so prose
// assertions survive any content-preserving Markdown reflow.
function containsText(haystack, needle) {
  return stripWhitespace(haystack).includes(stripWhitespace(needle));
}

test("core policy defines the provider-neutral Review Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  for (const heading of [
    "## Review Protocol",
    "### Artifact classification",
    "### Review contracts",
    "#### Selection Contract",
    "#### Execution Contract",
    "#### Acquisition & Validity Contract",
    "#### Resolution Contract",
    "### Review Adapter boundary",
    "### Failure / retry",
    "### Review stopping rules",
  ]) {
    assert.ok(core.includes(heading), `missing Review Protocol heading: ${heading}`);
  }

  // Artifact classification
  for (const artifactClass of ["**Executable**", "**Normative**", "**Informational**"]) {
    assert.ok(core.includes(artifactClass), `missing artifact class: ${artifactClass}`);
  }

  // Acquisition & Validity invariants
  assert.ok(containsText(core, "CI status は review completion と同義ではありません"));
  assert.ok(containsText(core, "0 findings は positive evidence を必要とします"));
  assert.ok(
    containsText(
      core,
      "確定した reviewed target が expected target と一致しない場合、completion していても invalid です。",
    ),
  );
  assert.ok(containsText(core, "intended artifact set が review されていない場合も invalid です。"));
  assert.ok(
    containsText(core, "positive completion evidence のない empty output は `unknown` として扱います。"),
  );
  assert.ok(containsText(core, "`none` / `unknown` / `failure` を区別し、混同してはいけません。"));

  // Completion and Validity must not both claim ownership of target SHA/range matching:
  // Completion covers run termination/acquisition only; Validity owns the SHA/range match.
  assert.ok(
    !core.includes("intended SHA / range を対象にしている"),
    "Completion must not require intended SHA/range match (that belongs to Validity, see Fix 5)",
  );
  assert.ok(containsText(core, "reviewed SHA / range が intended target と一致している"));
  assert.ok(containsText(core, "quota / timeout / structural な execution / acquisition failure がない"));

  // Acquisition record schema fields
  for (const field of [
    '"reviewer"',
    '"target_sha"',
    '"status"',
    '"validity"',
    '"finding_count"',
    '"result_locator"',
    '"started_at"',
    '"completed_at"',
    '"failure"',
  ]) {
    assert.ok(core.includes(field), `missing record schema field: ${field}`);
  }

  // The record's target_sha is the reviewed/observed target, not the Selection
  // Contract's expected target, and completed-but-invalid must be expressible via
  // status/validity together, without expanding the schema beyond this one field.
  assert.ok(
    containsText(
      core,
      "record の `target_sha` は、Selection Contract の expected target（SHA / commit range）ではなく、実際に reviewed された SHA / range（observed target）を表します。",
    ),
  );
  assert.ok(containsText(core, "`validity` は少なくとも `valid` / `invalid` / `unknown` を表現します。"));
  assert.ok(
    containsText(core, "この場合、record は `status: completed` かつ `validity: invalid` として表現します。"),
  );

  // Reviewed-target evidence consistency: when record.target_sha and the acquired
  // evidence's reviewed target both exist, they must agree; disagreement is invalid,
  // and an unconfirmable reviewed target is unknown (not silently valid).
  assert.ok(
    containsText(
      core,
      "record の `target_sha` と acquired evidence 上の reviewed target が両方存在する場合、両者は一致していなければなりません。",
    ),
  );
  assert.ok(containsText(core, "一致しない場合は invalid です。"));
  assert.ok(
    containsText(core, "reviewed target を Validity 判定に必要な精度で確認できない場合は unknown です。"),
  );

  // Resolution Contract
  assert.ok(
    containsText(
      core,
      "fix / false-positive / needs-verification / technical-dispute / intent-question へ triage する",
    ),
  );
  assert.ok(containsText(core, "human を raw finding の message bus にしない"));
  assert.ok(containsText(core, "pure technical dispute は technical adjudication で解決する"));
  assert.ok(containsText(core, "human escalation は product intent / authority に限る"));
  assert.ok(
    containsText(core, "P0/P1 相当の重大 finding を dismiss する場合は、必要に応じて独立 reviewer の確認を要求する"),
  );
  assert.ok(containsText(core, "accepted finding は drip fix せず、root-cause を確認した上で batch で fix する"));
  assert.ok(containsText(core, "fix 後は全 discovery をやり直さず、targeted closure を基本とする"));
  assert.ok(containsText(core, "review を新しい scope の探索に使わない"));

  // Review Adapter boundary
  for (const fn of ["trigger()", "pollCompletion()", "collectOutputs()", "normalizeFindings()"]) {
    assert.ok(core.includes(fn), `missing adapter boundary function: ${fn}`);
  }
  assert.ok(containsText(core, "という negative claim を恒久仕様にしてはいけません。"));
  assert.ok(
    containsText(
      core,
      "収集した evidence は、comment ID / review ID / run ID / timestamp / target SHA または commit range を可能な範囲で保持します。",
    ),
  );

  // Failure / retry
  assert.ok(containsText(core, "transient failure: bounded retry"));
  assert.ok(
    containsText(core, "quota / rate limit: `unknown` または `failure` として明示し、success に潰さない"),
  );
  assert.ok(
    containsText(
      core,
      "structural capability mismatch: 同じ trigger を無限 retry せず、alternate reviewer / escalation",
    ),
  );
  assert.ok(containsText(core, "empty output: positive completion evidence がなければ `unknown`"));

  // Stopping rules, including the closure Acquisition & Validity gate before merge
  assert.ok(core.includes("closure completion / acquisition / validity 確認"));
  assert.ok(
    containsText(
      core,
      "targeted closure の review run も Acquisition & Validity Contract に従って completion / acquisition / validity を確認してから merge します。",
    ),
  );
  assert.ok(containsText(core, "full discovery は原則 1 round です。"));
  assert.ok(containsText(core, "materially 変えた場合のみ 2 round 目を許容します。"));
  assert.ok(core.includes("semantic discovery（1 round）"));

  // Observed evidence stays a general principle, not a permanent provider rule
  assert.ok(containsText(core, "expected trigger behavior は completion evidence と同義ではありません。"));
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // The generated consumer adapter must be self-contained: it must not reference
  // Foundation-repo-only skill paths that are never distributed to the consumer.
  assert.ok(containsText(core, "実行手順（review skill）は Foundation リポジトリ側に別途保持し、"));
  assert.doesNotMatch(core, /skills\/review-code\.md|skills\/review-doc\.md/);
});

test("review skills document procedure without duplicating normative rules", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  for (const skill of [reviewCode, reviewDoc]) {
    assert.ok(skill.includes("policy/core.md"), "skill must reference policy/core.md");
    assert.doesNotMatch(
      skill,
      /"target_sha": "\.\.\."/,
      "skill must not duplicate the Acquisition & Validity record schema from policy",
    );
    // Neither skill restates the drip-fix prohibition; both defer to Resolution Contract.
    assert.doesNotMatch(skill, /drip fix/, "skill must reference Resolution Contract instead of restating drip fix");
  }

  // review-code.md covers the code review procedure, including the closure validity
  // gate before merge and the manual adapter boundary
  for (const phrase of [
    "Freeze candidate SHA",
    "Selection",
    "Execution",
    "Deterministic verify",
    "Targeted closure",
    "Closure Acquisition & Validity",
    "Merge",
    "Adapter boundary",
    "Manual review pilot",
  ]) {
    assert.ok(reviewCode.includes(phrase), `review-code.md missing: ${phrase}`);
  }
  assert.ok(containsText(reviewCode, "Claude / Codex / CodeRabbit"));

  // SHA-change handling during code review: pre-validity change invalidates the run
  // and re-freezes; a post-discovery fix-driven change proceeds to targeted closure
  // without restarting discovery from scratch.
  assert.ok(
    containsText(reviewCode, "その review target / run を invalid として扱い、新しい SHA で re-freeze して"),
  );
  assert.ok(
    containsText(reviewCode, "valid な discovery の後、手順 7 の batch fix によって SHA が変わった場合は、"),
  );
  assert.ok(containsText(reviewCode, "re-freeze はしますが手順を最初からやり直さず、"));

  // review-code.md must defer to policy Contracts rather than restating their
  // normative conditions (Fix 2): the specific prohibitions below must not reappear
  // verbatim in the skill, only a reference to the owning Contract.
  assert.ok(
    !reviewCode.includes("completed（success を含む）と混同せず未開始・判定不能・失敗をそれぞれ"),
    "review-code.md must not restate the none/unknown/failure distinction; it must reference the Acquisition & Validity Contract",
  );
  // Completion and validity are independent judgments (not a single enum), and a
  // completed-but-invalid run (e.g. stale/wrong SHA) must remain expressible.
  assert.ok(
    !containsText(
      reviewCode,
      "run を completion / validity / `none` / `unknown` / `failure` のいずれかに判定します。",
    ),
    "review-code.md must not collapse completion/validity/none/unknown/failure into a single enum",
  );
  assert.ok(containsText(reviewCode, "completion と validity は独立した判定とし"));
  assert.ok(
    containsText(reviewCode, "target SHA / artifact set 等が一致しない completed run は invalid として表現できます"),
  );
  assert.ok(containsText(reviewCode, "`none` / `unknown` / `failure` は completion / validity と混同せず"));
  assert.ok(
    !containsText(reviewCode, "behavior / blast radius を materially"),
    "review-code.md must not restate the discovery round-limit condition; it must reference Review stopping rules",
  );
  assert.ok(containsText(reviewCode, "Review stopping rules（`policy/core.md`）に従い"));
  assert.ok(containsText(reviewCode, "重大 finding を dismiss する際の確認要否は"));

  // review-doc.md covers the normative document review procedure, including the new
  // Selection / Execution steps (Fix 7) and the closure validity gate (Fix 6)
  for (const phrase of [
    "Mechanical check",
    "Selection",
    "Execution & Semantic discovery",
    "Acquisition & Validity 確認",
    "Triage",
    "Fix",
    "Closure",
  ]) {
    assert.ok(reviewDoc.includes(phrase), `review-doc.md missing: ${phrase}`);
  }
  assert.ok(
    containsText(reviewDoc, "target SHA / range、target artifact set、reviewer / capability を確定します。"),
  );
  assert.ok(
    containsText(
      reviewDoc,
      "Execution Contract に従い reviewer を起動し、trigger 方法と required context を記録した上で、",
    ),
  );
  assert.ok(containsText(reviewDoc, "target SHA / range、target artifact set、"));
  assert.ok(containsText(reviewDoc, "確認できない run の finding は triage へ進めず、"));
  assert.ok(
    containsText(reviewDoc, "closure verification 自体の completion / acquisition / validity も"),
  );

  // review-doc.md must not restate the 2nd-discovery-round prohibition verbatim;
  // it must reference Review stopping rules instead (Fix 2).
  assert.ok(
    !reviewDoc.includes("2 回目の full discovery を追加しません"),
    "review-doc.md must not restate the discovery round-limit condition; it must reference Review stopping rules",
  );
  assert.ok(containsText(reviewDoc, "round 数の扱いは Review stopping rules（`policy/core.md`）に従います。"));
});
