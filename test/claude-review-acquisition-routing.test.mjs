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

// Issue #49: the #22 decision ("Claude selected as formal reviewer -> prefer
// the GitHub-native `@claude` route by default") existed only as an
// anonymized narrative aside in review-code.md, never as an execution-reachable
// instruction naming Claude or the actual workflow file. These guards protect
// the dedicated, explicitly-named routing section added to close that gap,
// without loosening the pre-existing anonymization guard on the unrelated
// "Observed example" narrative (see the adjacent review-protocol.test.mjs
// assertions, which this file intentionally does not duplicate).
test("review-code.md gives Claude formal-reviewer selection an execution-reachable GitHub-native preferred route", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  assert.ok(
    containsText(reviewCode, "### Claude formal acquisition routing"),
    "review-code.md must have a dedicated, explicitly-named Claude acquisition routing section",
  );

  assert.ok(
    containsText(
      reviewCode,
      "Claude が Selection Contract 上 reviewer / capability として selection された場合",
    ) &&
      containsText(reviewCode, ".github/workflows/claude-review.yml") &&
      containsText(reviewCode, "preferred/default route として使います"),
    "the Claude routing section must name Claude, the actual workflow file, and state it as the preferred/default route",
  );

  // The preferred route must not be promoted to a mandatory/automatic gate —
  // that would violate the #22/#49 invariant against making Claude mandatory
  // on every PR or an automatic required CI check.
  assert.ok(
    containsText(reviewCode, "Claude を全 PR mandatory にするものでも、automatic required CI check にするものでもなく"),
    "the Claude routing section must disclaim mandatory/automatic-CI status",
  );

  // Fallback to in-session/subagent acquisition must not silently drop the
  // #22 durable evidence requirement.
  assert.ok(
    containsText(reviewCode, "in-session/subagent review を Claude の formal acquisition として使ってよく") &&
      containsText(reviewCode, "durable evidence を") &&
      containsText(reviewCode, "この fallback は durable evidence requirement を免除しません"),
    "the fallback path must still require persisting #22 durable evidence",
  );

  // This is Claude-provider-specific operational guidance; it must not claim
  // to add a rule to the provider-neutral Kernel, and must not touch other
  // providers' acquisition policy.
  assert.ok(
    containsText(reviewCode, "`policy/core.md` Kernel には Claude 固有の rule を追加しません"),
    "the Claude routing section must disclaim adding a Claude-specific Kernel rule",
  );
  assert.ok(
    containsText(reviewCode, "他 provider の") && containsText(reviewCode, "acquisition policy"),
    "the Claude routing section must disclaim changing other providers' acquisition policy",
  );
});

test("review-code.md excludes local/preflight Claude usage from formal required review counting", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  // Closure round (Codex P1 + Claude closure review on PR #50): the boundary
  // section's phrasing must not read as conditioning the entire common
  // `## 手順` procedure (Deterministic verify / Selection / Execution /
  // required review gate) on Claude being the selected reviewer — those
  // steps apply regardless of which reviewer/capability was selected. Only
  // the Claude-specific acquisition routing is conditioned on Claude
  // selection.
  assert.ok(
    containsText(
      reviewCode,
      "直後の `## 手順`（Deterministic verify 以降）は、reviewer / capability の選択にかかわらず共通に適用します。",
    ),
    "the boundary section must state that the common ## 手順 procedure applies regardless of reviewer selection",
  );

  assert.ok(
    containsText(reviewCode, "## Formal review と preflight/local 利用の境界"),
    "review-code.md must have a dedicated section distinguishing preflight/local usage from formal review",
  );

  assert.ok(
    containsText(
      reviewCode,
      "実装 session 中に Claude Code 本体や subagent を使った critique / self-check / design sanity check は自由に行ってよく、この skill の対象外です。",
    ),
    "preflight/local critique must be explicitly declared out of this skill's scope",
  );

  assert.ok(
    containsText(
      reviewCode,
      "required review 数にも expected review set にも算入しません。",
    ),
    "preflight/local usage must not count toward required/expected review membership",
  );

  assert.ok(
    containsText(
      reviewCode,
      "selection されていない preflight/local 利用を、事後的に「Claude review を実施した」として required/expected review の消化根拠にしてはいけません。",
    ),
    "the boundary must explicitly forbid retroactively counting unselected local usage as formal review",
  );
});

test("review-doc.md also excludes local/preflight usage from formal required review counting", async () => {
  // Claude review on PR #50 flagged that the review-code.md-only boundary left
  // the same ambiguity possible for Normative artifact review, since the
  // general "preflight/local doesn't count as formal review" principle isn't
  // specific to Executable's provider-adapter routing gap that motivated
  // Issue #49's review-code.md-focused root cause.
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  assert.ok(
    containsText(reviewDoc, "## Formal review と preflight/local 利用の境界"),
    "review-doc.md must have a dedicated section distinguishing preflight/local usage from formal review",
  );

  assert.ok(
    containsText(
      reviewDoc,
      "required review 数にも expected review set にも算入しません。",
    ),
    "preflight/local usage must not count toward required/expected review membership in review-doc.md",
  );
});

test("review-doc.md points Normative Claude formal review at the same GitHub-native acquisition routing", async () => {
  // Codex P2 on PR #50 closure round 2: the Claude acquisition routing section
  // only existed in review-code.md (Executable), so a Normative artifact
  // review following review-doc.md had no reachable path to the preferred
  // GitHub-native route, leaving Issue #49's routing gap open for that
  // classification. Fixed by a pointer, not a duplicated section, per this
  // repo's "skill does not restate normative rules it doesn't own" convention.
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  assert.ok(
    containsText(
      reviewDoc,
      "Claude が formal reviewer として selection された場合の GitHub-native acquisition routing",
    ) && containsText(reviewDoc, "`skills/review-code.md` の「Claude formal acquisition routing」節に従います。"),
    "review-doc.md must point Claude formal reviewer selection at review-code.md's Claude acquisition routing section",
  );

  // Guard against the pointer regressing into a duplicated copy of the
  // routing rule instead of a reference to the single owning section.
  assert.ok(
    !containsText(reviewDoc, ".github/workflows/claude-review.yml"),
    "review-doc.md must not duplicate the workflow-file-specific routing rule; it must defer to review-code.md",
  );
});

test("core policy is not amended with a Claude-specific Kernel rule by Issue #49", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(
    !/\bClaude\b/.test(core),
    "policy/core.md (the provider-neutral Kernel) must not name Claude specifically",
  );
});
