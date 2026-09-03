import { createHash } from "node:crypto";

// Issue #74: the smallest provider-neutral model needed to turn a fetched
// review-evidence snapshot into canonical GitHub objects and reviewer target
// lifecycle states. This module is deliberately pure: it neither fetches nor
// posts anything, and it does not decide findings, Resolution, or readiness.

export const REVIEW_EVIDENCE_STATE_SCHEMA_ID =
  "ai-dev-foundation/review-evidence-state@1";

export const TARGET_COMPLETION_STATES = [
  "completed@target",
  "not-bound",
  "rate-limited",
  "failed",
  "declined",
  "in-flight",
  "unknown",
];

const REVIEW_SURFACES = [
  "conversation_comments",
  "review_submissions",
  "inline_review_comments",
  "review_threads",
];
const SURFACE_ORDER = [
  "conversation_comments",
  "review_submissions",
  "inline_review_comments",
  "review_threads",
];
const KIND_ORDER = [
  "conversation_comment",
  "review",
  "review_comment",
  "review_thread",
];
const NEGATIVE_STATES = new Set(["rate-limited", "failed", "declined"]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stableDatabaseId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return value.trim();
  return null;
}

function stableNodeId(value) {
  return nonEmpty(value);
}

function firstNonNull(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function sortStrings(values) {
  return [
    ...new Set(
      [...values]
        .filter((value) => value !== null && value !== undefined)
        .map(String),
    ),
  ].sort();
}

function bodyDigest(body) {
  if (body === null || body === undefined) return null;
  return `sha256:${createHash("sha256").update(String(body), "utf8").digest("hex")}`;
}

export function digestReviewBody(body) {
  return bodyDigest(body);
}

function shortDigest(value) {
  return createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function timeValue(value) {
  if (!value || typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventTime(observation) {
  return firstNonNull(
    observation.updated_at,
    observation.submitted_at,
    observation.created_at,
  );
}

function compareNullable(a, b) {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareObservations(left, right) {
  const surfaceDifference =
    SURFACE_ORDER.indexOf(left.surface) - SURFACE_ORDER.indexOf(right.surface);
  if (surfaceDifference !== 0) return surfaceDifference;
  const kindDifference =
    KIND_ORDER.indexOf(left.object_kind) -
    KIND_ORDER.indexOf(right.object_kind);
  if (kindDifference !== 0) return kindDifference;
  for (const [a, b] of [
    [left.database_id, right.database_id],
    [left.node_id, right.node_id],
    [left.surface_id, right.surface_id],
    [left.updated_at, right.updated_at],
    [left.created_at, right.created_at],
    [left.body_digest, right.body_digest],
    [left.locator, right.locator],
  ]) {
    const difference = compareNullable(a, b);
    if (difference !== 0) return difference;
  }
  return 0;
}

function identityKeys(value) {
  const keys = [];
  const databaseId = stableDatabaseId(value.database_id);
  const nodeId = stableNodeId(value.node_id);
  if (databaseId !== null) keys.push(`database:${databaseId}`);
  if (nodeId !== null) keys.push(`node:${nodeId}`);
  return keys;
}

function actorFromItem(item) {
  const identity = isObject(item.actor_identity) ? item.actor_identity : {};
  return {
    login: nonEmpty(firstNonNull(item.actor, identity.login)),
    type: nonEmpty(firstNonNull(item.actor_type, identity.type)),
    database_id: stableDatabaseId(
      firstNonNull(
        item.actor_database_id,
        identity.database_id,
        item.actor_full_database_id,
        identity.full_database_id,
      ),
    ),
    node_id: stableNodeId(firstNonNull(item.actor_node_id, identity.node_id)),
  };
}

function observationFromItem({
  surface,
  objectKind,
  item,
  evidence,
  isGraphql = false,
  parent = null,
}) {
  const itemId = firstNonNull(item.id, item.database_id, item.node_id);
  const databaseId = stableDatabaseId(
    firstNonNull(
      item.full_database_id,
      item.database_id,
      !isGraphql && itemId !== null ? itemId : null,
    ),
  );
  const nodeId = stableNodeId(
    firstNonNull(item.node_id, isGraphql ? item.id : null),
  );
  const actor = actorFromItem(item);
  const body = item.body ?? null;
  return {
    surface,
    object_kind: objectKind,
    surface_id: itemId === null ? null : String(itemId),
    database_id: databaseId,
    node_id: nodeId,
    actor,
    body,
    body_digest: bodyDigest(body),
    created_at: firstNonNull(item.created_at, item.submitted_at),
    updated_at: item.updated_at ?? null,
    submitted_at: item.submitted_at ?? null,
    captured_at: item.captured_at ?? evidence.generated_at ?? null,
    locator: item.locator ?? null,
    state: item.state ?? null,
    reviewed_sha: item.reviewed_sha ?? null,
    original_commit_sha: item.original_commit_sha ?? null,
    review_id: firstNonNull(item.pull_request_review_id, item.review_id),
    review_node_id: item.review_node_id ?? null,
    ownership_field_present: item.ownership_field_present ?? null,
    in_reply_to_id: item.in_reply_to_id ?? null,
    path: item.path ?? null,
    line: item.line ?? null,
    thread_id: firstNonNull(item.thread_id, parent?.id),
    thread_is_resolved: firstNonNull(
      item.thread_is_resolved,
      parent?.is_resolved,
    ),
    thread_is_outdated: firstNonNull(
      item.thread_is_outdated,
      parent?.is_outdated,
    ),
  };
}

function flattenObservations(evidence) {
  const observations = [];
  for (const surface of REVIEW_SURFACES) {
    const surfaceValue = evidence?.surfaces?.[surface];
    if (!surfaceValue || !Array.isArray(surfaceValue.items)) continue;
    for (const item of surfaceValue.items) {
      if (!isObject(item)) continue;
      if (surface === "conversation_comments") {
        observations.push(
          observationFromItem({
            surface,
            objectKind: "conversation_comment",
            item,
            evidence,
          }),
        );
      } else if (surface === "review_submissions") {
        observations.push(
          observationFromItem({
            surface,
            objectKind: "review",
            item,
            evidence,
          }),
        );
      } else if (surface === "inline_review_comments") {
        observations.push(
          observationFromItem({
            surface,
            objectKind: "review_comment",
            item,
            evidence,
          }),
        );
      } else {
        const thread = observationFromItem({
          surface,
          objectKind: "review_thread",
          item: {
            id: item.id,
            node_id: item.node_id ?? item.id,
            is_resolved: item.is_resolved,
            is_outdated: item.is_outdated,
          },
          evidence,
          isGraphql: true,
        });
        thread.thread_id = thread.surface_id;
        thread.thread_is_resolved = item.is_resolved ?? null;
        thread.thread_is_outdated = item.is_outdated ?? null;
        observations.push(thread);
        for (const comment of item.comments ?? []) {
          if (!isObject(comment)) continue;
          const commentObservation = observationFromItem({
            surface,
            objectKind: "review_comment",
            item: comment,
            evidence,
            isGraphql: true,
            parent: thread,
          });
          commentObservation.thread_id = thread.surface_id;
          commentObservation.thread_is_resolved = item.is_resolved ?? null;
          commentObservation.thread_is_outdated = item.is_outdated ?? null;
          observations.push(commentObservation);
        }
      }
    }
  }
  return observations.sort(compareObservations);
}

function buildIdentityConflictSet(observations) {
  const conflicts = new Set();
  for (const kind of KIND_ORDER) {
    const byDatabase = new Map();
    const byNode = new Map();
    const conflictingDatabaseIds = new Set();
    const conflictingNodeIds = new Set();
    for (const [index, observation] of observations.entries()) {
      if (observation.object_kind !== kind) continue;
      const databaseId = stableDatabaseId(observation.database_id);
      const nodeId = stableNodeId(observation.node_id);
      if (databaseId !== null && nodeId !== null) {
        const values = byDatabase.get(databaseId) ?? new Map();
        values.set(nodeId, [...(values.get(nodeId) ?? []), index]);
        byDatabase.set(databaseId, values);
      }
      if (nodeId !== null && databaseId !== null) {
        const values = byNode.get(nodeId) ?? new Map();
        values.set(databaseId, [...(values.get(databaseId) ?? []), index]);
        byNode.set(nodeId, values);
      }
    }
    for (const [databaseId, values] of byDatabase.entries()) {
      if (values.size < 2) continue;
      conflictingDatabaseIds.add(databaseId);
      for (const indices of values.values())
        for (const index of indices) conflicts.add(index);
    }
    for (const [nodeId, values] of byNode.entries()) {
      if (values.size < 2) continue;
      conflictingNodeIds.add(nodeId);
      for (const indices of values.values())
        for (const index of indices) conflicts.add(index);
    }
    for (const [index, observation] of observations.entries()) {
      if (observation.object_kind !== kind) continue;
      if (
        conflictingDatabaseIds.has(stableDatabaseId(observation.database_id)) ||
        conflictingNodeIds.has(stableNodeId(observation.node_id))
      ) {
        conflicts.add(index);
      }
    }
  }
  return conflicts;
}

function groupHasKey(group, key) {
  return group.keys.has(key);
}

function compatibleWithGroup(observation, group) {
  const databaseId = stableDatabaseId(observation.database_id);
  const nodeId = stableNodeId(observation.node_id);
  if (
    databaseId !== null &&
    group.database_ids.size > 0 &&
    !group.database_ids.has(databaseId)
  )
    return false;
  if (nodeId !== null && group.node_ids.size > 0 && !group.node_ids.has(nodeId))
    return false;
  return true;
}

function groupObservations(observations, conflictIndices) {
  const groups = [];
  for (const [index, observation] of observations.entries()) {
    const keys = identityKeys(observation);
    const localCandidates = groups.filter(
      (group) =>
        group.object_kind === observation.object_kind &&
        keys.length === 0 &&
        group.keys.size === 0 &&
        group.observations.some(
          (candidate) =>
            candidate.surface === observation.surface &&
            candidate.surface_id === observation.surface_id,
        ),
    );
    const stableCandidates = groups.filter(
      (group) =>
        group.object_kind === observation.object_kind &&
        keys.some((key) => groupHasKey(group, key)) &&
        compatibleWithGroup(observation, group) &&
        !group.observations.some((candidate) =>
          conflictIndices.has(observations.indexOf(candidate)),
        ),
    );
    const candidates = conflictIndices.has(index)
      ? []
      : [...new Set([...localCandidates, ...stableCandidates])];
    if (candidates.length === 1) {
      const group = candidates[0];
      group.observations.push(observation);
      for (const key of keys) group.keys.add(key);
      if (observation.database_id !== null)
        group.database_ids.add(observation.database_id);
      if (observation.node_id !== null) group.node_ids.add(observation.node_id);
      continue;
    }
    const group = {
      object_kind: observation.object_kind,
      observations: [observation],
      keys: new Set(keys),
      database_ids: new Set(
        observation.database_id === null ? [] : [observation.database_id],
      ),
      node_ids: new Set(
        observation.node_id === null ? [] : [observation.node_id],
      ),
      identity_conflict: conflictIndices.has(index) || candidates.length > 1,
    };
    if (candidates.length > 1)
      for (const candidate of candidates) candidate.identity_conflict = true;
    groups.push(group);
  }
  return groups;
}

function projectActor(observations) {
  const actors = observations
    .map((observation) => observation.actor)
    .filter((actor) => isObject(actor));
  const databaseIds = sortStrings(actors.map((actor) => actor.database_id));
  const nodeIds = sortStrings(actors.map((actor) => actor.node_id));
  const logins = sortStrings(actors.map((actor) => actor.login));
  const hasCorroboratedPair = actors.some(
    (actor) => actor.database_id !== null && actor.node_id !== null,
  );
  const splitIdentity =
    actors.length > 1 &&
    databaseIds.length > 0 &&
    nodeIds.length > 0 &&
    !hasCorroboratedPair;
  const status =
    databaseIds.length > 1 || nodeIds.length > 1 || splitIdentity
      ? "ambiguous"
      : databaseIds.length || nodeIds.length
        ? "stable"
        : "unresolved";
  return {
    status,
    database_id: databaseIds[0] ?? null,
    node_id: nodeIds[0] ?? null,
    database_ids: databaseIds,
    node_ids: nodeIds,
    logins,
    basis:
      status === "stable"
        ? "stable-id"
        : status === "ambiguous"
          ? "conflicting-stable-id"
          : "no-stable-id",
  };
}

function projectBody(observations) {
  const withBodies = observations.filter(
    (observation) =>
      observation.body !== null && observation.body !== undefined,
  );
  const byDigest = new Map();
  for (const observation of withBodies) {
    const digest = observation.body_digest ?? bodyDigest(observation.body);
    const entries = byDigest.get(digest) ?? [];
    entries.push(observation);
    byDigest.set(digest, entries);
  }
  if (withBodies.length === 0) {
    return {
      body: null,
      body_digest: null,
      status: "missing",
      source_observation_ids: [],
      updated_at: null,
      captured_at: null,
    };
  }

  let selected = withBodies;
  let status = "current";
  if (byDigest.size > 1) {
    const timed = withBodies.filter(
      (observation) => timeValue(eventTime(observation)) !== null,
    );
    if (timed.length > 0) {
      const latestTime = Math.max(
        ...timed.map((observation) => timeValue(eventTime(observation))),
      );
      selected = timed.filter(
        (observation) => timeValue(eventTime(observation)) === latestTime,
      );
      if (
        new Set(selected.map((observation) => observation.body_digest)).size > 1
      )
        status = "ambiguous";
    } else {
      selected = [...withBodies].sort(compareObservations).slice(-1);
      status = "ambiguous";
    }
  } else {
    const latestTime = Math.max(
      ...withBodies.map(
        (observation) => timeValue(eventTime(observation)) ?? -Infinity,
      ),
    );
    if (latestTime !== -Infinity)
      selected = withBodies.filter(
        (observation) =>
          (timeValue(eventTime(observation)) ?? -Infinity) === latestTime,
      );
  }
  const current = [...selected].sort(compareObservations)[selected.length - 1];
  const sourceObservationIds = withBodies
    .filter(
      (observation) =>
        observation.body_digest === current.body_digest &&
        observation.body === current.body,
    )
    .map(observationIdentity)
    .sort();
  return {
    body: current.body,
    body_digest: current.body_digest ?? bodyDigest(current.body),
    status,
    source_observation_ids: sourceObservationIds,
    updated_at: current.updated_at,
    captured_at: current.captured_at,
  };
}

function observationIdentity(observation) {
  return `${observation.surface}:${observation.surface_id ?? "<none>"}:${observation.database_id ?? "<none>"}:${observation.node_id ?? "<none>"}`;
}

function projectTimestamp(observations, field, direction) {
  const values = observations
    .map((observation) => observation[field])
    .filter(nonEmpty);
  if (values.length === 0) return null;
  const timed = values
    .map((value) => ({ value, time: timeValue(value) }))
    .filter((entry) => entry.time !== null);
  if (timed.length > 0) {
    const selectedTime =
      direction === "earliest"
        ? Math.min(...timed.map((entry) => entry.time))
        : Math.max(...timed.map((entry) => entry.time));
    return timed.find((entry) => entry.time === selectedTime).value;
  }
  return [...values].sort().at(direction === "earliest" ? 0 : -1);
}

function projectOwnership(observations) {
  const relevant = observations.filter(
    (observation) => observation.object_kind === "review_comment",
  );
  if (relevant.length === 0)
    return {
      status: "not_applicable",
      review_ids: [],
      review_node_ids: [],
      field_present: false,
    };
  const fieldPresent = relevant.every(
    (observation) => observation.ownership_field_present === true,
  );
  const reviewIds = sortStrings(
    relevant.map((observation) => stableDatabaseId(observation.review_id)),
  );
  const reviewNodeIds = sortStrings(
    relevant.map((observation) => stableNodeId(observation.review_node_id)),
  );
  if (!fieldPresent)
    return {
      status: "unknown",
      review_ids: reviewIds,
      review_node_ids: reviewNodeIds,
      field_present: false,
    };
  if (reviewIds.length > 1 || reviewNodeIds.length > 1)
    return {
      status: "ambiguous",
      review_ids: reviewIds,
      review_node_ids: reviewNodeIds,
      field_present: true,
    };
  if (reviewIds.length || reviewNodeIds.length)
    return {
      status: "owned",
      review_ids: reviewIds,
      review_node_ids: reviewNodeIds,
      field_present: true,
    };
  return {
    status: "standalone",
    review_ids: [],
    review_node_ids: [],
    field_present: true,
  };
}

function projectThread(observations) {
  const ids = sortStrings(
    observations.map((observation) => observation.thread_id),
  );
  const resolved = sortStrings(
    observations.map((observation) => observation.thread_is_resolved),
  );
  const outdated = sortStrings(
    observations.map((observation) => observation.thread_is_outdated),
  );
  let status = ids.length === 0 ? "none" : "known";
  if (resolved.length > 1 || outdated.length > 1) status = "ambiguous";
  return { status, ids, resolved, outdated };
}

function structuralBindingCandidates(observations) {
  const candidates = [];
  for (const observation of observations) {
    if (observation.original_commit_sha) {
      candidates.push({
        tier: 1,
        stability: "stable",
        basis: "comment.original_commit",
        target: observation.original_commit_sha,
        observation: observationIdentity(observation),
      });
    }
    if (observation.object_kind === "review" && observation.reviewed_sha) {
      candidates.push({
        tier: 2,
        stability: "stable",
        basis: "review.submitted_commit",
        target: observation.reviewed_sha,
        observation: observationIdentity(observation),
      });
    }
    if (observation.reviewed_sha) {
      candidates.push({
        tier: 4,
        stability: "moving",
        basis: "comment.commit",
        target: observation.reviewed_sha,
        observation: observationIdentity(observation),
      });
    }
  }
  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.tier}:${candidate.target}:${candidate.basis}:${candidate.observation ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        compareNullable(left.target, right.target) ||
        compareNullable(left.basis, right.basis),
    );
}

function canonicalIdentity(repo, pullNumber, group) {
  const databaseIds = sortStrings(group.database_ids);
  const nodeIds = sortStrings(group.node_ids);
  const identityStatus = group.identity_conflict
    ? "ambiguous"
    : databaseIds.length || nodeIds.length
      ? "stable"
      : group.observations.every(
            (observation) =>
              observation.surface === group.observations[0].surface,
          ) && group.observations[0].surface_id
        ? "surface-local"
        : "uncanonicalized";
  if (!group.identity_conflict && databaseIds.length > 0) {
    return {
      status: identityStatus,
      database_ids: databaseIds,
      node_ids: nodeIds,
      canonical_id: `github://${repo ?? "unknown"}/pull/${pullNumber ?? "unknown"}/${group.object_kind}/database:${databaseIds[0]}`,
    };
  }
  if (!group.identity_conflict && nodeIds.length > 0) {
    return {
      status: identityStatus,
      database_ids: databaseIds,
      node_ids: nodeIds,
      canonical_id: `github://${repo ?? "unknown"}/pull/${pullNumber ?? "unknown"}/${group.object_kind}/node:${nodeIds[0]}`,
    };
  }
  const claims = group.observations.map((observation) => ({
    surface: observation.surface,
    surface_id: observation.surface_id,
    database_id: observation.database_id,
    node_id: observation.node_id,
  }));
  const prefix =
    identityStatus === "surface-local"
      ? `surface:${group.observations[0].surface}:id:${group.observations[0].surface_id}`
      : "uncanonicalized";
  return {
    status: identityStatus,
    database_ids: databaseIds,
    node_ids: nodeIds,
    canonical_id: `github://${repo ?? "unknown"}/pull/${pullNumber ?? "unknown"}/${group.object_kind}/${prefix}:${shortDigest(JSON.stringify(claims))}`,
  };
}

function buildCanonicalObject(repo, pullNumber, group) {
  const observations = [...group.observations].sort(compareObservations);
  const identity = canonicalIdentity(repo, pullNumber, group);
  const body = projectBody(observations);
  const actor = projectActor(observations);
  const current = {
    body: body.body,
    body_digest: body.body_digest,
    body_status: body.status,
    created_at: projectTimestamp(observations, "created_at", "earliest"),
    updated_at: body.updated_at,
    captured_at: body.captured_at,
    revision: {
      updated_at: body.updated_at,
      body_digest: body.body_digest,
      captured_at: body.captured_at,
    },
    actor,
    ownership: projectOwnership(observations),
    thread: projectThread(observations),
    state: sortStrings(observations.map((observation) => observation.state)),
    binding_candidates: structuralBindingCandidates(observations),
  };
  return {
    canonical_id: identity.canonical_id,
    object_kind: group.object_kind,
    identity: {
      status: identity.status,
      database_id: identity.database_ids[0] ?? null,
      node_id: identity.node_ids[0] ?? null,
      database_ids: identity.database_ids,
      node_ids: identity.node_ids,
    },
    current,
    relationships: {
      review_ids: current.ownership.review_ids,
      review_node_ids: current.ownership.review_node_ids,
      thread_ids: current.thread.ids,
      reply_to_ids: sortStrings(
        observations.map((observation) => observation.in_reply_to_id),
      ),
    },
    observations: observations.map((observation) => ({
      surface: observation.surface,
      object_kind: observation.object_kind,
      surface_id: observation.surface_id,
      database_id: observation.database_id,
      node_id: observation.node_id,
      actor: observation.actor,
      body: observation.body,
      body_digest: observation.body_digest,
      created_at: observation.created_at,
      updated_at: observation.updated_at,
      submitted_at: observation.submitted_at,
      captured_at: observation.captured_at,
      locator: observation.locator,
      state: observation.state,
      reviewed_sha: observation.reviewed_sha,
      original_commit_sha: observation.original_commit_sha,
      review_id: observation.review_id,
      review_node_id: observation.review_node_id,
      ownership_field_present: observation.ownership_field_present,
      thread_id: observation.thread_id,
      thread_is_resolved: observation.thread_is_resolved,
      thread_is_outdated: observation.thread_is_outdated,
      path: observation.path,
      line: observation.line,
    })),
    provenance: observations.map((observation) => ({
      surface: observation.surface,
      locator: observation.locator,
      surface_id: observation.surface_id,
      captured_at: observation.captured_at,
      updated_at: observation.updated_at,
      body_digest: observation.body_digest,
      field_sources: {
        identity: [
          observation.database_id ? "database_id" : null,
          observation.node_id ? "node_id" : null,
        ].filter(Boolean),
        body: observation.body === null ? [] : ["body"],
        actor: [
          observation.actor.database_id ? "actor_database_id" : null,
          observation.actor.node_id ? "actor_node_id" : null,
          observation.actor.login ? "actor_login" : null,
        ].filter(Boolean),
      },
    })),
  };
}

function reviewLookup(objects) {
  const lookup = new Map();
  for (const object of objects.filter(
    (candidate) =>
      candidate.object_kind === "review" &&
      candidate.identity.status !== "ambiguous",
  )) {
    for (const key of [
      `database:${object.identity.database_id}`,
      `node:${object.identity.node_id}`,
    ]) {
      if (!key.endsWith(":null")) lookup.set(key, object);
    }
    for (const observation of object.observations) {
      for (const key of identityKeys({
        database_id: observation.database_id,
        node_id: observation.node_id,
      }))
        lookup.set(key, object);
    }
  }
  return lookup;
}

function attachOwnerBindings(objects) {
  const lookup = reviewLookup(objects);
  for (const object of objects.filter(
    (candidate) => candidate.object_kind === "review_comment",
  )) {
    const owners = [];
    for (const observation of object.observations) {
      for (const key of identityKeys({
        database_id: observation.review_id,
        node_id: observation.review_node_id,
      })) {
        const review = lookup.get(key);
        if (review) owners.push(review);
      }
    }
    const uniqueOwners = [
      ...new Map(owners.map((owner) => [owner.canonical_id, owner])).values(),
    ];
    if (["unknown", "ambiguous"].includes(object.current.ownership.status)) {
      continue;
    }
    if (uniqueOwners.length === 1) {
      const owner = uniqueOwners[0];
      object.current.ownership = {
        ...object.current.ownership,
        status: owner.current.state.some((state) =>
          ["PENDING", "DRAFT"].includes(String(state).toUpperCase()),
        )
          ? "pending"
          : "owned",
        owner_canonical_id: owner.canonical_id,
      };
      object.current.binding_candidates = dedupeCandidates([
        ...object.current.binding_candidates,
        ...owner.current.binding_candidates
          .filter((candidate) => candidate.tier === 2)
          .map((candidate) => ({
            ...candidate,
            basis: "review.owner.submitted_commit",
            owner_canonical_id: owner.canonical_id,
          })),
      ]);
    } else if (
      object.current.ownership.status === "owned" &&
      uniqueOwners.length === 0
    ) {
      object.current.ownership = {
        ...object.current.ownership,
        status: "unknown",
      };
    } else if (uniqueOwners.length > 1) {
      object.current.ownership = {
        ...object.current.ownership,
        status: "ambiguous",
        owner_canonical_ids: uniqueOwners
          .map((owner) => owner.canonical_id)
          .sort(),
      };
    }
  }
}

function coverageSummary(evidence) {
  const incompleteSurfaces = [];
  const observedSurfaces = {};
  for (const surface of REVIEW_SURFACES) {
    const fetchStatus =
      evidence?.surfaces?.[surface]?.fetch_status ?? "missing";
    observedSurfaces[surface] = fetchStatus;
    if (fetchStatus !== "fetched")
      incompleteSurfaces.push({ surface, fetch_status: fetchStatus });
  }
  const incompleteFacts = [];
  const metadataStatus = evidence?.pr_metadata?.fetch_status ?? "missing";
  if (metadataStatus !== "fetched") incompleteFacts.push("pr_metadata");
  if (metadataStatus === "fetched" && !evidence.pr_metadata.head_sha)
    incompleteFacts.push("pr_metadata.head_sha");
  for (const entry of incompleteSurfaces)
    incompleteFacts.push(`surface:${entry.surface}`);
  return {
    status:
      incompleteSurfaces.length === 0 &&
      metadataStatus === "fetched" &&
      Boolean(evidence.pr_metadata.head_sha)
        ? "complete"
        : "incomplete",
    required_surfaces: [...REVIEW_SURFACES],
    incomplete_surfaces: incompleteSurfaces,
    incomplete_facts: incompleteFacts,
    observed_surfaces: observedSurfaces,
  };
}

export function canonicalizeReviewEvidence(
  evidence,
  { capturedAt = evidence?.generated_at ?? null } = {},
) {
  const source = {
    ...(evidence ?? {}),
    generated_at: evidence?.generated_at ?? capturedAt,
  };
  const observations = flattenObservations(source);
  const conflictIndices = buildIdentityConflictSet(observations);
  const groups = groupObservations(observations, conflictIndices);
  const objects = groups.map((group) =>
    buildCanonicalObject(source.repo, source.pull_number, group),
  );
  attachOwnerBindings(objects);
  objects.sort((left, right) =>
    compareNullable(left.canonical_id, right.canonical_id),
  );
  return {
    schema: REVIEW_EVIDENCE_STATE_SCHEMA_ID,
    repo: source.repo ?? null,
    pull_number: source.pull_number ?? null,
    captured_at: capturedAt,
    coverage: coverageSummary(source),
    canonical_objects: objects,
  };
}

function targetSha(target) {
  if (typeof target === "string") return nonEmpty(target);
  if (isObject(target))
    return nonEmpty(
      firstNonNull(target.sha, target.target_sha, target.commit_sha),
    );
  return null;
}

function targetMatches(candidate, expected) {
  const left = nonEmpty(candidate)?.toLowerCase();
  const right = nonEmpty(expected)?.toLowerCase();
  if (!left || !right) return false;
  return (
    left === right ||
    (left.length >= 7 && right.startsWith(left)) ||
    (right.length >= 7 && left.startsWith(right))
  );
}

function matchMarker(body, marker) {
  if (!isObject(marker) || typeof body !== "string") return null;
  const anyOf = Array.isArray(marker.any_of)
    ? marker.any_of.filter((value) => typeof value === "string")
    : [];
  const allOf = Array.isArray(marker.all_of)
    ? marker.all_of.filter((value) => typeof value === "string")
    : [];
  const anyMatches = anyOf.filter((value) => body.includes(value));
  const allMatches = allOf.filter((value) => body.includes(value));
  if (anyOf.length > 0 && anyMatches.length === 0) return null;
  if (allOf.length > 0 && allMatches.length !== allOf.length) return null;
  let target = null;
  if (marker.target_pattern) {
    let expression;
    try {
      expression = new RegExp(marker.target_pattern, "i");
    } catch {
      return { matched: true, target: null, target_pattern_invalid: true };
    }
    const match = expression.exec(body);
    if (!match) return { matched: true, target: null, target_missing: true };
    target = match.slice(1).find((value) => nonEmpty(value)) ?? null;
  }
  return {
    matched: true,
    target,
    any_matches: anyMatches,
    all_matches: allMatches,
  };
}

function reviewerIdentityEntries(reviewer) {
  return Array.isArray(reviewer?.actor_identities)
    ? reviewer.actor_identities.filter(isObject)
    : [];
}

function attributeActor(object, reviewer, record) {
  const actor = object.current.actor;
  const observations = object.observations;
  if (actor.status === "ambiguous")
    return { status: "ambiguous", reason_code: "actor_identity_conflict" };
  if (!actor.logins.length && !actor.database_id && !actor.node_id)
    return { status: "unknown", reason_code: "actor_unattributed" };

  const identities = reviewerIdentityEntries(reviewer);
  const isLegacy =
    record?.schema === "ai-dev-foundation/reviewer-capability-record@1";
  if (!isLegacy && identities.length > 0) {
    if (!actor.database_id && !actor.node_id)
      return {
        status: "unknown",
        reason_code: "actor_stable_identity_missing",
      };
    const matches = identities.filter((identity) => {
      const databaseId = stableDatabaseId(identity.database_id);
      const nodeId = stableNodeId(identity.node_id);
      return (
        (databaseId && actor.database_ids.includes(databaseId)) ||
        (nodeId && actor.node_ids.includes(nodeId))
      );
    });
    if (matches.length === 0)
      return {
        status: "not_attributed",
        reason_code: "actor_identity_not_declared",
      };
    return {
      status: "attributed",
      reason_code: "stable_actor_identity",
      identity_count: matches.length,
    };
  }
  if (!isLegacy)
    return { status: "unknown", reason_code: "actor_stable_identity_missing" };

  const exactLogin =
    observations.length === 1 &&
    observations[0].actor.login &&
    Array.isArray(reviewer?.actors) &&
    reviewer.actors.includes(observations[0].actor.login);
  if (exactLogin)
    return {
      status: "attributed",
      reason_code: "legacy_exact_login_single_surface",
    };
  return {
    status: "unknown",
    reason_code: "legacy_identity_not_self_contained",
  };
}

function anchorIdentifiers(object, observation) {
  return new Set(
    [
      object.canonical_id,
      observation.surface_id,
      observation.database_id,
      observation.node_id,
      observation.locator,
    ].filter(nonEmpty),
  );
}

function anchorMatch(object, observation, runAnchor) {
  if (!isObject(runAnchor))
    return { matched: false, reason_code: "run_anchor_missing" };
  const after = timeValue(runAnchor.after);
  const identifiers = new Set(
    (Array.isArray(runAnchor.ids) ? runAnchor.ids : [])
      .filter(nonEmpty)
      .map(String),
  );
  const idMatched = [...anchorIdentifiers(object, observation)].some(
    (identifier) => identifiers.has(String(identifier)),
  );
  if (after !== null) {
    const event = timeValue(eventTime(observation));
    if (event === null)
      return { matched: false, reason_code: "run_anchor_time_unavailable" };
    if (event <= after)
      return { matched: false, reason_code: "evidence_before_run_anchor" };
    return { matched: true, reason_code: "run_anchor_after_timestamp" };
  }
  if (idMatched) return { matched: true, reason_code: "run_anchor_object_id" };
  return { matched: false, reason_code: "run_anchor_not_matched" };
}

function markerSignals(object, reviewer) {
  const body = object.current.body;
  const markers = [
    ["completion", reviewer?.completion_marker],
    ["rate-limited", reviewer?.rate_limit_marker],
    ["failed", reviewer?.failure_marker],
    ["declined", reviewer?.non_participation_marker],
    ["in-flight", reviewer?.in_flight_marker],
  ];
  return markers
    .map(([kind, marker]) => {
      const match = matchMarker(body, marker);
      return match ? { kind, marker_match: match } : null;
    })
    .filter(Boolean);
}

function bindingForObject(object, markerTarget) {
  const candidates = [...(object.current.binding_candidates ?? [])];
  if (markerTarget) {
    candidates.push({
      tier: 3,
      stability: "stable",
      basis: "body.explicit_target_marker",
      target: markerTarget,
    });
  }
  const usable = candidates.filter((candidate) => nonEmpty(candidate.target));
  if (usable.length === 0)
    return {
      status: "unknown",
      effective: null,
      candidates: [],
      reason_code: "target_binding_missing",
    };
  usable.sort(
    (left, right) =>
      left.tier - right.tier ||
      compareNullable(left.target, right.target) ||
      compareNullable(left.basis, right.basis),
  );
  const strongestTier = usable[0].tier;
  const strongest = usable.filter(
    (candidate) => candidate.tier === strongestTier,
  );
  const targets = sortStrings(strongest.map((candidate) => candidate.target));
  if (targets.length > 1)
    return {
      status: "ambiguous",
      effective: null,
      candidates: usable,
      reason_code: "same_tier_target_conflict",
    };
  if (strongestTier >= 4)
    return {
      status: "unknown",
      effective: strongest[0],
      candidates: usable,
      reason_code: "moving_or_weak_binding_only",
    };
  return {
    status: "candidate",
    effective: strongest[0],
    candidates: usable,
    reason_code: null,
  };
}

function stateMeta(state) {
  switch (state) {
    case "completed@target":
      return {
        terminal: true,
        polarity: "positive",
        binding_status: "target-bound",
      };
    case "not-bound":
      return {
        terminal: true,
        polarity: "positive",
        binding_status: "mismatch",
      };
    case "rate-limited":
    case "failed":
    case "declined":
      return {
        terminal: true,
        polarity: "negative",
        binding_status: "not-required",
      };
    case "in-flight":
      return {
        terminal: false,
        polarity: "indeterminate",
        binding_status: "unknown",
      };
    default:
      return {
        terminal: false,
        polarity: "indeterminate",
        binding_status: "unknown",
      };
  }
}

function signalTime(signal) {
  return timeValue(signal.event_at) ?? -Infinity;
}

function chooseSignal(signals) {
  if (signals.length === 0) return { signal: null, conflict: false };
  const latestTime = Math.max(...signals.map(signalTime));
  const latest = signals.filter((signal) => signalTime(signal) === latestTime);
  const kinds = new Set(latest.map((signal) => signal.kind));
  if (kinds.size > 1) return { signal: null, conflict: true, signals: latest };
  latest.sort((left, right) =>
    compareNullable(left.canonical_id, right.canonical_id),
  );
  return { signal: latest[latest.length - 1], conflict: false };
}

function stateForReviewer(canonical, reviewer, record, target, runAnchor) {
  const targetValue = targetSha(target);
  const reasons = new Set();
  const signals = [];
  const observedSignals = [];
  for (const object of canonical.canonical_objects) {
    const markers = markerSignals(object, reviewer);
    if (markers.length === 0) continue;
    if (object.identity.status === "ambiguous") {
      for (const marker of markers) {
        observedSignals.push({
          kind: marker.kind,
          canonical_id: object.canonical_id,
          event_at: object.current.updated_at ?? object.current.created_at,
          target_claim: marker.marker_match.target ?? null,
          locator: object.provenance[0]?.locator ?? null,
          attribution: "blocked",
          anchor: "unproven",
          accepted: false,
          reason_code: "object_identity_ambiguous",
        });
      }
      reasons.add("object_identity_ambiguous");
      continue;
    }
    const attribution = attributeActor(object, reviewer, record);
    const sourceObservations = object.observations.filter(
      (observation) =>
        object.current.body_status !== "ambiguous" &&
        object.current.body_digest === observation.body_digest,
    );
    for (const marker of markers) {
      const anchorResults = sourceObservations.map((observation) => ({
        observation,
        anchor: anchorMatch(object, observation, runAnchor),
      }));
      const anchored = anchorResults.find((entry) => entry.anchor.matched);
      const signal = {
        kind: marker.kind,
        canonical_id: object.canonical_id,
        event_at: anchored?.observation
          ? eventTime(anchored.observation)
          : (object.current.updated_at ?? object.current.created_at),
        target_claim: marker.marker_match.target ?? null,
        locator:
          anchored?.observation?.locator ??
          object.provenance[0]?.locator ??
          null,
        attribution: attribution.status,
        anchor: anchored ? "matched" : "unproven",
      };
      if (attribution.status !== "attributed") {
        reasons.add(attribution.reason_code);
        observedSignals.push({
          ...signal,
          accepted: false,
          reason_code: attribution.reason_code,
        });
        continue;
      }
      if (!anchored) {
        const reason =
          anchorResults[0]?.anchor.reason_code ?? "run_anchor_missing";
        reasons.add(reason);
        observedSignals.push({
          ...signal,
          accepted: false,
          reason_code: reason,
        });
        continue;
      }
      observedSignals.push({ ...signal, accepted: true });
      signals.push({
        ...signal,
        object,
        marker,
        observation: anchored.observation,
      });
    }
  }

  const chosen = chooseSignal(signals);
  let state = "unknown";
  let binding = {
    status: "unknown",
    effective: null,
    candidates: [],
    reason_code: "no_current_run_signal",
  };
  let evidenceObjects = [];

  if (chosen.conflict) {
    reasons.add("conflicting_signals");
  } else if (chosen.signal) {
    const signal = chosen.signal;
    evidenceObjects = [signal.canonical_id];
    if (signal.kind === "completion") {
      const reviewIsPending =
        signal.object.object_kind === "review" &&
        signal.object.current.state.some((state) =>
          ["PENDING", "DRAFT"].includes(String(state).toUpperCase()),
        );
      if (
        signal.object.current.ownership.status === "pending" ||
        reviewIsPending
      ) {
        reasons.add("pending_review_owner");
      } else if (
        signal.object.object_kind === "review_comment" &&
        !["owned", "standalone"].includes(
          signal.object.current.ownership.status,
        )
      ) {
        reasons.add("ownership_unresolved");
      } else {
        binding = bindingForObject(signal.object, signal.target_claim);
        if (binding.reason_code) reasons.add(binding.reason_code);
        if (!targetValue) {
          reasons.add("target_missing");
        } else if (binding.status === "candidate") {
          if (targetMatches(binding.effective.target, targetValue)) {
            state =
              canonical.coverage.status === "complete"
                ? "completed@target"
                : "unknown";
            if (canonical.coverage.status !== "complete")
              reasons.add("coverage_incomplete");
          } else {
            state = "not-bound";
            reasons.add("target_mismatch");
          }
        } else if (binding.status === "ambiguous") {
          reasons.add("binding_ambiguous");
        } else {
          reasons.add("binding_unresolved");
        }
      }
    } else {
      state = signal.kind;
    }
  } else {
    if (canonical.coverage.status !== "complete")
      reasons.add("coverage_incomplete");
    if (observedSignals.length === 0) reasons.add("no_current_run_signal");
  }

  if (
    !chosen.conflict &&
    state === "unknown" &&
    observedSignals.some(
      (signal) => signal.kind === "in-flight" && signal.accepted,
    )
  ) {
    state = "in-flight";
    reasons.delete("no_current_run_signal");
  }
  const meta = stateMeta(state);
  const fallbackEligible =
    NEGATIVE_STATES.has(state) &&
    canonical.coverage.status === "complete" &&
    Boolean(chosen.signal) &&
    chosen.signal.anchor === "matched" &&
    chosen.signal.attribution === "attributed";
  if (NEGATIVE_STATES.has(state) && canonical.coverage.status !== "complete")
    reasons.add("fallback_requires_complete_coverage");
  if (state === "completed@target" && canonical.coverage.status !== "complete")
    reasons.add("positive_requires_complete_coverage");
  const bindingMatchesTarget =
    binding.status === "candidate" &&
    targetValue &&
    binding.effective &&
    targetMatches(binding.effective.target, targetValue);
  const outputBindingStatus =
    state === "completed@target"
      ? "target-bound"
      : state === "not-bound"
        ? "mismatch"
        : state === "unknown"
          ? binding.status === "ambiguous"
            ? "ambiguous"
            : "unknown"
          : bindingMatchesTarget
            ? "target-bound"
            : binding.status === "candidate"
              ? "unresolved"
              : binding.status === "ambiguous"
                ? "ambiguous"
                : meta.binding_status;
  return {
    reviewer: reviewer?.id ?? null,
    target: targetValue,
    state,
    terminal: meta.terminal,
    polarity: meta.polarity,
    binding_status: outputBindingStatus,
    effective_binding: binding.effective,
    coverage: canonical.coverage,
    fallback_eligible: fallbackEligible,
    evidence: {
      canonical_object_ids: evidenceObjects,
      locators: sortStrings(
        observedSignals
          .filter((signal) => signal.accepted && signal.locator)
          .map((signal) => signal.locator),
      ),
    },
    observed_signals: observedSignals,
    reason_codes: [...reasons].sort(),
  };
}

export function evaluateReviewerTargetStates(
  evidence,
  {
    record,
    target,
    reviewerId = null,
    runAnchor = null,
    capturedAt = evidence?.generated_at ?? null,
  } = {},
) {
  const canonical =
    evidence?.schema === REVIEW_EVIDENCE_STATE_SCHEMA_ID &&
    Array.isArray(evidence.canonical_objects)
      ? evidence
      : canonicalizeReviewEvidence(evidence, { capturedAt });
  const reviewers = Array.isArray(record?.reviewers) ? record.reviewers : [];
  const selected = reviewerId
    ? reviewers.filter((reviewer) => reviewer.id === reviewerId)
    : reviewers;
  return {
    schema: REVIEW_EVIDENCE_STATE_SCHEMA_ID,
    repo: canonical.repo,
    pull_number: canonical.pull_number,
    captured_at: canonical.captured_at,
    target: { sha: targetSha(target) },
    coverage: canonical.coverage,
    canonical_objects: canonical.canonical_objects,
    reviewer_states: selected.map((reviewer) =>
      stateForReviewer(canonical, reviewer, record, target, runAnchor),
    ),
  };
}
