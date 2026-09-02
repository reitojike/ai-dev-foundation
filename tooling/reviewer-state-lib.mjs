// Issue #72 Phase 1: reviewer target completion state, derived mechanically
// from a collectReviewEvidence() snapshot plus a consumer's reviewer capability
// record.
//
// It never predicts where a reviewer posts. Two kinds of evidence are read, in
// this order:
//
//   1. Structural — a submitted GitHub review by a declared actor. GitHub's own
//      schema says that is a review act bound to `commit_id`, so no text
//      matching and no provider knowledge is involved at all.
//   2. Declared markers — the fallback for surfaces GitHub gives no review
//      semantics to (a plain comment, a status description, a check name),
//      where nothing but the text distinguishes a finished review from a
//      progress note. Markers name no surface: every fetched surface is
//      searched, and the reviewed target comes from the surface's own commit
//      field when it has one.
//
// This module stays inside the same boundary as the acquisition helper: it
// matches declared text and compares SHAs. It never categorizes a finding,
// never decides whether a run satisfies a review obligation, and never converts
// a missing or unfetched surface into `0 findings`.

import { MARKER_KINDS } from "./reviewer-record-lib.mjs";

const SHA_MIN_PREFIX_LENGTH = 7;

// The surface whose items ARE review acts in GitHub's own model. A submission
// here by a declared reviewer needs no marker to count as completion.
const STRUCTURAL_COMPLETION_SURFACE = "review_submissions";

// A submission that has not been submitted yet is a private draft, not a
// completed review act.
const DRAFT_SUBMISSION_STATE = "PENDING";

// Per-surface commit fields that keep the target a run actually reviewed, even
// after the PR head moves. This is a property of the surface, not of any
// reviewer, so it lives here rather than in a consumer's record.
// `inline_review_comments.reviewed_sha` and a review thread comment's commit
// both follow the moving head and are deliberately absent.
const SURFACE_TARGET_FIELD = {
  review_submissions: "reviewed_sha",
  inline_review_comments: "original_commit_sha",
};

// The acquisition helper fetches these per-commit surfaces for the snapshot
// head only, so an item found there is bound to that head SHA.
const HEAD_BOUND_SURFACES = ["commit_status", "check_runs"];

// Flattens one snapshot surface into uniform items so matching does not have to
// know each surface's field names. `actor` is null on the per-commit surfaces,
// which carry no author in the snapshot's normalized shape.
function surfaceItems(evidence, surfaceKey) {
  const surface = evidence?.surfaces?.[surfaceKey];
  if (!surface) return [];
  const base = { surface: surfaceKey, head_bound: HEAD_BOUND_SURFACES.includes(surfaceKey) };

  switch (surfaceKey) {
    case "conversation_comments":
      return surface.items.map((item) => ({
        ...base,
        actor: item.actor,
        body: item.body,
        locator: item.locator,
        timestamp: item.updated_at ?? item.created_at,
        fields: {},
      }));
    case "review_submissions":
      return surface.items.map((item) => ({
        ...base,
        actor: item.actor,
        body: item.body,
        locator: item.locator,
        timestamp: item.submitted_at,
        state: item.state,
        fields: { reviewed_sha: item.reviewed_sha },
      }));
    case "inline_review_comments":
      return surface.items.map((item) => ({
        ...base,
        actor: item.actor,
        body: item.body,
        locator: item.locator,
        timestamp: item.updated_at ?? item.created_at,
        fields: { reviewed_sha: item.reviewed_sha, original_commit_sha: item.original_commit_sha },
      }));
    case "review_threads":
      return surface.items.flatMap((thread) =>
        (thread.comments ?? []).map((comment) => ({
          ...base,
          actor: comment.actor,
          body: comment.body,
          locator: comment.locator,
          timestamp: comment.created_at,
          fields: {},
        })),
      );
    case "commit_status":
      return (surface.status?.statuses ?? []).map((status) => ({
        ...base,
        actor: null,
        body: [status.context, status.description].filter(Boolean).join(" "),
        locator: status.target_url,
        timestamp: status.updated_at ?? status.created_at,
        fields: {},
      }));
    case "check_runs":
      return surface.items.map((item) => ({
        ...base,
        actor: null,
        body: [item.name, item.status, item.conclusion].filter(Boolean).join(" "),
        locator: item.locator,
        timestamp: item.completed_at ?? item.started_at,
        fields: {},
      }));
    default:
      return [];
  }
}

function allSurfaceKeys(evidence) {
  return Object.keys(evidence?.surfaces ?? {});
}

// Every surface matters, because a marker may appear on any of them. A surface
// that did not complete its fetch is reported, never silently treated as empty.
function incompleteSurfaceKeys(evidence) {
  return allSurfaceKeys(evidence).filter((key) => evidence.surfaces[key]?.fetch_status !== "fetched");
}

function isDeclaredActor(item, actors) {
  // A null actor is only legitimate on the head-bound per-commit surfaces,
  // which carry no author at all. Elsewhere it means the author is unknown
  // (e.g. a deleted account), and accepting it would let any item carrying a
  // generic marker stand in for the reviewer's own output.
  if (item.actor === null) return item.head_bound;
  return actors.has(item.actor.toLowerCase());
}

// Anchor for "the current run": the newest comment on this PR carrying the
// reviewer's own trigger command. A marker item older than that anchor was
// produced by an earlier run on the same PR, so applying it to the current
// target would report a stale `declined` / `failed` / rate-limit / in-flight.
// Only comment_command triggers have such an anchor; `--since` supplies one for
// the trigger kinds that do not.
function runAnchorTimestamp(reviewer, evidence, since) {
  if (since) return since;
  const command = reviewer.trigger?.kind === "comment_command" ? reviewer.trigger.value : null;
  if (!command) return null;
  let newest = null;
  for (const item of surfaceItems(evidence, "conversation_comments")) {
    if (!item.timestamp || !item.body?.includes(command)) continue;
    const itemMs = Date.parse(item.timestamp);
    if (Number.isNaN(itemMs)) continue;
    if (newest === null || itemMs > Date.parse(newest)) newest = item.timestamp;
  }
  return newest;
}

// Returns the literal marker string that matched, or null. `any_of` is a set of
// alternative markers (one is enough); `all_of` adds conjunctive terms that must
// all be present.
function matchedMarkerText(marker, body) {
  const text = body ?? "";
  const matched = (marker.any_of ?? []).find((needle) => text.includes(needle));
  if (matched === undefined) return null;
  if (marker.all_of && !marker.all_of.every((needle) => text.includes(needle))) return null;
  return matched;
}

// Resolution order is a property of the surface: its own commit field, then the
// record's text pattern, then the head for per-commit surfaces.
function resolveBoundTarget(item, marker, headSha) {
  const field = SURFACE_TARGET_FIELD[item.surface];
  if (field && item.fields?.[field]) return item.fields[field];
  if (marker?.target_pattern) return new RegExp(marker.target_pattern).exec(item.body ?? "")?.[1] ?? null;
  if (item.head_bound) return headSha;
  return null;
}

// Abbreviated SHAs appear in comment bodies, so a prefix relation counts as the
// same target — but only from a length that cannot collide by accident.
export function shaMatches(left, right) {
  if (!left || !right) return false;
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < SHA_MIN_PREFIX_LENGTH) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function byTimestampDescending(left, right) {
  const leftMs = Date.parse(left.timestamp ?? "");
  const rightMs = Date.parse(right.timestamp ?? "");
  if (Number.isNaN(leftMs)) return 1;
  if (Number.isNaN(rightMs)) return -1;
  return rightMs - leftMs;
}

// Whether a match may set state/signal for the current target. A match that
// resolves a target is applicable only against the expected one; a match that
// resolves none is scoped by the run anchor instead. `scope` records which of
// those decided it, so a non-applicable match is still visible as evidence
// rather than silently dropped.
function scopeMatch(match, expectedTarget, anchor) {
  if (match.bound_target) {
    return shaMatches(match.bound_target, expectedTarget)
      ? { applies: true, scope: "target-bound" }
      : { applies: false, scope: "other-target" };
  }
  // Neither a target nor a run scopes this match, so nothing ties it to the
  // current run. Applying it anyway is how a marker left by an earlier run
  // decides the current target.
  const anchorMs = Date.parse(anchor ?? "");
  const matchMs = Date.parse(match.timestamp ?? "");
  if (Number.isNaN(anchorMs) || Number.isNaN(matchMs)) return { applies: false, scope: "unscoped" };
  // Compared as instants: `--since` may carry any UTC offset while GitHub
  // returns Z-suffixed timestamps, and those do not sort lexicographically.
  return matchMs >= anchorMs
    ? { applies: true, scope: "after-run-anchor" }
    : { applies: false, scope: "before-run-anchor" };
}

// Structural completion evidence: this reviewer's own submitted GitHub review.
// No marker, no surface prediction — GitHub's schema already says what it is.
function structuralCompletions(evidence, actors, expectedTarget, headSha) {
  return surfaceItems(evidence, STRUCTURAL_COMPLETION_SURFACE)
    .filter((item) => isDeclaredActor(item, actors) && item.state !== DRAFT_SUBMISSION_STATE)
    .map((item) => {
      const match = {
        marker_kind: "structural_review_submission",
        surface: item.surface,
        actor: item.actor,
        locator: item.locator,
        timestamp: item.timestamp ?? null,
        marker: null,
        bound_target: resolveBoundTarget(item, null, headSha),
      };
      return { ...match, ...scopeMatch(match, expectedTarget, null) };
    })
    .sort(byTimestampDescending);
}

function collectMatches(reviewer, evidence, kind, headSha, expectedTarget, anchor, actors) {
  const marker = reviewer[kind];
  if (!marker) return [];
  const matches = [];
  for (const surfaceKey of allSurfaceKeys(evidence)) {
    for (const item of surfaceItems(evidence, surfaceKey)) {
      if (!isDeclaredActor(item, actors)) continue;
      // A draft review is excluded from the structural path because it is not a
      // review act yet. It has to be excluded here too, or the same draft could
      // be promoted to completion through text in its body.
      if (item.surface === STRUCTURAL_COMPLETION_SURFACE && item.state === DRAFT_SUBMISSION_STATE) continue;
      const markerText = matchedMarkerText(marker, item.body);
      if (markerText === null) continue;
      const match = {
        marker_kind: kind,
        surface: item.surface,
        actor: item.actor,
        locator: item.locator,
        timestamp: item.timestamp ?? null,
        marker: markerText,
        bound_target: resolveBoundTarget(item, marker, headSha),
      };
      matches.push({ ...match, ...scopeMatch(match, expectedTarget, anchor) });
    }
  }
  return matches.sort(byTimestampDescending);
}

function evaluateReviewer(reviewer, evidence, expectedTarget, headSha, since) {
  const incompleteSurfaces = incompleteSurfaceKeys(evidence);
  const evidenceComplete = incompleteSurfaces.length === 0;
  const runAnchor = runAnchorTimestamp(reviewer, evidence, since);
  const actors = new Set((reviewer.actors ?? []).map((actor) => actor.toLowerCase()));

  const structural = structuralCompletions(evidence, actors, expectedTarget, headSha);
  const matches = Object.fromEntries(
    MARKER_KINDS.map((kind) => [kind, collectMatches(reviewer, evidence, kind, headSha, expectedTarget, runAnchor, actors)]),
  );
  // Only in-scope matches may set state or signal. Out-of-scope ones stay in
  // matched_evidence so the reason a stale marker was NOT applied is visible.
  const applied = Object.fromEntries(MARKER_KINDS.map((kind) => [kind, matches[kind].filter((match) => match.applies)]));

  const completionAtTarget =
    structural.find((match) => match.applies) ?? applied.completion_marker.find((match) => match.bound_target);
  const completionElsewhere =
    structural.find((match) => match.bound_target) ??
    matches.completion_marker.find((match) => match.bound_target && !shaMatches(match.bound_target, expectedTarget));
  // Read from every match, not only the scoped ones: an unbound completion
  // marker yields `unknown` either way, so using it here only sharpens the
  // reason from "nothing matched" to "matched but could not be bound".
  const completionUnbound = matches.completion_marker.find((match) => !match.bound_target);

  let state;
  let reason;
  let decisive = null;
  if (completionAtTarget) {
    state = "completed@target";
    reason =
      completionAtTarget.marker_kind === "structural_review_submission"
        ? "structural_review_submission_at_target"
        : "completion_marker_bound_to_target";
    decisive = completionAtTarget;
  } else if (applied.non_participation_marker.length > 0) {
    state = "declined";
    reason = "non_participation_marker";
    [decisive] = applied.non_participation_marker;
  } else if (applied.failure_marker.length > 0) {
    state = "failed";
    reason = "failure_marker";
    [decisive] = applied.failure_marker;
  } else if (completionElsewhere) {
    state = "not-bound";
    reason = "completion_evidence_bound_to_other_target";
    decisive = completionElsewhere;
  } else if (completionUnbound) {
    state = "unknown";
    reason = "completion_marker_target_unresolved";
    decisive = completionUnbound;
  } else {
    state = "unknown";
    reason = evidenceComplete ? "no_completion_evidence" : "fetch_incomplete";
  }

  // An operational signal refines a non-completion state into the next action
  // (fall back now vs. wait for a run that is still going). It is deliberately a
  // separate field: policy/core.md's target completion state vocabulary is
  // `completed@target` / `not-bound` / `declined` / `failed` / `unknown`, and
  // rate-limited/in-flight are both `unknown`-side refinements, not new states.
  let operationalSignal = "none";
  let signalMatch = null;
  if (state !== "completed@target" && state !== "declined") {
    if (applied.rate_limit_marker.length > 0) {
      operationalSignal = "rate-limited";
      [signalMatch] = applied.rate_limit_marker;
    } else if (applied.in_flight_marker.length > 0) {
      operationalSignal = "in-flight";
      [signalMatch] = applied.in_flight_marker;
    }
  }

  // A conclusion drawn from an incomplete snapshot is not a sound conclusion.
  // A surface that failed to fetch may hold the findings that belong to this
  // completion, a newer non-participation declaration, or a later run — and the
  // review procedure treats `completed@target` as the entry to triage, so
  // reporting it here would let an agent triage a finding set it never fully
  // collected. Whatever positive evidence was found stays in matched_evidence,
  // so re-running after a successful fetch is all this costs.
  if (!evidenceComplete) {
    state = "unknown";
    reason = "fetch_incomplete";
    operationalSignal = "none";
  }

  const matchedEvidence = [];
  for (const candidate of [decisive, signalMatch]) {
    if (candidate && !matchedEvidence.includes(candidate)) matchedEvidence.push(candidate);
  }
  for (const group of [structural, ...MARKER_KINDS.map((kind) => matches[kind])]) {
    const [latest] = group;
    if (latest && !matchedEvidence.includes(latest)) matchedEvidence.push(latest);
  }

  return {
    id: reviewer.id,
    display_name: reviewer.display_name,
    default_class: reviewer.default_class,
    trigger: reviewer.trigger,
    expected_target: expectedTarget,
    target_completion_state: state,
    operational_signal: operationalSignal,
    reason,
    evidence_complete: evidenceComplete,
    incomplete_surfaces: incompleteSurfaces,
    run_anchor: runAnchor,
    fallback_order: reviewer.fallback_order ?? [],
    observed_at: reviewer.observed_at ?? null,
    matched_evidence: matchedEvidence,
  };
}

// Evaluates every reviewer in the record against one snapshot. `targetSha` is
// the Selection Contract's expected target; it defaults to the snapshot's head
// SHA, which is only correct when the PR head IS the frozen review target.
export function evaluateReviewerStates(evidence, record, { targetSha, since, recordDigest } = {}) {
  const headSha = evidence?.pr_metadata?.head_sha ?? null;
  const expectedTarget = targetSha ?? headSha;
  return {
    expected_target: expectedTarget,
    expected_target_source: targetSha ? "explicit" : "snapshot_head",
    // The digest of the record this evaluation used. A Selection / run record
    // that cites it makes a mid-run record edit detectable instead of silently
    // changing what the same run means.
    record_digest: recordDigest ?? null,
    reviewers: (record?.reviewers ?? []).map((reviewer) =>
      evaluateReviewer(reviewer, evidence, expectedTarget, headSha, since),
    ),
  };
}

export function formatReviewerStateSummary(states) {
  const lines = ["", `Reviewer target completion state (expected target: ${states.expected_target ?? "unknown"})`];
  for (const reviewer of states.reviewers) {
    const signal = reviewer.operational_signal === "none" ? "" : `, signal: ${reviewer.operational_signal}`;
    lines.push(`${reviewer.id} [${reviewer.default_class}]: ${reviewer.target_completion_state}${signal} (${reviewer.reason})`);
    for (const match of reviewer.matched_evidence) {
      const scope = match.applies ? match.scope : `NOT APPLIED (${match.scope})`;
      const what = match.marker === null ? match.marker_kind : `${match.marker_kind}: "${match.marker}"`;
      lines.push(`  ${what} [${scope}] @ ${match.locator ?? "no locator"}`);
    }
    if (!reviewer.evidence_complete) {
      lines.push(`  incomplete surfaces: ${reviewer.incomplete_surfaces.join(", ")}`);
    }
    if (reviewer.target_completion_state !== "completed@target" && reviewer.fallback_order.length > 0) {
      lines.push(`  fallback order: ${reviewer.fallback_order.join(" -> ")}`);
    }
  }
  return lines.join("\n");
}
