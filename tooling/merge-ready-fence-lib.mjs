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
function checkTargetBase(evidence, inputs) {
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
  return shaEqual(tip, frozen)
    ? check("target-base", "pass", [], detail)
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
  const checks = [
    checkTargetHead(evidence, inputs),
    checkTargetBase(evidence, inputs),
    checkArtifactSet(current, inputs),
    checkSkillRouting(current, inputs),
    checkReviewerCompletion(state, inputs),
    checkResultRevisionCoherence(state, inputs),
    checkAcquisitionCoverage(state),
    checkReviewThreads(evidence),
    checkVerifyCoherence(inputs),
    checkAutocloseHygiene(evidence),
  ];
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
