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

// Issue #49 originally closed a gap by writing an explicitly-named Claude
// acquisition routing section into review-code.md. Issue #72 Phase 1 keeps the
// same invariants but moves them out of prose and into the consumer-owned
// reviewer capability record, so the knowledge is machine-readable and the
// skill stays provider-neutral. These guards follow the invariants to their new
// home rather than the section that used to hold them.
test("the reviewer capability record, not the skill, carries provider-specific acquisition routing", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");
  const example = JSON.parse(await readFile(path.join(root, "templates", "reviewers.example.json"), "utf8"));

  assert.ok(
    !containsText(reviewCode, "### Claude formal acquisition routing"),
    "provider-specific routing must no longer live as a prose section in the skill",
  );
  assert.ok(
    !reviewCode.includes(".github/workflows/claude-review.yml"),
    "the workflow file name is provider-specific knowledge and belongs in the record",
  );
  assert.ok(
    containsText(reviewCode, "## reviewer capability record"),
    "review-code.md must have a section pointing at the record as the owner of that knowledge",
  );
  // This was previously stated as a blanket prohibition that contradicted the documented in-session fallback. The boundary now excludes
  // undeclared reviewers and unselected local review, and makes the fallback
  // formal only once the durable evidence is persisted.
  assert.ok(
    containsText(reviewCode, "record に宣言されていない reviewer は formal acquisition になりません。") &&
      containsText(reviewCode, "selection されていない in-session / local review（`/code-review` 等）も同様です。"),
    "the skill must close the path where an undeclared or unselected local review is mistaken for formal acquisition",
  );
  assert.ok(
    containsText(reviewCode, "その場合は下記 `collectOutputs()` の persist 手順を完了して初めて formal acquisition になります"),
    "the documented in-session fallback must be conditioned on persisting durable evidence, not forbidden outright",
  );

  const claude = example.reviewers.find((reviewer) => reviewer.id === "claude");
  assert.ok(claude, "the example record must carry the Claude reviewer entry");
  assert.equal(claude.trigger.kind, "comment_command");
  assert.ok(claude.trigger.value.includes("@claude"), "the GitHub-native mention trigger must be the declared trigger");

  // Preserved invariant: the GitHub-native workflow is
  // NOT something Foundation distributes. sync.mjs does not materialize .github/
  // into consumers and the reference consumer fixture has none, so most consumer
  // repositories have no such workflow and must fall back — the record has to
  // say so instead of implying universal availability.
  assert.ok(
    claude.notes.includes(".github/workflows/claude-review.yml") &&
      claude.notes.includes("review 対象 repository が個別に用意する必要があり、Foundation は配布しない"),
    "the record must disclaim that the GitHub-native workflow is Foundation-distributed",
  );
  assert.ok(
    claude.notes.includes("workflow が無い repository ではこの trigger は unavailable"),
    "the record must state the common unavailable case for a consumer repository with no such workflow",
  );

  // The preferred route must not become a mandatory/automatic gate — the
  // #22/#49 invariant against making one provider mandatory on every PR. The
  // record expresses this as a single required slot filled from a portfolio,
  // not as every required-class reviewer blocking every PR.
  assert.equal(example.required_selection.count, 1);
  assert.equal(example.required_selection.prefer, "different-provider-family-from-implementer");
  assert.ok(claude.fallback_order.length > 0, "an unavailable first choice must have a declared successor");

  // Fallback to in-session/subagent acquisition must not silently drop the #22
  // durable evidence requirement.
  assert.ok(
    containsText(reviewCode, "in-session / subagent review を formal acquisition として使う場合は") &&
      containsText(reviewCode, "この fallback は durable evidence requirement を免除しません"),
    "the fallback path must still require persisting #22 durable evidence",
  );
});

test("review-code.md excludes local/preflight Claude usage from formal required review counting", async () => {
  const reviewCode = await readFile(path.join(root, "skills", "review-code.md"), "utf8");

  // The boundary section's phrasing must not read as conditioning the entire common
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
  // A review-code.md-only boundary leaves
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

test("review-doc.md points Normative formal review at the same record and acquisition routing", async () => {
  // The acquisition routing once existed only in
  // review-code.md (Executable), so a Normative artifact review following
  // review-doc.md had no reachable path to the preferred route, leaving Issue
  // #49's routing gap open for that classification. Fixed by a pointer, not a
  // duplicated section, per this repo's "skill does not restate normative rules
  // it doesn't own" convention. Issue #72 Phase 1 keeps the pointer and
  // retargets it at the record plus the sections that now own the routing.
  const reviewDoc = await readFile(path.join(root, "skills", "review-doc.md"), "utf8");

  assert.ok(
    containsText(reviewDoc, ".ai-dev-foundation/reviewers.json"),
    "review-doc.md must name the reviewer capability record so Normative review reaches the same reviewer knowledge",
  );
  assert.ok(
    containsText(
      reviewDoc,
      "`skills/review-code.md`（consumer には `.ai-dev-foundation/skills/review-code.md` として配布）の「reviewer capability record」節および「Adapter boundary」節に従います。",
    ),
    "review-doc.md must point at review-code.md's owning sections, in a form resolvable from consumer context too",
  );

  // Guard against the pointer regressing into a duplicated copy of the
  // routing rule instead of a reference to the single owning section.
  assert.ok(
    !containsText(reviewDoc, ".github/workflows/claude-review.yml"),
    "review-doc.md must not duplicate the workflow-file-specific routing rule; it must defer to review-code.md",
  );

  // Closure round 3: the bare Foundation-repo-only path is not
  // resolvable from a consumer's checkout, since sync.mjs materializes skills
  // under .ai-dev-foundation/skills/ and consumers have no skills/ at repo
  // root. The pointer must name the consumer-distributed path too.
  assert.ok(
    containsText(reviewDoc, ".ai-dev-foundation/skills/review-code.md"),
    "review-doc.md's pointer must be resolvable from consumer context, naming the .ai-dev-foundation/skills/ distributed path",
  );
});

test("core policy is not amended with a Claude-specific Kernel rule by Issue #49", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(
    !/\bClaude\b/.test(core),
    "policy/core.md (the provider-neutral Kernel) must not name Claude specifically",
  );
});
