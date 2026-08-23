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

test("core policy is not amended with a Claude-specific Kernel rule by Issue #49", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(
    !/\bClaude\b/.test(core),
    "policy/core.md (the provider-neutral Kernel) must not name Claude specifically",
  );
});
