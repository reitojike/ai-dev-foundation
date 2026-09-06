// Deterministic merge-ready fence (Issue #76).
//
// Every judgment here is a comparison between two things the caller already
// has: a frozen declaration passed in as an argument, and a fact read out of
// ONE fresh acquisition snapshot. Nothing in this module reads finding text,
// interprets a provider's wording, decides whether a finding is resolved, or
// decides whether merging is allowed. Those stay with the agent
// (policy/core.md, Review contracts / Merge readiness and merge authority).
//
// The module is pure: no fetch, no filesystem, no git, no clock. The CLI
// (tooling/merge-ready-fence.mjs) performs the single fresh acquisition and
// hands the result here.

export const MERGE_READY_FENCE_SCHEMA_ID = "ai-dev-foundation/merge-ready-fence@1";

export const FENCE_STATUSES = ["pass", "fail", "unknown"];

// Emitted in this order, so the output shape is stable for callers that read
// checks positionally as well as by id.
export const FENCE_CHECK_IDS = [
  "target-head",
  "target-base",
  "base-drift-carry-forward",
  "artifact-set",
  "skill-routing",
  "reviewer-completion",
  "result-revision-coherence",
  "acquisition-coverage",
  "review-threads",
  "verify-coherence",
  "autoclose-hygiene",
];

export const ARTIFACT_CLASSES = ["Executable", "Normative", "Informational"];

// The skill routing table of policy/core.md, as data. Informational has no
// mandatory review skill, which is a class property — not an absence of
// information about it.
export const CLASS_REQUIRED_SKILL = {
  Executable: "review-code",
  Normative: "review-doc",
  Informational: null,
};

// Derived, not restated: a second hand-written list beside the routing table
// would silently disagree with it if a class ever gained or lost a mandatory
// skill, and the disagreement would surface as an under-routing that passes.
export const MANDATORY_REVIEW_SKILLS = [...new Set(Object.values(CLASS_REQUIRED_SKILL).filter(Boolean))].sort();

// A reviewer state that means "a completed result object exists on this PR".
// Both are produced only by a completion-kind signal in the #74 evaluator:
// `completed@target` is bound to the frozen target, `not-bound` is a
// completed run at some other target whose findings still survive
// (policy/core.md, Acquisition & Validity Contract, evidence/finding axes).
export const COMPLETED_RESULT_STATES = ["completed@target", "not-bound"];

// ---------------------------------------------------------------------------
// Artifact classification
//
// This table is a relocation of the examples policy/core.md already spells out
// under "Artifact classification" — it is not a new consumer-facing mapping
// language, and there is deliberately no rule DSL and no consumer override
// record in this phase (Issue #76 decisions).
//
// A path this table cannot place is reported as unresolved rather than being
// pushed into a class. Guessing "Informational" for an unrecognised path would
// silently drop a mandatory review skill; guessing "Executable" would silently
// invent an obligation. Neither is the machine's call.
// ---------------------------------------------------------------------------

// ".module.css" also lands here: extensionOf() takes the final "." segment,
// so no separate compound-extension rule is needed (Issue #86).
const EXECUTABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".sql", ".sh", ".bash", ".ps1", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".json", ".yaml", ".yml", ".toml", ".css",
]);

const INFORMATIONAL_BASENAMES = new Set([
  "readme.md", "changelog.md", "license", "license.md", "notice", "notice.md",
]);

// Raster image assets, per the Informational bullet of policy/core.md: neither
// mandatory review skill has text semantics to read in a bitmap, and that is
// true of a product asset (a PWA icon) and a documentation image alike — so the
// product/documentation distinction does not change the required routing and is
// not encoded here. `.svg` is deliberately absent: it is text and can carry
// executable content, which a path-only rule cannot decide, so it stays
// unresolved rather than being called Informational.
const INFORMATIONAL_IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".tif", ".tiff",
]);

const NORMATIVE_BASENAMES = new Set(["agents.md", "claude.md"]);

// Directory names that carry the document kind when the file name does not
// (`docs/architecture/authentication.md`). Compared as whole path segments:
// a substring test would also place `docs/software-architecture/notes.md` and
// `mypolicy/core.md`, whose document kind no classification entry names.
const NORMATIVE_PATH_SEGMENTS = ["policy", "skills", "architecture"];

const NORMATIVE_BASENAME_PATTERNS = [
  /^product([-._].*)?\.md$/,
  /^prd([-._].*)?\.md$/,
  /^roadmap([-._].*)?\.md$/,
  /^ux-ui([-._].*)?\.md$/,
  /^architecture([-._].*)?\.md$/,
  /^adr([-._].*)?\.md$/,
  /-rules\.md$/,
];

function normalizePath(value) {
  return typeof value === "string" ? value.trim().replace(/\\/g, "/").replace(/^\.\//, "") : null;
}

function basenameOf(path) {
  const index = path.lastIndexOf("/");
  return (index === -1 ? path : path.slice(index + 1)).toLowerCase();
}

function extensionOf(basename) {
  const index = basename.lastIndexOf(".");
  return index <= 0 ? "" : basename.slice(index);
}

/** Classify one repository-relative path, or return null when unresolved. */
export function classifyArtifactPath(path) {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  const basename = basenameOf(normalized);
  if (INFORMATIONAL_BASENAMES.has(basename)) return "Informational";
  if (INFORMATIONAL_IMAGE_EXTENSIONS.has(extensionOf(basename))) return "Informational";
  if (EXECUTABLE_EXTENSIONS.has(extensionOf(basename))) return "Executable";
  if (extensionOf(basename) === ".md") {
    const lowered = normalized.toLowerCase();
    if (NORMATIVE_BASENAMES.has(basename)) return "Normative";
    const directories = lowered.split("/").slice(0, -1);
    if (directories.some((segment) => NORMATIVE_PATH_SEGMENTS.includes(segment))) return "Normative";
    if (NORMATIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) return "Normative";
  }
  return null;
}

/**
 * Derive artifact classes and the review skills they make mandatory.
 * Mixed targets fall out of this naturally: two classes with a mandatory
 * skill produce two required skills.
 */
export function classifyArtifactPaths(paths) {
  const classes = new Set();
  const requiredSkills = new Set();
  const unresolved = [];
  const byPath = [];
  for (const path of sortedUnique(paths)) {
    const artifactClass = classifyArtifactPath(path);
    byPath.push({ path, artifact_class: artifactClass });
    if (artifactClass === null) {
      unresolved.push(path);
      continue;
    }
    classes.add(artifactClass);
    const skill = CLASS_REQUIRED_SKILL[artifactClass];
    if (skill) requiredSkills.add(skill);
  }
  return {
    classes: ARTIFACT_CLASSES.filter((value) => classes.has(value)),
    required_skills: [...requiredSkills].sort(),
    unresolved_paths: unresolved,
    by_path: byPath,
  };
}

/**
 * Accepts `review-code`, `skills/review-code.md`, or the distributed
 * `.ai-dev-foundation/skills/review-code.md` form and reduces them to the
 * skill name used by the routing table.
 */
export function normalizeSkillName(value) {
  const normalized = normalizePath(value);
  if (!normalized) return null;
  return basenameOf(normalized).replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------
// Acknowledged review-result revisions (Issue #76 amendment)
//
// A fresh acquisition alone does not close the canary #270 class: a result
// comment can be edited in place to ADD findings while keeping its completion
// marker, and the reviewer's target completion state stays `completed@target`.
// The fence therefore compares the revision the agent actually triaged against
// the revision that exists now.
//
// This is not a Resolution record and not an acknowledgement framework: it
// stores nothing, keeps no history, and says nothing about what the findings
// mean. It answers exactly one question — "is the current version of this
// result the same version that was triaged?"
// ---------------------------------------------------------------------------

/**
 * Parses `<canonical_id>=<body_digest>` / `<canonical_id> <body_digest>`
 * lines. Blank lines and `#` comments are ignored. Splitting on the LAST
 * separator keeps ids that contain `=` intact; a digest never does.
 */
export function parseAcknowledgedRevisions(text) {
  const entries = [];
  const malformed = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^(.*\S)[\s=]+(\S+)$/.exec(trimmed);
    if (!match) {
      malformed.push(trimmed);
      continue;
    }
    entries.push({ canonical_id: match[1].trim(), body_digest: match[2] });
  }
  return { entries, malformed };
}

// ---------------------------------------------------------------------------
// CLI argument contract
//
// Kept beside the evaluator (like parseReviewEvidenceArgs) so the CLI module
// stays a thin entrypoint and the argument shape is directly testable without
// executing it.
//
// Only --repo/--pr/--target-sha are mandatory. Every other frozen declaration
// is optional at the argument level and produces `unknown` for the check that
// needed it — a missing input must never look like a satisfied one.
// ---------------------------------------------------------------------------

export const MERGE_READY_FENCE_USAGE = `Usage: node tooling/merge-ready-fence.mjs --repo <owner/repo> --pr <number> --target-sha <sha>
  [--base-sha <sha>] [--artifact <path>]... [--artifacts-file <path>]
  [--verify-sha <sha>] [--required <reviewer-id>]... [--declared-skill <name>]...
  [--acknowledged <canonical_id>=<body_digest>]... [--acknowledged-file <path>]
  [--verify-base-sha <sha>] [--drift-assessment <comment-id-or-url>]
  [--run-after <iso>] [--run-anchor-id <id>] [--record <path>] [--token <token>]`;

const REPEATABLE_ARGS = new Map([
  ["--artifact", "artifacts"],
  ["--required", "requiredReviewers"],
  ["--declared-skill", "declaredSkills"],
  ["--acknowledged", "acknowledged"],
  ["--run-anchor-id", "runAnchorIds"],
]);

const SINGLE_ARGS = new Map([
  ["--repo", "repo"],
  ["--pr", "pr"],
  ["--target-sha", "targetSha"],
  ["--base-sha", "baseSha"],
  ["--verify-sha", "verifySha"],
  // The base the deterministic verification was composed against. Only the
  // safe-base-drift route reads it; omitting it leaves every existing check
  // exactly as it was (Issue #102).
  ["--verify-base-sha", "verifyBaseSha"],
  // The durable PR comment carrying the agent semantic assessment of a base
  // drift. Passing it is what requests the carry-forward route at all; there
  // is no automatic discovery of an assessment comment.
  ["--drift-assessment", "driftAssessment"],
  ["--artifacts-file", "artifactsFile"],
  ["--acknowledged-file", "acknowledgedFile"],
  ["--run-after", "runAfter"],
  ["--record", "record"],
  ["--token", "token"],
]);

export function parseMergeReadyFenceArgs(argv) {
  const args = {
    artifacts: null,
    artifactsFile: null,
    requiredReviewers: [],
    declaredSkills: [],
    acknowledged: null,
    acknowledgedFile: null,
    runAnchorIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (REPEATABLE_ARGS.has(arg)) {
      const key = REPEATABLE_ARGS.get(arg);
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      if (args[key] === null) args[key] = [];
      args[key].push(value);
      index += 1;
    } else if (SINGLE_ARGS.has(arg)) {
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      args[SINGLE_ARGS.get(arg)] = value;
      index += 1;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (!args.repo || !/^[^/]+\/[^/]+$/.test(args.repo)) throw new Error("--repo <owner/repo> is required");
  if (!args.pr || !/^\d+$/.test(String(args.pr))) throw new Error("--pr <number> is required");
  if (!args.targetSha) throw new Error("--target-sha <sha> is required");
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedUnique(values) {
  const set = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizePath(value);
    if (normalized) set.add(normalized);
  }
  return [...set].sort();
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// Same abbreviation tolerance the #74 evaluator applies when comparing a
// marker-claimed target to the expected one: a 7+ character prefix of either
// side matches, so a short SHA recorded at Selection still compares equal.
function shaEqual(left, right) {
  const a = nonEmpty(left)?.toLowerCase();
  const b = nonEmpty(right)?.toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 7 && b.startsWith(a)) return true;
  if (b.length >= 7 && a.startsWith(b)) return true;
  return false;
}

function check(id, status, reasonCodes = [], detail = {}) {
  return { id, status, reason_codes: [...new Set(reasonCodes)].sort(), detail };
}

function surfaceOf(evidence, name) {
  const surface = evidence?.surfaces?.[name];
  return surface && typeof surface === "object" ? surface : null;
}

/** Current changed artifact paths, or a reason code explaining why not. */
function currentArtifactPaths(evidence) {
  const surface = surfaceOf(evidence, "pull_request_files");
  if (!surface) return { paths: null, reason: "changed_files_unavailable" };
  if (surface.fetch_status !== "fetched") return { paths: null, reason: "changed_files_unavailable" };
  const items = Array.isArray(surface.items) ? surface.items : [];
  if (items.some((item) => !nonEmpty(item?.path))) {
    return { paths: null, reason: "changed_file_path_missing" };
  }
  return { paths: sortedUnique(items.map((item) => item.path)), reason: null };
}

// GitHub's documented closing keywords, followed by an issue reference in any
// of the accepted forms. Kept as one deterministic pattern; there is no
// keyword configuration and no per-repository exception.
const CLOSING_KEYWORD_PATTERN =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(#\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+)/gi;

export function findClosingKeywordReferences(body) {
  if (typeof body !== "string") return [];
  const found = [];
  for (const match of body.matchAll(CLOSING_KEYWORD_PATTERN)) {
    found.push({ keyword: match[1].toLowerCase(), reference: match[2] });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkTargetHead(evidence, inputs) {
  const frozen = nonEmpty(inputs.targetSha);
  if (!frozen) return check("target-head", "unknown", ["frozen_target_missing"]);
  const metadata = evidence?.pr_metadata;
  if (metadata?.fetch_status !== "fetched" || !nonEmpty(metadata.head_sha)) {
    return check("target-head", "unknown", ["pr_metadata_unavailable"]);
  }
  const detail = { frozen_target_sha: frozen, current_head_sha: metadata.head_sha };
  return shaEqual(metadata.head_sha, frozen)
    ? check("target-head", "pass", [], detail)
    : check("target-head", "fail", ["target_head_moved"], detail);
}

// The authority here is where the base branch points NOW, not the PR object's
// `base.sha` (Issue #82). `base.sha` is a snapshot the PR carries: advancing
// the base branch alone does not update it, so comparing against it reports
// `pass` for exactly the ordinary case this check exists to catch — the base
// moved while the PR head stood still. `pr_base_sha` is kept in the detail as
// a diagnostic fact, and is never consulted to reach a verdict.
function checkTargetBase(evidence, inputs, carryForward) {
  const frozen = nonEmpty(inputs.baseSha);
  if (!frozen) return check("target-base", "unknown", ["frozen_base_missing"]);
  const metadata = evidence?.pr_metadata;
  const prBaseSha = metadata?.fetch_status === "fetched" ? nonEmpty(metadata.base_sha) : null;
  const baseBranch = evidence?.base_branch;
  const tip = baseBranch?.fetch_status === "fetched" ? nonEmpty(baseBranch.tip_sha) : null;
  const detail = {
    frozen_base_sha: frozen,
    base_ref: nonEmpty(baseBranch?.ref),
    base_branch_fetch_status: nonEmpty(baseBranch?.fetch_status),
    current_base_tip_sha: tip,
    pr_base_sha: prBaseSha,
  };
  // No confirmed tip is `unknown`, never `pass`: an unreadable base ref is
  // the state in which the base is most likely to have moved unobserved.
  if (!tip) return check("target-base", "unknown", ["base_branch_tip_unavailable"], detail);
  if (shaEqual(tip, frozen)) return check("target-base", "pass", [], detail);
  // A moved base is `fail` unless the safe-base-drift route below reached
  // `carry_forward: true`, which it can only do when the reviewed head never
  // moved, the advance was forward-only and completely acquired, the two
  // artifact sets are disjoint, verification was re-run against the composed
  // state, every other check on this acquisition already passes, and the agent
  // recorded an in-scope `independent` semantic verdict (Issue #102). The
  // carry-forward is named in the reason codes rather than left implicit: a
  // pass reached this way is a different fact from a base that never moved.
  return carryForward?.detail?.carry_forward === true
    ? check("target-base", "pass", ["base_drift_carried_forward"], { ...detail, carry_forward: true })
    : check("target-base", "fail", ["target_base_moved"], detail);
}

function checkArtifactSet(current, inputs) {
  if (!Array.isArray(inputs.artifacts)) {
    return check("artifact-set", "unknown", ["frozen_artifact_set_missing"]);
  }
  if (current.paths === null) {
    return check("artifact-set", "unknown", [current.reason]);
  }
  const frozen = sortedUnique(inputs.artifacts);
  const added = current.paths.filter((path) => !frozen.includes(path));
  const removed = frozen.filter((path) => !current.paths.includes(path));
  const detail = { frozen_count: frozen.length, current_count: current.paths.length, added, removed };
  if (added.length === 0 && removed.length === 0) return check("artifact-set", "pass", [], detail);
  const reasons = [];
  if (added.length > 0) reasons.push("artifact_set_expanded");
  if (removed.length > 0) reasons.push("artifact_set_reduced");
  return check("artifact-set", "fail", reasons, detail);
}

function checkSkillRouting(current, inputs) {
  if (current.paths === null) {
    return check("skill-routing", "unknown", [current.reason]);
  }
  const classification = classifyArtifactPaths(current.paths);
  const declaredList = Array.isArray(inputs.declaredSkills)
    ? [...new Set(inputs.declaredSkills.map(normalizeSkillName).filter(Boolean))].sort()
    : null;
  const detail = {
    derived_classes: classification.classes,
    derived_required_skills: classification.required_skills,
    declared_skills: declaredList,
    unresolved_paths: classification.unresolved_paths,
  };
  if (declaredList === null) {
    return check("skill-routing", "unknown", ["declared_skills_missing"], detail);
  }
  const missing = classification.required_skills.filter((skill) => !declaredList.includes(skill));
  if (missing.length > 0) {
    return check("skill-routing", "fail", ["required_skill_missing"], { ...detail, missing_skills: missing });
  }
  if (classification.unresolved_paths.length > 0) {
    // An unresolved path only threatens routing safety when the Selection
    // could still be missing a mandatory skill. A Selection that already
    // declared every mandatory skill cannot be under-routed by it.
    const declaresEveryMandatorySkill = MANDATORY_REVIEW_SKILLS.every((skill) => declaredList.includes(skill));
    return declaresEveryMandatorySkill
      ? check("skill-routing", "pass", ["artifact_class_unresolved_covered_by_declaration"], detail)
      : check("skill-routing", "unknown", ["artifact_class_unresolved"], detail);
  }
  return check("skill-routing", "pass", [], detail);
}

function checkReviewerCompletion(state, inputs) {
  const required = Array.isArray(inputs.requiredReviewers)
    ? [...new Set(inputs.requiredReviewers.map(nonEmpty).filter(Boolean))]
    : [];
  if (required.length === 0) {
    return check("reviewer-completion", "unknown", ["required_reviewers_missing"]);
  }
  const states = Array.isArray(state?.reviewer_states) ? state.reviewer_states : [];
  const reasons = [];
  const rows = [];
  let status = "pass";
  for (const reviewer of required.sort()) {
    const entry = states.find((candidate) => candidate.reviewer === reviewer) ?? null;
    if (entry === null) {
      reasons.push("required_reviewer_unknown_id");
      rows.push({ reviewer, state: null });
      status = "unknown";
      continue;
    }
    rows.push({ reviewer, state: entry.state, reason_codes: entry.reason_codes ?? [] });
    for (const code of entry.reason_codes ?? []) reasons.push("reviewer_completion:" + code);
    if (entry.state === "completed@target") continue;
    if (entry.state === "in-flight" || entry.state === "unknown") {
      reasons.push("required_reviewer_incomplete");
      if (status !== "fail") status = "unknown";
      continue;
    }
    // `not-bound` / `rate-limited` / `failed` / `declined`. A required
    // member's obligation is not discharged by declaring non-participation
    // (policy/core.md, Selection Contract); changing the required set is a
    // Selection amendment the agent makes, expressed as a different --required.
    reasons.push("required_reviewer_not_completed_at_target");
    status = "fail";
  }
  return check("reviewer-completion", status, reasons, { required: rows });
}

function checkResultRevisionCoherence(state, inputs) {
  const states = Array.isArray(state?.reviewer_states) ? state.reviewer_states : [];
  const withResults = states.filter((entry) => COMPLETED_RESULT_STATES.includes(entry.state));
  const acknowledged = Array.isArray(inputs.acknowledged) ? inputs.acknowledged : null;
  const rows = [];
  const reasons = [];
  let status = "pass";

  // Coverage is gated before "nothing has arrived": an incomplete acquisition
  // is exactly the state in which a result may exist without being visible, so
  // an empty result set proves nothing yet.
  if (state?.coverage_complete !== true) {
    return check("result-revision-coherence", "unknown", ["coverage_incomplete"], {
      required: [],
      incomplete_surfaces: state?.incomplete_surfaces ?? [],
    });
  }
  if (withResults.length === 0) {
    // Nothing has arrived to triage yet. An advisory reviewer that has not
    // reported is not a blocker (policy/core.md, Selection Contract).
    return check("result-revision-coherence", "pass", [], { required: [], unmatched_acknowledgements: [] });
  }

  const matched = new Set();
  for (const entry of withResults) {
    const evidenceItems = Array.isArray(entry.evidence) ? entry.evidence : [];
    if (evidenceItems.length === 0) {
      rows.push({ reviewer: entry.reviewer, state: entry.state, canonical_id: null, result: "unresolved" });
      reasons.push("result_revision_unresolved");
      if (status !== "fail") status = "unknown";
      continue;
    }
    for (const item of evidenceItems) {
      const canonicalId = nonEmpty(item?.canonical_id);
      const currentDigest = nonEmpty(item?.revision?.body_digest);
      if (!canonicalId || !currentDigest) {
        rows.push({ reviewer: entry.reviewer, state: entry.state, canonical_id: canonicalId, result: "unresolved" });
        reasons.push("result_revision_unresolved");
        if (status !== "fail") status = "unknown";
        continue;
      }
      const ack = acknowledged?.find((candidate) => candidate.canonical_id === canonicalId) ?? null;
      if (ack) matched.add(canonicalId);
      const row = {
        reviewer: entry.reviewer,
        state: entry.state,
        canonical_id: canonicalId,
        current_body_digest: currentDigest,
        acknowledged_body_digest: ack?.body_digest ?? null,
      };
      if (!ack) {
        rows.push({ ...row, result: "unacknowledged" });
        reasons.push("result_revision_unacknowledged");
        status = "fail";
      } else if (ack.body_digest !== currentDigest) {
        rows.push({ ...row, result: "changed" });
        reasons.push("review_result_changed_after_triage");
        status = "fail";
      } else {
        rows.push({ ...row, result: "current" });
      }
    }
  }

  const unmatched = (acknowledged ?? [])
    .filter((entry) => !matched.has(entry.canonical_id))
    .map((entry) => entry.canonical_id)
    .sort();
  return check("result-revision-coherence", status, reasons, {
    required: rows,
    unmatched_acknowledgements: unmatched,
  });
}

function checkAcquisitionCoverage(state) {
  return state?.coverage_complete === true
    ? check("acquisition-coverage", "pass", [], { incomplete_surfaces: [] })
    : check("acquisition-coverage", "unknown", ["coverage_incomplete"], {
        incomplete_surfaces: state?.incomplete_surfaces ?? [],
      });
}

function checkReviewThreads(evidence) {
  const surface = surfaceOf(evidence, "review_threads");
  if (!surface || surface.fetch_status !== "fetched") {
    return check("review-threads", "unknown", ["review_threads_unavailable"]);
  }
  const items = Array.isArray(surface.items) ? surface.items : [];
  const unresolved = items.filter((item) => item?.is_resolved === false);
  const indeterminate = items.filter((item) => item?.is_resolved !== true && item?.is_resolved !== false);
  const detail = {
    thread_count: items.length,
    unresolved_count: unresolved.length,
    unresolved_outdated_count: unresolved.filter((item) => item?.is_outdated === true).length,
    unresolved_thread_ids: unresolved.map((item) => item?.id ?? null),
  };
  // An outdated-but-unresolved thread still fails: "outdated" is GitHub's
  // statement about the diff position, not about the conversation.
  if (unresolved.length > 0) return check("review-threads", "fail", ["unresolved_review_thread"], detail);
  if (indeterminate.length > 0) {
    return check("review-threads", "unknown", ["thread_resolution_unknown"], {
      ...detail,
      indeterminate_count: indeterminate.length,
    });
  }
  return check("review-threads", "pass", [], detail);
}

function checkVerifyCoherence(inputs) {
  const verifySha = nonEmpty(inputs.verifySha);
  const frozen = nonEmpty(inputs.targetSha);
  if (!verifySha) return check("verify-coherence", "unknown", ["verify_evidence_missing"]);
  if (!frozen) return check("verify-coherence", "unknown", ["frozen_target_missing"]);
  const detail = { verify_sha: verifySha, frozen_target_sha: frozen };
  return shaEqual(verifySha, frozen)
    ? check("verify-coherence", "pass", [], detail)
    : check("verify-coherence", "fail", ["verify_target_mismatch"], detail);
}

function checkAutocloseHygiene(evidence) {
  const metadata = evidence?.pr_metadata;
  if (metadata?.fetch_status !== "fetched") {
    return check("autoclose-hygiene", "unknown", ["pr_metadata_unavailable"]);
  }
  const references = findClosingKeywordReferences(metadata.body ?? "");
  return references.length === 0
    ? check("autoclose-hygiene", "pass", [], { references: [] })
    : check("autoclose-hygiene", "fail", ["autoclose_keyword_present"], { references });
}

// ---------------------------------------------------------------------------
// Safe base drift carry-forward (Issue #102)
//
// One narrow lifecycle: a PR whose reviewed head has NOT moved, whose base
// branch alone advanced forward. Everything below is a comparison between a
// declared fact and an acquired fact. Nothing here decides whether a base
// drift is semantically safe.
//
// That judgment — "is there a material semantic dependency between the
// reviewed PR delta and the intervening base delta?" — is the agent's, and it
// reaches this module only as an already-formed verdict written into a durable
// comment on the PR. This module locates that comment, reads a fixed set of
// fields out of it, and checks that those fields name THIS drift. It never
// reads the rationale, and there is deliberately no path by which artifact
// disjointness, a small delta, a clean merge, or green verification can
// produce the verdict on the agent's behalf.
// ---------------------------------------------------------------------------

/**
 * The marker that makes a conversation comment readable as a base-drift
 * assessment, and the closed verdict vocabulary. A value outside the
 * vocabulary is malformed, never a fourth meaning.
 */
export const BASE_DRIFT_ASSESSMENT_MARKER = "safe-base-drift-assessment";
export const BASE_DRIFT_ASSESSMENT_VERDICTS = ["independent", "coupled", "unknown"];

const ASSESSMENT_SHA_FIELDS = ["reviewed_head", "frozen_base", "current_base_tip"];
const SHA_VALUE_PATTERN = "`?([0-9a-fA-F]{7,40})`?";
const VERDICT_VALUE_PATTERN = "`?([A-Za-z][A-Za-z-]*)`?";
const BASIS_VALUE_PATTERN = "(\\S.*?)";

// Each field is read as `key: value` on its own line, tolerating the markdown
// a comment body normally carries around it: list bullets, backticks, and bold
// emphasis written on either side of the colon (`**key:** v` and `**key**: v`
// are both ordinary renderings of the same line).
function assessmentField(body, key, valuePattern) {
  const pattern = new RegExp(
    "^[ \\t]*(?:[-*+][ \\t]+)?(?:\\*\\*|__)?" +
      key +
      "(?:\\*\\*|__)?[ \\t]*:[ \\t]*(?:\\*\\*|__)?[ \\t]*" +
      valuePattern +
      "[ \\t]*(?:\\*\\*|__)?[ \\t]*$",
    "gim",
  );
  const values = [...String(body ?? "").matchAll(pattern)].map((match) => match[1].trim());
  // A second, differing value for the same field is malformed rather than
  // first-wins or last-wins: an edit that appends a contradicting line must not
  // be resolvable into either of its two readings by this parser.
  const distinct = [...new Set(values)];
  if (distinct.length !== 1) return { value: null, ambiguous: distinct.length > 1 };
  return { value: distinct[0], ambiguous: false };
}

/**
 * Reads the fixed fields of a base-drift assessment out of a comment body.
 * Returns null when the body is not an assessment at all. Otherwise every
 * field is a value or null, and `ambiguous_fields` names those that appeared
 * more than once with differing values.
 *
 * `basis` is required to be present and non-empty and is NOT interpreted: it
 * exists so the durable record carries the agent's reasoning for a later
 * session to read, and so a verdict cannot be recorded as a bare flag.
 */
export function parseBaseDriftAssessment(body) {
  const text = String(body ?? "");
  if (!text.toLowerCase().includes(BASE_DRIFT_ASSESSMENT_MARKER)) return null;
  const ambiguous = [];
  const parsed = {};
  for (const key of ASSESSMENT_SHA_FIELDS) {
    const field = assessmentField(text, key, SHA_VALUE_PATTERN);
    parsed[key] = field.value ? field.value.toLowerCase() : null;
    if (field.ambiguous) ambiguous.push(key);
  }
  const verdict = assessmentField(text, "verdict", VERDICT_VALUE_PATTERN);
  parsed.verdict = verdict.value ? verdict.value.toLowerCase() : null;
  if (verdict.ambiguous) ambiguous.push("verdict");
  const basis = assessmentField(text, "basis", BASIS_VALUE_PATTERN);
  parsed.basis = basis.value ?? null;
  if (basis.ambiguous) ambiguous.push("basis");
  parsed.ambiguous_fields = ambiguous.sort();
  return parsed;
}

/**
 * Finds the declared assessment comment in the fresh acquisition. The locator
 * is matched against the surface item's own id or locator: the fence never
 * searches for "some comment that looks like an assessment", because that would
 * let an assessment written for an earlier drift be picked up silently.
 */
function findAssessmentComment(evidence, locator) {
  const surface = surfaceOf(evidence, "conversation_comments");
  if (!surface || surface.fetch_status !== "fetched") {
    return { comment: null, reason: "drift_assessment_surface_unavailable" };
  }
  const items = Array.isArray(surface.items) ? surface.items : [];
  const found = items.find((item) => String(item?.id ?? "") === locator || nonEmpty(item?.locator) === locator) ?? null;
  return found ? { comment: found, reason: null } : { comment: null, reason: "drift_assessment_not_found" };
}

// The existing obligations the carry-forward route is not allowed to relax.
// Each must be `pass` on this same acquisition before a drift can be carried
// forward, so the route can only ever be additive: it removes nothing and adds
// base-drift-specific requirements. `target-base` is deliberately absent — it
// is the check this route answers for, and depending on it would be circular.
const CARRY_FORWARD_PREREQUISITES = [
  "target-head",
  "artifact-set",
  "skill-routing",
  "reviewer-completion",
  "result-revision-coherence",
  "acquisition-coverage",
  "review-threads",
  "verify-coherence",
];

function evaluateAssessment(evidence, inputs, facts, reasons) {
  const locator = nonEmpty(inputs.driftAssessment);
  const { comment, reason } = findAssessmentComment(evidence, locator);
  if (!comment) {
    reasons.unknown.push(reason);
    return { locator, resolved: false };
  }
  const detail = {
    locator,
    comment_id: comment.id ?? null,
    comment_locator: nonEmpty(comment.locator),
    author: nonEmpty(comment.actor),
    recorded_at: nonEmpty(comment.updated_at) ?? nonEmpty(comment.created_at),
  };
  // The body read here is the CURRENT one from this acquisition, so an
  // assessment edited after it was written is evaluated as it now stands.
  const parsed = parseBaseDriftAssessment(comment.body);
  if (!parsed) {
    reasons.unknown.push("drift_assessment_malformed");
    return { ...detail, resolved: false };
  }
  if (parsed.ambiguous_fields.length > 0) {
    reasons.unknown.push("drift_assessment_malformed");
    return { ...detail, resolved: false, ambiguous_fields: parsed.ambiguous_fields };
  }
  const scope = {
    reviewed_head: parsed.reviewed_head,
    frozen_base: parsed.frozen_base,
    current_base_tip: parsed.current_base_tip,
  };
  const expected = {
    reviewed_head: nonEmpty(inputs.targetSha),
    frozen_base: nonEmpty(inputs.baseSha),
    current_base_tip: facts.current_base_tip_sha,
  };
  const result = {
    ...detail,
    resolved: true,
    verdict: parsed.verdict,
    scope,
    expected_scope: expected,
    basis_present: nonEmpty(parsed.basis) !== null,
  };

  // Scope binding first: an assessment that does not name this exact drift is
  // not an assessment of it, whatever its verdict says. Without this, the
  // verdict recorded for one base advance would silently authorise the next.
  //
  // A field the body never carried is malformed; a field that carries a
  // different SHA is a mismatch. Both are ineligible, and the distinction is
  // kept only so the reason code describes what the record actually looks
  // like.
  const absent = ASSESSMENT_SHA_FIELDS.filter((key) => scope[key] === null);
  const mismatched = ASSESSMENT_SHA_FIELDS.filter((key) => scope[key] !== null && !shaEqual(scope[key], expected[key]));
  if (absent.length > 0) {
    reasons.unknown.push("drift_assessment_malformed");
    result.absent_scope_fields = absent;
  }
  if (mismatched.length > 0) {
    reasons.fail.push("drift_assessment_scope_mismatch");
    result.scope_mismatch_fields = mismatched;
  }
  if (!result.basis_present) reasons.unknown.push("drift_assessment_basis_missing");

  if (parsed.verdict === "coupled") {
    reasons.fail.push("drift_assessment_semantic_coupling");
  } else if (parsed.verdict === "unknown") {
    reasons.unknown.push("drift_assessment_verdict_unknown");
  } else if (parsed.verdict !== "independent") {
    reasons.unknown.push("drift_assessment_malformed");
  }
  return result;
}

/**
 * Whether the machine-checkable half of a safe base drift holds.
 *
 * `pass` with `detail.carry_forward === true` is the ONLY state in which
 * checkTargetBase() accepts a moved base, and it requires all of: an explicitly
 * declared assessment, a still-unchanged reviewed head, a forward-only advance,
 * a completely acquired intervening delta, no artifact overlap with the reviewed
 * set, verification freshly run against the composed state, every prerequisite
 * check already passing, and an in-scope `independent` verdict. Anything
 * missing, unreadable, or contradicted is `unknown` or `fail` — never a pass.
 */
function checkBaseDriftCarryForward(evidence, inputs, current, priorChecks) {
  const locator = nonEmpty(inputs.driftAssessment);
  const frozen = nonEmpty(inputs.baseSha);
  const baseBranch = evidence?.base_branch;
  const tip = baseBranch?.fetch_status === "fetched" ? nonEmpty(baseBranch.tip_sha) : null;
  const drifted = frozen && tip ? !shaEqual(tip, frozen) : null;

  // Not requested: this check must not be able to change any verdict a fence
  // run would already have reached without it. The base drift itself is still
  // reported by `target-base` exactly as before.
  if (!locator) {
    return check("base-drift-carry-forward", "pass", [], { requested: false, carry_forward: false, base_drifted: drifted });
  }
  const baseDetail = { requested: true, carry_forward: false, frozen_base_sha: frozen, current_base_tip_sha: tip };
  if (drifted === null) {
    return check("base-drift-carry-forward", "unknown", ["base_drift_undetermined"], { ...baseDetail, base_drifted: null });
  }
  if (drifted === false) {
    return check("base-drift-carry-forward", "pass", ["base_drift_absent"], { ...baseDetail, base_drifted: false });
  }

  const reasons = { fail: [], unknown: [] };

  // 1. Every existing obligation still holds on this same acquisition.
  const prerequisites = [];
  for (const id of CARRY_FORWARD_PREREQUISITES) {
    const entry = priorChecks.find((candidate) => candidate.id === id) ?? null;
    prerequisites.push({ id, status: entry?.status ?? null });
    if (entry?.status === "pass") continue;
    if (entry?.status === "fail") reasons.fail.push("carry_forward_precondition_failed:" + id);
    else reasons.unknown.push("carry_forward_precondition_unknown:" + id);
  }

  // 2. Forward-only ancestry and 3. a completely acquired intervening delta,
  // both out of the one base-delta acquisition.
  const delta = evidence?.base_delta ?? null;
  const deltaDetail = {
    fetch_status: nonEmpty(delta?.fetch_status),
    ancestry: nonEmpty(delta?.ancestry),
    from_sha: nonEmpty(delta?.from_sha),
    to_sha: nonEmpty(delta?.to_sha),
    ahead_by: Number.isInteger(delta?.ahead_by) ? delta.ahead_by : null,
    behind_by: Number.isInteger(delta?.behind_by) ? delta.behind_by : null,
    artifact_count: Array.isArray(delta?.artifact_paths) ? delta.artifact_paths.length : null,
  };
  let interveningPaths = null;
  if (delta?.fetch_status !== "fetched") {
    // A comparison that could not be read is `unknown`, not `fail`: GitHub
    // answers unrelated history with a 404, which is indistinguishable here
    // from an outage. Both are ineligible; neither is a claim about the shape
    // of the history.
    reasons.unknown.push("intervening_delta_unavailable");
  } else if (!shaEqual(delta.from_sha, frozen) || !shaEqual(delta.to_sha, tip)) {
    // The comparison has to be the one this drift needs, not a stale endpoint.
    reasons.unknown.push("intervening_delta_endpoint_mismatch");
  } else if (delta.ancestry === "behind") {
    reasons.fail.push("base_drift_rewind");
  } else if (delta.ancestry === "diverged") {
    reasons.fail.push("base_drift_diverged_history");
  } else if (delta.ancestry !== "ahead") {
    reasons.unknown.push("base_drift_ancestry_unknown");
  } else if (!Array.isArray(delta.artifact_paths)) {
    reasons.unknown.push("intervening_delta_incomplete");
  } else {
    interveningPaths = sortedUnique(delta.artifact_paths);
  }

  // 4. Direct artifact overlap between the reviewed set and the intervening
  // set. Disjointness is reported as the machine fact it is; it is never read
  // as a semantic conclusion, which is precisely why the verdict below is
  // required independently of it.
  let overlap = null;
  if (current.paths === null) {
    reasons.unknown.push(current.reason);
  } else if (interveningPaths !== null) {
    overlap = current.paths.filter((path) => interveningPaths.includes(path));
    if (overlap.length > 0) reasons.fail.push("base_drift_artifact_overlap");
  }

  // 5. Verification declared against the composed state. Like every other
  // frozen declaration this module takes — `--verify-sha`, the artifact list,
  // the acknowledged revisions — this is the caller's statement, not proof
  // that a command ran; the fence owns SHA coherence, and the agent owns
  // having actually run the check (policy/core.md, Review stopping rules).
  //
  // What the comparison does buy is that the OLD verification cannot satisfy
  // it. In this branch the tip differs from the frozen base, so the base the
  // pre-drift verify composed can never equal the required value: carrying the
  // old green forward requires making a new and different declaration about
  // the new base, rather than reusing the one already on file.
  const verifyBase = nonEmpty(inputs.verifyBaseSha);
  if (!verifyBase) reasons.unknown.push("composed_verify_base_missing");
  else if (!shaEqual(verifyBase, tip)) reasons.fail.push("composed_verify_base_stale");

  // 6. The agent's semantic verdict, bound to this exact drift.
  const assessment = evaluateAssessment(evidence, inputs, { current_base_tip_sha: tip }, reasons);

  const detail = {
    ...baseDetail,
    base_drifted: true,
    prerequisites,
    intervening_delta: deltaDetail,
    reviewed_artifact_count: current.paths === null ? null : current.paths.length,
    artifact_overlap: overlap,
    composed_verify_base_sha: verifyBase,
    assessment,
  };
  if (reasons.fail.length > 0) {
    return check("base-drift-carry-forward", "fail", [...reasons.fail, ...reasons.unknown], detail);
  }
  if (reasons.unknown.length > 0) {
    return check("base-drift-carry-forward", "unknown", reasons.unknown, detail);
  }
  return check("base-drift-carry-forward", "pass", [], { ...detail, carry_forward: true });
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function aggregateFenceStatus(checks) {
  if (checks.some((entry) => entry.status === "fail")) return "fail";
  if (checks.some((entry) => entry.status === "unknown")) return "unknown";
  return "pass";
}

/**
 * @param evidence  collectReviewEvidence() result (one fresh acquisition)
 * @param state     evaluateReviewerTargetStates() result for that same snapshot
 * @param inputs    the frozen declarations: targetSha, baseSha, artifacts[],
 *                  verifySha, requiredReviewers[], declaredSkills[],
 *                  acknowledged[{canonical_id, body_digest}]
 */
export function evaluateMergeReadyFence({ evidence, state, inputs = {} } = {}) {
  const current = currentArtifactPaths(evidence);
  // Evaluation order is not emission order. The carry-forward route reads the
  // verdicts of the checks it may not relax, and `target-base` reads the
  // carry-forward verdict, so those two are evaluated last and spliced back
  // into the declared FENCE_CHECK_IDS order below. `target-base` is not among
  // the carry-forward prerequisites, so the dependency stays acyclic.
  const independent = [
    checkTargetHead(evidence, inputs),
    checkArtifactSet(current, inputs),
    checkSkillRouting(current, inputs),
    checkReviewerCompletion(state, inputs),
    checkResultRevisionCoherence(state, inputs),
    checkAcquisitionCoverage(state),
    checkReviewThreads(evidence),
    checkVerifyCoherence(inputs),
    checkAutocloseHygiene(evidence),
  ];
  const carryForward = checkBaseDriftCarryForward(evidence, inputs, current, independent);
  const byId = new Map([...independent, carryForward, checkTargetBase(evidence, inputs, carryForward)].map((entry) => [entry.id, entry]));
  const checks = FENCE_CHECK_IDS.map((id) => byId.get(id));
  const status = aggregateFenceStatus(checks);
  return {
    schema: MERGE_READY_FENCE_SCHEMA_ID,
    repo: evidence?.repo ?? null,
    pull_number: evidence?.pull_number ?? null,
    captured_at: evidence?.generated_at ?? null,
    target: {
      sha: nonEmpty(inputs.targetSha),
      base_sha: nonEmpty(inputs.baseSha),
    },
    status,
    checks,
    reason_codes: [...new Set(checks.flatMap((entry) => entry.reason_codes))].sort(),
  };
}
