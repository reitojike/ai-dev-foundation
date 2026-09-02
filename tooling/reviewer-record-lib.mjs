// Issue #72 Phase 1: schema and validation for the consumer-owned reviewer
// capability record. The Kernel (policy/core.md) requires that the record
// exists and that Selection consults it, but owns no schema; this module is
// that schema. Provider names live only inside a consumer's record file, never
// here and never in policy/core.md.
//
// This module decides nothing semantic: it does not choose reviewers, does not
// judge completion, and does not rank fallbacks. It only answers "is this file
// present, parseable, and minimally well-formed", so an agent never has to read
// prose to find out which reviewers exist or how to trigger them.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const REVIEWER_RECORD_SCHEMA_ID = "ai-dev-foundation/reviewer-capability-record@1";
export const REVIEWER_RECORD_RELATIVE_PATH = ".ai-dev-foundation/reviewers.json";

// Durable record (Selection / run / fence record) posting convention, decided
// once here rather than restated as prose in policy or skills: each stage posts
// a NEW comment and the latest one is authoritative. In-place editing of a
// single comment is what makes an already-arrived result invisible to the next
// session, so it is not a supported value.
export const DURABLE_RECORD_POSTING = "new-comment-per-stage";

export const REVIEWER_CLASSES = ["required", "expected", "advisory"];
export const TRIGGER_KINDS = ["comment_command", "automatic", "operator_configured"];

// How the required slot(s) are filled from the record's required-class
// reviewers. This is the portfolio decision, made once in the record instead of
// re-derived per Task from prose.
export const REQUIRED_SELECTION_PREFERENCES = ["different-provider-family-from-implementer", "record-order"];

// A trigger may carry the frozen target into the reviewer's own output, so its
// completion marker becomes bindable. The placeholder is substituted with the
// Selection Contract's expected target at Execution time.
export const TARGET_SHA_PLACEHOLDER = "{target_sha}";

// Surface keys mirror tooling/review-evidence-lib.mjs's `surfaces` object, so a
// record can be evaluated directly against a review-evidence snapshot.
export const EVIDENCE_SURFACES = [
  "conversation_comments",
  "review_submissions",
  "inline_review_comments",
  "review_threads",
  "commit_status",
  "check_runs",
];

// Fields observed to keep the target a run actually reviewed, even after the PR
// head moves. Only these may be named as `target_field` (Acquisition & Validity
// Contract: a field that follows the moving head cannot bind).
export const STABLE_TARGET_FIELDS = {
  review_submissions: ["reviewed_sha"],
  inline_review_comments: ["original_commit_sha"],
};

// Fields observed to follow the current head instead of the reviewed target.
// Named explicitly so the validator can reject them with a specific reason
// rather than a generic "unknown field".
export const UNSTABLE_TARGET_FIELDS = {
  inline_review_comments: ["reviewed_sha"],
  review_threads: ["reviewed_sha"],
};

// review-evidence fetches these per-commit surfaces for the snapshot head only,
// so an item found there is bound to that head SHA and needs no target field.
export const HEAD_BOUND_SURFACES = ["commit_status", "check_runs"];

export const MARKER_KINDS = [
  "completion_marker",
  "non_participation_marker",
  "rate_limit_marker",
  "failure_marker",
  "in_flight_marker",
];

const OBSERVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value, { allowEmpty = false } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(isNonEmptyString);
}

// `new RegExp(source + "|")` always matches the empty string, so the match
// array's length minus the full match is the capture-group count — enough to
// reject a target_pattern that compiles but captures nothing to bind against.
function captureGroupCount(source) {
  return new RegExp(`${source}|`).exec("").length - 1;
}

function validateMarker(marker, { reviewerLabel, kind, requireTargetBinding }) {
  const errors = [];
  const label = `${reviewerLabel}.${kind}`;
  if (!isPlainObject(marker)) return [`${label}: must be an object`];

  if (!isStringArray(marker.surfaces)) {
    errors.push(`${label}.surfaces: must be a non-empty array of surface keys`);
  } else {
    for (const surface of marker.surfaces) {
      if (!EVIDENCE_SURFACES.includes(surface)) {
        errors.push(`${label}.surfaces: unknown surface "${surface}" (known: ${EVIDENCE_SURFACES.join(", ")})`);
      }
    }
  }

  if (!isStringArray(marker.any_of)) {
    errors.push(`${label}.any_of: must be a non-empty array of literal marker strings`);
  }
  if (marker.all_of !== undefined && !isStringArray(marker.all_of)) {
    errors.push(`${label}.all_of: must be a non-empty array of literal marker strings when present`);
  }

  const surfaces = isStringArray(marker.surfaces) ? marker.surfaces : [];
  const hasTargetField = marker.target_field !== undefined && marker.target_field !== null;
  const hasTargetPattern = marker.target_pattern !== undefined && marker.target_pattern !== null;
  const headBoundOnly = surfaces.length > 0 && surfaces.every((surface) => HEAD_BOUND_SURFACES.includes(surface));

  if (hasTargetField && hasTargetPattern) {
    errors.push(`${label}: specify at most one of target_field / target_pattern`);
  }

  if (hasTargetField) {
    if (!isNonEmptyString(marker.target_field)) {
      errors.push(`${label}.target_field: must be a non-empty string`);
    } else {
      for (const surface of surfaces) {
        const stable = STABLE_TARGET_FIELDS[surface] ?? [];
        const unstable = UNSTABLE_TARGET_FIELDS[surface] ?? [];
        if (unstable.includes(marker.target_field)) {
          errors.push(
            `${label}.target_field: "${marker.target_field}" on surface "${surface}" follows the moving head and cannot bind a reviewed target`,
          );
        } else if (!stable.includes(marker.target_field)) {
          const alternatives = stable.length > 0 ? ` other than ${stable.join(", ")}` : "";
          errors.push(
            `${label}.target_field: surface "${surface}" has no stable target field${alternatives}; use target_pattern instead`,
          );
        }
      }
    }
  }

  if (hasTargetPattern) {
    if (!isNonEmptyString(marker.target_pattern)) {
      errors.push(`${label}.target_pattern: must be a non-empty string`);
    } else {
      try {
        if (captureGroupCount(marker.target_pattern) < 1) {
          errors.push(`${label}.target_pattern: must contain at least one capture group for the reviewed target`);
        }
      } catch (error) {
        errors.push(`${label}.target_pattern: invalid regular expression (${error.message})`);
      }
    }
  }

  if (requireTargetBinding && !hasTargetField && !hasTargetPattern && !headBoundOnly) {
    errors.push(
      `${label}: needs target_field or target_pattern so completion can be bound to the reviewed target (the ${HEAD_BOUND_SURFACES.join(" / ")} surfaces are head-bound and exempt)`,
    );
  }

  return errors;
}

function validateReviewer(reviewer, index, knownIds) {
  if (!isPlainObject(reviewer)) return [`reviewers[${index}]: must be an object`];

  const errors = [];
  const label = isNonEmptyString(reviewer.id) ? `reviewers[${index}] (${reviewer.id})` : `reviewers[${index}]`;

  if (!isNonEmptyString(reviewer.id)) errors.push(`${label}.id: must be a non-empty string`);
  if (!isNonEmptyString(reviewer.display_name)) errors.push(`${label}.display_name: must be a non-empty string`);

  if (!REVIEWER_CLASSES.includes(reviewer.default_class)) {
    errors.push(`${label}.default_class: must be one of ${REVIEWER_CLASSES.join(" / ")}`);
  }

  if (!isStringArray(reviewer.actors)) {
    errors.push(`${label}.actors: must be a non-empty array of the login(s) this reviewer posts as`);
  }

  if (!isPlainObject(reviewer.trigger)) {
    errors.push(`${label}.trigger: must be an object`);
  } else {
    if (!TRIGGER_KINDS.includes(reviewer.trigger.kind)) {
      errors.push(`${label}.trigger.kind: must be one of ${TRIGGER_KINDS.join(" / ")}`);
    }
    if (reviewer.trigger.kind === "comment_command" && !isNonEmptyString(reviewer.trigger.value)) {
      errors.push(`${label}.trigger.value: comment_command needs the literal command to post on the PR`);
    }
    if (reviewer.trigger.target_argument !== undefined && reviewer.trigger.target_argument !== null) {
      if (!isNonEmptyString(reviewer.trigger.target_argument)) {
        errors.push(`${label}.trigger.target_argument: must be a non-empty string when present`);
      } else if (!reviewer.trigger.target_argument.includes(TARGET_SHA_PLACEHOLDER)) {
        errors.push(`${label}.trigger.target_argument: must contain the ${TARGET_SHA_PLACEHOLDER} placeholder`);
      }
    }
  }

  if (reviewer.provider_family !== undefined && !isNonEmptyString(reviewer.provider_family)) {
    errors.push(`${label}.provider_family: must be a non-empty string when present`);
  }

  if (!isStringArray(reviewer.result_surfaces)) {
    errors.push(`${label}.result_surfaces: must be a non-empty array of surface keys`);
  } else {
    for (const surface of reviewer.result_surfaces) {
      if (!EVIDENCE_SURFACES.includes(surface)) {
        errors.push(`${label}.result_surfaces: unknown surface "${surface}" (known: ${EVIDENCE_SURFACES.join(", ")})`);
      }
    }
  }

  errors.push(
    ...validateMarker(reviewer.completion_marker, {
      reviewerLabel: label,
      kind: "completion_marker",
      requireTargetBinding: true,
    }),
  );

  for (const kind of MARKER_KINDS) {
    if (kind === "completion_marker") continue;
    const marker = reviewer[kind];
    if (marker === undefined || marker === null) continue;
    errors.push(...validateMarker(marker, { reviewerLabel: label, kind, requireTargetBinding: false }));
  }

  if (!isStringArray(reviewer.fallback_order, { allowEmpty: true })) {
    errors.push(`${label}.fallback_order: must be an array of reviewer ids (may be empty)`);
  } else {
    for (const id of reviewer.fallback_order) {
      if (id === reviewer.id) errors.push(`${label}.fallback_order: must not list the reviewer itself`);
      else if (!knownIds.has(id)) errors.push(`${label}.fallback_order: unknown reviewer id "${id}"`);
    }
  }

  if (!isNonEmptyString(reviewer.observed_at) || !OBSERVED_AT_PATTERN.test(reviewer.observed_at)) {
    errors.push(`${label}.observed_at: must be a YYYY-MM-DD date recording when these markers were last observed`);
  }

  return errors;
}

function validateRequiredSelection(value) {
  const selection = value.required_selection;
  if (selection === undefined || selection === null) return [];
  if (!isPlainObject(selection)) return ["required_selection: must be an object when present"];

  const errors = [];
  if (!Number.isInteger(selection.count) || selection.count < 1) {
    errors.push("required_selection.count: must be an integer of at least 1");
  }
  if (!REQUIRED_SELECTION_PREFERENCES.includes(selection.prefer)) {
    errors.push(`required_selection.prefer: must be one of ${REQUIRED_SELECTION_PREFERENCES.join(" / ")}`);
  }

  const requiredReviewers = value.reviewers.filter(
    (reviewer) => isPlainObject(reviewer) && reviewer.default_class === "required",
  );
  if (requiredReviewers.length === 0) {
    errors.push('required_selection: the record declares no reviewer with default_class "required" to fill the slot from');
  }
  if (Number.isInteger(selection.count) && selection.count > requiredReviewers.length) {
    errors.push(
      `required_selection.count: ${selection.count} exceeds the ${requiredReviewers.length} reviewer(s) with default_class "required"`,
    );
  }
  if (selection.prefer === "different-provider-family-from-implementer") {
    for (const reviewer of requiredReviewers) {
      if (!isNonEmptyString(reviewer.provider_family)) {
        errors.push(
          `required_selection.prefer: reviewer "${reviewer.id ?? "?"}" needs provider_family to be comparable against the implementer's family`,
        );
      }
    }
  }

  return errors;
}

// Returns [] when the parsed value is a minimally valid record. Every message
// is actionable on its own, so `check` output tells a consumer exactly which
// field to fix instead of only that the file is wrong.
export function validateReviewerRecord(value) {
  if (!isPlainObject(value)) return ["record: must be a JSON object"];

  const errors = [];
  if (value.schema !== REVIEWER_RECORD_SCHEMA_ID) {
    errors.push(`schema: must be "${REVIEWER_RECORD_SCHEMA_ID}"`);
  }

  if (value.durable_record !== undefined && value.durable_record !== null) {
    if (!isPlainObject(value.durable_record)) {
      errors.push("durable_record: must be an object when present");
    } else if (value.durable_record.posting !== undefined && value.durable_record.posting !== DURABLE_RECORD_POSTING) {
      errors.push(`durable_record.posting: the only supported value is "${DURABLE_RECORD_POSTING}"`);
    }
  }

  if (!Array.isArray(value.reviewers) || value.reviewers.length === 0) {
    errors.push("reviewers: must be a non-empty array");
    return errors;
  }

  errors.push(...validateRequiredSelection(value));

  const knownIds = new Set(value.reviewers.filter((reviewer) => isNonEmptyString(reviewer?.id)).map((reviewer) => reviewer.id));
  const seenIds = new Set();
  value.reviewers.forEach((reviewer, index) => {
    if (isPlainObject(reviewer) && isNonEmptyString(reviewer.id)) {
      if (seenIds.has(reviewer.id)) errors.push(`reviewers[${index}].id: duplicate reviewer id "${reviewer.id}"`);
      seenIds.add(reviewer.id);
    }
    errors.push(...validateReviewer(reviewer, index, knownIds));
  });

  return errors;
}

export function reviewerRecordPath(consumerDirectory) {
  return path.join(consumerDirectory, ...REVIEWER_RECORD_RELATIVE_PATH.split("/"));
}

// Loads and validates a record at an explicit path. `status` separates the
// states an agent has to act on differently: `missing` (stop and escalate
// before Selection), `unparsable`, and `invalid` (fix the named fields).
export async function readReviewerRecordFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing", path: filePath, record: null, errors: [] };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "unparsable", path: filePath, record: null, errors: [error.message] };
  }

  const errors = validateReviewerRecord(parsed);
  if (errors.length > 0) return { status: "invalid", path: filePath, record: parsed, errors };
  return { status: "ok", path: filePath, record: parsed, errors: [] };
}

// Same load, addressed the way `check` and the review skills refer to it: by
// consumer directory, at the schema's canonical relative path.
export async function loadReviewerRecord(consumerDirectory) {
  return readReviewerRecordFile(reviewerRecordPath(consumerDirectory));
}

// The record's own declared posting convention, defaulting to the schema's
// single supported value when the consumer omitted the block.
export function durableRecordPosting(record) {
  return record?.durable_record?.posting ?? DURABLE_RECORD_POSTING;
}
