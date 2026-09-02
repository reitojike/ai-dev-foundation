// Issue #72 Phase 1: schema and validation for the consumer-owned reviewer
// capability record. The Kernel (policy/core.md) requires that the record
// exists and that Selection consults it, but owns no schema; this module is
// that schema. Provider names live only inside a consumer's record file, never
// here and never in policy/core.md.
//
// The record describes WHO a reviewer is, HOW to start it, and WHAT text marks
// its result. It deliberately does NOT describe where that output shows up:
// predicting the surface is a negative claim ("this provider does not post
// there") that the Kernel forbids and that breaks the first time a provider
// posts elsewhere. The acquisition helper already fetches every durable
// surface, and the review procedure reads the marker against all of them.
//
// This module decides nothing semantic: it does not choose reviewers, does not
// judge completion, and does not rank fallbacks. It only answers "is this file
// present, parseable, and minimally well-formed".

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
// completion becomes bindable on surfaces that carry no commit of their own.
// The placeholder is substituted with the Selection Contract's expected target
// at Execution time.
export const TARGET_SHA_PLACEHOLDER = "{target_sha}";

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

// A marker is the text that makes a surface item readable ("this comment is the
// finished review", "this one is a rate limit"). It names no surface: the review
// procedure matches it against every surface the acquisition helper returned.
function validateMarker(marker, { reviewerLabel, kind }) {
  const errors = [];
  const label = `${reviewerLabel}.${kind}`;
  if (!isPlainObject(marker)) return [`${label}: must be an object`];

  if ("surfaces" in marker) {
    errors.push(
      `${label}.surfaces: not supported — a marker must not predict which surface the reviewer posts to; every fetched surface is searched`,
    );
  }
  if ("target_field" in marker) {
    errors.push(
      `${label}.target_field: not supported — the reviewed target comes from the surface's own commit field; use target_pattern where a surface carries none`,
    );
  }

  if (!isStringArray(marker.any_of)) {
    errors.push(`${label}.any_of: must be a non-empty array of literal marker strings`);
  }
  if (marker.all_of !== undefined && !isStringArray(marker.all_of)) {
    errors.push(`${label}.all_of: must be a non-empty array of literal marker strings when present`);
  }

  if (marker.target_pattern !== undefined && marker.target_pattern !== null) {
    if (!isNonEmptyString(marker.target_pattern)) {
      errors.push(`${label}.target_pattern: must be a non-empty string when present`);
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

  // Identity, not response shape: which login the reviewer posts as is what
  // attributes a surface item to it, and it does not change with the output.
  if (!isStringArray(reviewer.actors)) {
    errors.push(`${label}.actors: must be a non-empty array of the login(s) this reviewer posts as`);
  }

  if ("result_surfaces" in reviewer) {
    errors.push(
      `${label}.result_surfaces: not supported — every durable surface is read, so a reviewer must not declare where its output appears`,
    );
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

  // The completion marker is required: the review procedure reads it to tell a
  // finished review from a progress note, and has no other way to do so. The
  // remaining markers are optional — a reviewer that never declines, never
  // rate-limits and never reports failure simply omits them.
  if (reviewer.completion_marker === undefined || reviewer.completion_marker === null) {
    errors.push(`${label}.completion_marker: is required so completion can be told from progress`);
  }
  for (const kind of MARKER_KINDS) {
    const marker = reviewer[kind];
    if (marker === undefined || marker === null) continue;
    errors.push(...validateMarker(marker, { reviewerLabel: label, kind }));
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
  // Required, not optional: the review procedure fills the required slot from
  // this block's count/prefer. A record without it passes every other check and
  // still leaves Selection undecidable, which is the failure the record exists
  // to remove.
  if (selection === undefined || selection === null) {
    return ["required_selection: is required so Selection can fill the required slot mechanically"];
  }
  if (!isPlainObject(selection)) return ["required_selection: must be an object"];

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

  const knownIds = new Set(
    value.reviewers.filter((reviewer) => isNonEmptyString(reviewer?.id)).map((reviewer) => reviewer.id),
  );
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
