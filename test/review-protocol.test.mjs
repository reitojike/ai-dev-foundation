import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flatten(text) {
  return text.replace(/\s+/g, " ");
}

test("core policy defines the provider-neutral Review Protocol", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const flat = flatten(core);

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
    assert.ok(flat.includes(artifactClass), `missing artifact class: ${artifactClass}`);
  }

  // Acquisition & Validity invariants
  assert.ok(flat.includes("CI status は review completion と同義ではありません"));
  assert.ok(flat.includes("0 findings は positive evidence を必要とします"));
  assert.ok(
    flat.includes(
      "reviewed SHA / range が target と一致しない場合、completion していても invalid です。",
    ),
  );
  assert.ok(flat.includes("intended artifact set が review されていない場合も invalid です。"));
  assert.ok(
    flat.includes(
      "positive completion evidence のない empty output は `unknown` として扱います。",
    ),
  );
  assert.ok(
    flat.includes("`none` / `unknown` / `failure` を区別し、混同してはいけません。"),
  );

  // Acquisition record schema fields
  for (const field of [
    '"reviewer"',
    '"target_sha"',
    '"status"',
    '"finding_count"',
    '"result_locator"',
    '"started_at"',
    '"completed_at"',
    '"failure"',
  ]) {
    assert.ok(core.includes(field), `missing record schema field: ${field}`);
  }

  // Resolution Contract
  assert.ok(
    flat.includes(
      "fix / false-positive / needs-verification / technical-dispute / intent-question へ triage する",
    ),
  );
  assert.ok(flat.includes("human を raw finding の message bus にしない"));
  assert.ok(flat.includes("pure technical dispute は technical adjudication で解決する"));
  assert.ok(flat.includes("human escalation は product intent / authority に限る"));
  assert.ok(
    flat.includes("accepted finding は drip fix せず、root-cause を確認した上で batch で fix する"),
  );
  assert.ok(flat.includes("fix 後は全 discovery をやり直さず、targeted closure を基本とする"));
  assert.ok(flat.includes("review を新しい scope の探索に使わない"));

  // Review Adapter boundary
  for (const fn of ["trigger()", "pollCompletion()", "collectOutputs()", "normalizeFindings()"]) {
    assert.ok(core.includes(fn), `missing adapter boundary function: ${fn}`);
  }
  assert.ok(flat.includes("という negative claim を恒久仕様にしてはいけません。"));

  // Failure / retry
  assert.ok(flat.includes("transient failure: bounded retry"));
  assert.ok(
    flat.includes("quota / rate limit: `unknown` または `failure` として明示し、success に潰さない"),
  );
  assert.ok(
    flat.includes(
      "structural capability mismatch: 同じ trigger を無限 retry せず、alternate reviewer / escalation",
    ),
  );
  assert.ok(flat.includes("empty output: positive completion evidence がなければ `unknown`"));

  // Stopping rules
  assert.ok(flat.includes("full discovery は原則 1 round です。"));
  assert.ok(flat.includes("materially 変えた場合のみ 2 round 目を許容します。"));
  assert.ok(flat.includes("semantic discovery（1 round）"));

  // Observed evidence stays a general principle, not a permanent provider rule
  assert.ok(flat.includes("expected trigger behavior は completion evidence と同義ではありません。"));
  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);

  // The generated consumer adapter must be self-contained: it must not reference
  // Foundation-repo-only skill paths that are never distributed to the consumer.
  assert.ok(core.includes("実行手順（review skill）は Foundation リポジトリ側に別途保持し、"));
  assert.doesNotMatch(core, /skills\/review-code\.md|skills\/review-doc\.md/);
});

test("review skills document procedure without duplicating normative rules", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  for (const skill of [reviewCode, reviewDoc]) {
    assert.ok(skill.includes("policy/core.md"), "skill must reference policy/core.md");
    assert.doesNotMatch(
      skill,
      /"target_sha": "\.\.\."/,
      "skill must not duplicate the Acquisition & Validity record schema from policy",
    );
  }

  // review-code.md covers the code review procedure and manual adapter boundary
  for (const phrase of [
    "Freeze candidate SHA",
    "Deterministic verify",
    "Targeted closure",
    "Adapter boundary",
    "Manual review pilot",
  ]) {
    assert.ok(reviewCode.includes(phrase), `review-code.md missing: ${phrase}`);
  }
  assert.match(reviewCode, /Claude.*Codex.*CodeRabbit/);

  // A SHA change before discovery validity is established invalidates the run and
  // requires a re-freeze + re-discovery; a SHA change from an already-accepted fix
  // must NOT restart discovery from scratch (targeted closure, per the stopping rule).
  assert.ok(
    reviewCode.includes(
      "その review target / run を invalid として扱い、新しい SHA で re-freeze して",
    ),
  );
  assert.ok(
    reviewCode.includes("valid な discovery の後、手順 7 の batch fix によって SHA が変わった場合は、"),
  );
  assert.ok(reviewCode.includes("re-freeze はしますが手順を最初からやり直さず、"));

  // Run state (none/unknown/failure) must be distinguished from a completed run, not
  // presented as an exhaustive 3-state enum that a successful completion also falls into.
  assert.ok(
    reviewCode.includes("completed（success を含む）と混同せず未開始・判定不能・失敗をそれぞれ"),
  );

  // review-doc.md covers the normative document review procedure
  for (const phrase of [
    "Mechanical check",
    "Semantic discovery",
    "Acquisition & Validity 確認",
    "Triage",
    "Fix",
    "Closure",
  ]) {
    assert.ok(reviewDoc.includes(phrase), `review-doc.md missing: ${phrase}`);
  }
  assert.ok(flatten(reviewDoc).includes("drip fix"));

  // review-doc.md must confirm completion/acquisition/validity before handing findings
  // to triage, referencing the policy contract rather than restating it.
  assert.ok(
    reviewDoc.includes("target SHA / range、target artifact set、completion、"),
  );
  assert.ok(reviewDoc.includes("確認できない run の finding は triage へ進めず、"));

  assert.ok(core.length > 0);
});
