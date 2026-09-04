import { createHash } from "node:crypto";

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
const KIND_ORDER = ["conversation_comment", "review", "review_comment"];

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function firstNonNull(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function stableDatabaseId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function sortedUnique(values) {
  return [
    ...new Set(
      [...values]
        .filter((value) => value !== null && value !== undefined)
        .map(String),
    ),
  ].sort();
}

function compareNullable(left, right) {
  const a = left ?? "";
  const b = right ?? "";
  return a < b ? -1 : a > b ? 1 : 0;
}

function digestBody(body) {
  if (body === null || body === undefined) return null;
  return (
    "sha256:" + createHash("sha256").update(String(body), "utf8").digest("hex")
  );
}

export function digestReviewBody(body) {
  return digestBody(body);
}

function timeValue(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventTime(observation) {
  return firstNonNull(
    observation.updated_at,
    observation.submitted_at,
    observation.created_at,
    observation.captured_at,
  );
}

function compareObservations(left, right) {
  return compareNullable(JSON.stringify(left), JSON.stringify(right));
}

function actorFromItem(item) {
  const actorObject = isObject(item.actor) ? item.actor : {};
  const authorObject = isObject(item.author) ? item.author : {};
  const identity = isObject(item.actor_identity) ? item.actor_identity : {};
  return {
    login: nonEmpty(
      firstNonNull(
        typeof item.actor === "string" ? item.actor : null,
        item.actor_login,
        actorObject.login,
        item.author_login,
        authorObject.login,
        identity.login,
      ),
    ),
    database_id: stableDatabaseId(
      firstNonNull(
        item.actor_database_id,
        item.actor_full_database_id,
        identity.database_id,
        identity.full_database_id,
        actorObject.database_id,
        authorObject.database_id,
      ),
    ),
    node_id: nonEmpty(
      firstNonNull(
        item.actor_node_id,
        identity.node_id,
        actorObject.node_id,
        authorObject.node_id,
      ),
    ),
  };
}

function observationFromItem({
  surface,
  objectKind,
  item,
  evidence,
  graphql = false,
  threadId = null,
}) {
  const itemId = firstNonNull(
    item.id,
    item.surface_id,
    item.database_id,
    item.node_id,
  );
  const databaseId = stableDatabaseId(
    firstNonNull(
      item.database_id,
      item.full_database_id,
      !graphql ? itemId : null,
    ),
  );
  const nodeId = nonEmpty(firstNonNull(item.node_id, graphql ? item.id : null));
  const body = item.body === undefined ? null : item.body;
  return {
    surface,
    object_kind: objectKind,
    surface_id: itemId === null ? null : String(itemId),
    database_id: databaseId,
    node_id: nodeId,
    actor: actorFromItem(item),
    body,
    body_digest: item.body_digest ?? digestBody(body),
    created_at: firstNonNull(
      item.created_at,
      item.createdAt,
      item.submitted_at,
    ),
    updated_at: firstNonNull(item.updated_at, item.updatedAt),
    submitted_at: item.submitted_at ?? null,
    captured_at: item.captured_at ?? evidence.generated_at ?? null,
    state: item.state ?? null,
    reviewed_sha: firstNonNull(item.reviewed_sha, item.commit_oid),
    original_commit_sha: firstNonNull(
      item.original_commit_sha,
      item.original_commit_oid,
    ),
    review_id: stableDatabaseId(
      firstNonNull(
        item.review_id,
        item.pull_request_review_id,
        item.review_database_id,
      ),
    ),
    review_node_id: nonEmpty(
      firstNonNull(item.review_node_id, item.pull_request_review_node_id),
    ),
    owner_state: nonEmpty(item.owner_state),
    owner_reviewed_sha: nonEmpty(item.owner_reviewed_sha),
    ownership_field_present:
      typeof item.ownership_field_present === "boolean"
        ? item.ownership_field_present
        : null,
    thread_id: threadId ?? nonEmpty(item.thread_id),
  };
}

function flattenObservations(evidence) {
  const observations = [];
  for (const surface of REVIEW_SURFACES) {
    const value = evidence?.surfaces?.[surface];
    if (!value || !Array.isArray(value.items)) continue;
    for (const item of value.items) {
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
        // A review_thread is only an acquisition envelope. Its child comments
        // are the canonical review_comment objects; thread_id is a relation.
        for (const comment of Array.isArray(item.comments)
          ? item.comments
          : []) {
          if (!isObject(comment)) continue;
          observations.push(
            observationFromItem({
              surface,
              objectKind: "review_comment",
              item: comment,
              evidence,
              graphql: true,
              threadId: firstNonNull(item.id, item.node_id),
            }),
          );
        }
      }
    }
  }
  return observations.sort(compareObservations);
}

function identityConflictIndexes(observations) {
  const conflicts = new Set();
  for (const kind of KIND_ORDER) {
    const databaseNodes = new Map();
    const nodeDatabases = new Map();
    const surfaceIdentities = new Map();
    for (const observation of observations) {
      if (observation.object_kind !== kind || observation.surface_id === null)
        continue;
      const surfaceKey = [observation.surface, observation.surface_id].join(
        ":",
      );
      const identity = surfaceIdentities.get(surfaceKey) ?? {
        indexes: [],
        databases: new Set(),
        nodes: new Set(),
      };
      identity.indexes.push(observations.indexOf(observation));
      if (observation.database_id !== null)
        identity.databases.add(observation.database_id);
      if (observation.node_id !== null) identity.nodes.add(observation.node_id);
      surfaceIdentities.set(surfaceKey, identity);
      if (observation.database_id !== null && observation.node_id !== null) {
        databaseNodes.set(
          observation.database_id,
          new Set([
            ...(databaseNodes.get(observation.database_id) ?? []),
            observation.node_id,
          ]),
        );
        nodeDatabases.set(
          observation.node_id,
          new Set([
            ...(nodeDatabases.get(observation.node_id) ?? []),
            observation.database_id,
          ]),
        );
      }
    }
    for (const identity of surfaceIdentities.values()) {
      if (identity.databases.size > 1 || identity.nodes.size > 1) {
        for (const index of identity.indexes) conflicts.add(index);
      }
    }
    const badDatabases = new Set(
      [...databaseNodes]
        .filter((entry) => entry[1].size > 1)
        .map((entry) => entry[0]),
    );
    const badNodes = new Set(
      [...nodeDatabases]
        .filter((entry) => entry[1].size > 1)
        .map((entry) => entry[0]),
    );
    for (const [index, observation] of observations.entries()) {
      if (
        observation.object_kind === kind &&
        (badDatabases.has(observation.database_id) ||
          badNodes.has(observation.node_id))
      )
        conflicts.add(index);
    }
  }
  return conflicts;
}

function compatible(group, observation) {
  return (
    (observation.database_id === null ||
      group.database_ids.size === 0 ||
      group.database_ids.has(observation.database_id)) &&
    (observation.node_id === null ||
      group.node_ids.size === 0 ||
      group.node_ids.has(observation.node_id))
  );
}

function groupObservations(observations) {
  const conflicts = identityConflictIndexes(observations);
  const groups = [];
  for (const [index, observation] of observations.entries()) {
    const keys = [
      observation.database_id === null
        ? null
        : "database:" + observation.database_id,
      observation.node_id === null ? null : "node:" + observation.node_id,
    ].filter(Boolean);
    const candidates = conflicts.has(index)
      ? []
      : groups.filter((group) => {
          if (
            group.object_kind !== observation.object_kind ||
            group.identity_ambiguous
          ) {
            return false;
          }
          const sharedStableId = keys.some((key) => group.keys.has(key));
          const sameSurface = group.observations.some(
            (candidate) =>
              candidate.surface === observation.surface &&
              candidate.surface_id !== null &&
              candidate.surface_id === observation.surface_id,
          );
          return (
            (sharedStableId || sameSurface) && compatible(group, observation)
          );
        });
    if (candidates.length === 1) {
      const group = candidates[0];
      group.observations.push(observation);
      for (const key of keys) group.keys.add(key);
      if (observation.database_id !== null)
        group.database_ids.add(observation.database_id);
      if (observation.node_id !== null) group.node_ids.add(observation.node_id);
      continue;
    }
    if (candidates.length > 1) {
      for (const candidate of candidates) candidate.identity_ambiguous = true;
    }
    groups.push({
      object_kind: observation.object_kind,
      observations: [observation],
      keys: new Set(keys),
      database_ids: new Set(
        observation.database_id === null ? [] : [observation.database_id],
      ),
      node_ids: new Set(
        observation.node_id === null ? [] : [observation.node_id],
      ),
      identity_ambiguous: conflicts.has(index) || candidates.length > 1,
    });
  }
  return groups;
}

function projectBody(observations) {
  const bodies = observations.filter(
    (observation) => observation.body !== null,
  );
  if (bodies.length === 0) {
    return {
      body: null,
      body_digest: null,
      body_status: "missing",
      updated_at: null,
      captured_at: null,
    };
  }
  const timed = bodies.map((observation) => ({
    observation,
    time: timeValue(eventTime(observation)),
  }));
  const knownTimes = timed.filter((entry) => entry.time !== null);
  const latestTime =
    knownTimes.length === 0
      ? null
      : Math.max(...knownTimes.map((entry) => entry.time));
  const latest =
    latestTime === null
      ? bodies
      : timed
          .filter((entry) => entry.time === latestTime)
          .map((entry) => entry.observation);
  const digests = sortedUnique(
    latest.map(
      (observation) => observation.body_digest ?? digestBody(observation.body),
    ),
  );
  if (digests.length > 1) {
    return {
      body: null,
      body_digest: null,
      body_status: "ambiguous",
      updated_at: null,
      captured_at: null,
    };
  }
  const chosen = [...latest].sort(compareObservations)[latest.length - 1];
  return {
    body: chosen.body,
    body_digest: chosen.body_digest ?? digestBody(chosen.body),
    body_status: "current",
    updated_at: chosen.updated_at ?? null,
    captured_at: chosen.captured_at ?? null,
  };
}

function projectActor(observations) {
  const actors = observations.map((observation) => observation.actor);
  const databaseIds = sortedUnique(actors.map((actor) => actor.database_id));
  const nodeIds = sortedUnique(actors.map((actor) => actor.node_id));
  const corroborated = actors.some(
    (actor) => actor.database_id !== null && actor.node_id !== null,
  );
  const split = databaseIds.length > 0 && nodeIds.length > 0 && !corroborated;
  const ambiguous = databaseIds.length > 1 || nodeIds.length > 1 || split;
  return {
    status: ambiguous
      ? "ambiguous"
      : databaseIds.length || nodeIds.length
        ? "stable"
        : "unresolved",
    database_id: ambiguous ? null : (databaseIds[0] ?? null),
    node_id: ambiguous ? null : (nodeIds[0] ?? null),
    logins: sortedUnique(actors.map((actor) => actor.login)),
  };
}

function projectReviewState(observations) {
  const withState = observations.filter((observation) =>
    nonEmpty(observation.state),
  );
  if (withState.length === 0) return null;
  const latestTime = Math.max(
    ...withState.map(
      (observation) => timeValue(eventTime(observation)) ?? -Infinity,
    ),
  );
  const states = sortedUnique(
    withState
      .filter(
        (observation) =>
          (timeValue(eventTime(observation)) ?? -Infinity) === latestTime,
      )
      .map((observation) => observation.state.toUpperCase()),
  );
  return states.length === 1 ? states[0] : "AMBIGUOUS";
}

function initialOwnership(observations) {
  if (observations[0].object_kind !== "review_comment")
    return { status: "not_applicable" };
  if (
    !observations.every(
      (observation) => observation.ownership_field_present === true,
    )
  ) {
    return { status: "unknown" };
  }
  const ids = sortedUnique(
    observations.map((observation) => observation.review_id),
  );
  const nodeIds = sortedUnique(
    observations.map((observation) => observation.review_node_id),
  );
  const ownerStates = sortedUnique(
    observations.map((observation) => observation.owner_state),
  );
  const ownerReviewedShas = sortedUnique(
    observations.map((observation) => observation.owner_reviewed_sha),
  );
  if (ids.length > 1 || nodeIds.length > 1) return { status: "ambiguous" };
  if (ids.length === 0 && nodeIds.length === 0) return { status: "standalone" };
  return {
    status: "owner_reference",
    review_id: ids[0] ?? null,
    review_node_id: nodeIds[0] ?? null,
    owner_state: ownerStates.length === 1 ? ownerStates[0] : null,
    owner_reviewed_sha:
      ownerReviewedShas.length === 1 ? ownerReviewedShas[0] : null,
  };
}

function structuralBindings(observations) {
  return dedupeBindings(
    observations.flatMap((observation) =>
      [
        observation.original_commit_sha && {
          tier: 1,
          basis: "comment.original_commit",
          target: observation.original_commit_sha,
        },
        observation.object_kind === "review" &&
          observation.reviewed_sha && {
            tier: 2,
            basis: "review.submitted_commit",
            target: observation.reviewed_sha,
          },
        observation.object_kind === "review_comment" &&
          observation.reviewed_sha && {
            tier: 4,
            basis: "comment.commit",
            target: observation.reviewed_sha,
          },
      ].filter(Boolean),
    ),
  );
}

function dedupeBindings(candidates) {
  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = [candidate.tier, candidate.basis, candidate.target].join(":");
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
  const databases = sortedUnique(group.database_ids);
  const nodes = sortedUnique(group.node_ids);
  const stable =
    !group.identity_ambiguous && (databases.length === 1 || nodes.length === 1);
  const local = group.observations.every(
    (observation) =>
      observation.surface === group.observations[0].surface &&
      observation.surface_id !== null,
  );
  const idPart = stable
    ? databases.length === 1
      ? "database:" + databases[0]
      : "node:" + nodes[0]
    : local && !group.identity_ambiguous
      ? "surface:" +
        group.observations[0].surface +
        ":id:" +
        group.observations[0].surface_id
      : "observation:" +
        JSON.stringify(
          group.observations
            .map((observation) => [
              observation.surface,
              observation.surface_id,
              observation.database_id,
              observation.node_id,
            ])
            .sort(),
        );
  const status = group.identity_ambiguous
    ? "ambiguous"
    : stable
      ? "stable"
      : local
        ? "surface-local"
        : "uncanonicalized";
  return {
    status,
    database_id: stable && databases.length === 1 ? databases[0] : null,
    node_id: stable && nodes.length === 1 ? nodes[0] : null,
    canonical_id:
      "github://" +
      (repo ?? "unknown") +
      "/pull/" +
      (pullNumber ?? "unknown") +
      "/" +
      group.object_kind +
      "/" +
      idPart,
  };
}

function buildCanonicalObject(repo, pullNumber, group) {
  const observations = [...group.observations].sort(compareObservations);
  const identity = canonicalIdentity(repo, pullNumber, group);
  const body = projectBody(observations);
  const createdAt =
    observations
      .map((observation) => observation.created_at)
      .filter(nonEmpty)
      .sort((left, right) => compareNullable(left, right))[0] ?? null;
  const sources = [
    ...new Map(
      observations.map((observation) => [
        [observation.surface, observation.surface_id ?? null].join(":"),
        { surface: observation.surface, surface_id: observation.surface_id },
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      compareNullable(left.surface, right.surface) ||
      compareNullable(left.surface_id, right.surface_id),
  );
  return {
    canonical_id: identity.canonical_id,
    object_kind: group.object_kind,
    identity: {
      status: identity.status,
      database_id: identity.database_id,
      node_id: identity.node_id,
    },
    sources,
    current: {
      body: body.body,
      body_digest: body.body_digest,
      body_status: body.body_status,
      created_at: createdAt,
      updated_at: body.updated_at,
      captured_at: body.captured_at,
      revision: {
        updated_at: body.updated_at,
        body_digest: body.body_digest,
        captured_at: body.captured_at,
      },
      actor: projectActor(observations),
      ownership: initialOwnership(observations),
      review_state:
        group.object_kind === "review"
          ? projectReviewState(observations)
          : null,
      thread_id:
        sortedUnique(
          observations.map((observation) => observation.thread_id),
        )[0] ?? null,
      binding_candidates: structuralBindings(observations),
    },
  };
}

function attachOwners(objects) {
  const reviews = objects.filter((object) => object.object_kind === "review");
  for (const object of objects) {
    if (
      object.object_kind !== "review_comment" ||
      object.current.ownership.status !== "owner_reference"
    ) {
      continue;
    }
    const ref = object.current.ownership;
    const matches = reviews.filter(
      (review) =>
        review.identity.status === "stable" &&
        ((ref.review_id !== null &&
          review.identity.database_id === ref.review_id) ||
          (ref.review_node_id !== null &&
            review.identity.node_id === ref.review_node_id)),
    );
    if (matches.length !== 1) {
      if (["PENDING", "DRAFT"].includes(ref.owner_state?.toUpperCase())) {
        object.current.ownership = {
          status: "pending",
          review_id: ref.review_id,
          review_node_id: ref.review_node_id,
        };
        continue;
      }
      // Embedded submitted-review metadata remains usable when its separate
      // review projection is absent; it is still a review-level owner ref.
      if (matches.length === 0 && ref.owner_state) {
        object.current.ownership = {
          status: "owned",
          review_id: ref.review_id,
          review_node_id: ref.review_node_id,
        };
        if (ref.owner_reviewed_sha) {
          object.current.binding_candidates = dedupeBindings([
            ...object.current.binding_candidates,
            {
              tier: 2,
              basis: "review.owner.submitted_commit",
              target: ref.owner_reviewed_sha,
            },
          ]);
        }
        continue;
      }
      object.current.ownership = {
        status: matches.length > 1 ? "ambiguous" : "unknown",
      };
      continue;
    }
    const owner = matches[0];
    const ownerState = owner.current.review_state;
    if (ownerState === null || ownerState === "AMBIGUOUS") {
      object.current.ownership = { status: "unknown" };
      continue;
    }
    if (ownerState === "PENDING" || ownerState === "DRAFT") {
      object.current.ownership = {
        status: "pending",
        review_id: owner.identity.database_id,
        review_node_id: owner.identity.node_id,
      };
      continue;
    }
    object.current.ownership = {
      status: "owned",
      review_id: owner.identity.database_id,
      review_node_id: owner.identity.node_id,
      review_canonical_id: owner.canonical_id,
    };
    if (
      owner.current.binding_candidates.some((candidate) => candidate.tier === 2)
    ) {
      object.current.binding_candidates = dedupeBindings([
        ...object.current.binding_candidates,
        ...owner.current.binding_candidates
          .filter((candidate) => candidate.tier === 2)
          .map((candidate) => ({
            ...candidate,
            basis: "review.owner.submitted_commit",
          })),
      ]);
    }
  }
}

export function canonicalizeReviewEvidence(
  evidence,
  { capturedAt = evidence?.generated_at ?? null } = {},
) {
  const groups = groupObservations(flattenObservations(evidence ?? {}));
  const objects = groups.map((group) =>
    buildCanonicalObject(evidence?.repo, evidence?.pull_number, group),
  );
  attachOwners(objects);
  objects.sort((left, right) =>
    compareNullable(left.canonical_id, right.canonical_id),
  );
  const incomplete = [];
  if (evidence?.pr_metadata?.fetch_status !== "fetched")
    incomplete.push("pr_metadata");
  else if (!nonEmpty(evidence.pr_metadata.head_sha))
    incomplete.push("pr_metadata.head_sha");
  for (const surface of REVIEW_SURFACES) {
    if (evidence?.surfaces?.[surface]?.fetch_status !== "fetched")
      incomplete.push("surface:" + surface);
  }
  return {
    schema: REVIEW_EVIDENCE_STATE_SCHEMA_ID,
    repo: evidence?.repo ?? null,
    pull_number: evidence?.pull_number ?? null,
    captured_at: capturedAt,
    coverage_complete: incomplete.length === 0,
    incomplete_surfaces: incomplete,
    canonical_objects: objects,
  };
}

function targetSha(target) {
  if (typeof target === "string") return nonEmpty(target);
  return isObject(target)
    ? nonEmpty(firstNonNull(target.sha, target.target_sha, target.commit_sha))
    : null;
}

function markerMatch(body, marker) {
  if (!isObject(marker) || typeof body !== "string") return null;
  const anyOf = Array.isArray(marker.any_of)
    ? marker.any_of.filter((value) => typeof value === "string")
    : [];
  const allOf = Array.isArray(marker.all_of)
    ? marker.all_of.filter((value) => typeof value === "string")
    : [];
  if (anyOf.length > 0 && !anyOf.some((value) => body.includes(value)))
    return null;
  if (allOf.some((value) => !body.includes(value))) return null;
  let target = null;
  if (marker.target_pattern) {
    let expression;
    try {
      expression = new RegExp(marker.target_pattern, "i");
    } catch {
      return { target: null, reason_code: "target_marker_invalid" };
    }
    const match = expression.exec(body);
    if (match) target = match.slice(1).find((value) => nonEmpty(value)) ?? null;
    if (!match) return { target: null, reason_code: "target_marker_missing" };
  }
  return { target };
}

function markerSignals(object, reviewer) {
  return [
    ["completion", reviewer?.completion_marker],
    ["rate-limited", reviewer?.rate_limit_marker],
    ["failed", reviewer?.failure_marker],
    ["declined", reviewer?.non_participation_marker],
    ["in-flight", reviewer?.in_flight_marker],
  ]
    .map(([kind, marker]) => {
      const match = markerMatch(object.current.body, marker);
      return match ? { kind, ...match } : null;
    })
    .filter(Boolean);
}

function actorIdKey(object) {
  return [
    object.current.actor.database_id
      ? "database:" + object.current.actor.database_id
      : null,
    object.current.actor.node_id
      ? "node:" + object.current.actor.node_id
      : null,
  ].filter(Boolean);
}

function actorClaims(objects, reviewers) {
  const claims = new Map();
  for (const object of objects) {
    if (object.current.actor.status === "ambiguous") continue;
    const claimants = reviewers
      .filter((reviewer) =>
        object.current.actor.logins.some((login) =>
          Array.isArray(reviewer.actors)
            ? reviewer.actors.includes(login)
            : false,
        ),
      )
      .map((reviewer) => reviewer.id);
    for (const key of actorIdKey(object)) {
      const ids = claims.get(key) ?? new Set();
      for (const claimant of claimants) ids.add(claimant);
      claims.set(key, ids);
    }
  }
  return claims;
}

function actorSeeds(objects, reviewer, reviewers) {
  const seeds = new Set();
  const logins = new Set(
    Array.isArray(reviewer?.actors) ? reviewer.actors : [],
  );
  const claims = actorClaims(objects, reviewers);
  for (const object of objects) {
    if (object.current.actor.status === "ambiguous") continue;
    if (!object.current.actor.logins.some((login) => logins.has(login)))
      continue;
    for (const key of actorIdKey(object)) {
      if (claims.get(key)?.size === 1 && claims.get(key).has(reviewer.id)) {
        seeds.add(key);
      }
    }
  }
  return seeds;
}

function attributeActor(object, reviewer, seeds, reviewers) {
  const actor = object.current.actor;
  if (actor.status === "ambiguous") {
    return { status: "unknown", reason_code: "actor_identity_conflict" };
  }
  const exactLogin = actor.logins.some(
    (login) =>
      Array.isArray(reviewer?.actors) && reviewer.actors.includes(login),
  );
  const exactLoginIsUnique = actor.logins.some(
    (login) =>
      Array.isArray(reviewer?.actors) &&
      reviewer.actors.includes(login) &&
      reviewers.filter((candidate) =>
        Array.isArray(candidate.actors)
          ? candidate.actors.includes(login)
          : false,
      ).length === 1,
  );
  const ids = actorIdKey(object);
  if (exactLoginIsUnique && object.sources.length === 1) {
    return { status: "attributed", reason_code: "exact_login_single_surface" };
  }
  if (exactLoginIsUnique && ids.length > 0) {
    return { status: "attributed", reason_code: "exact_login_stable_id" };
  }
  if (ids.some((key) => seeds.has(key))) {
    return { status: "attributed", reason_code: "snapshot_stable_actor_id" };
  }
  return { status: "unknown", reason_code: "actor_unattributed" };
}

function anchorMatch(object, runAnchor) {
  if (!isObject(runAnchor))
    return { matched: false, reason_code: "run_anchor_missing" };
  const ids = sortedUnique(Array.isArray(runAnchor.ids) ? runAnchor.ids : []);
  const after = timeValue(runAnchor.after);
  const idMatched = object.sources.some(
    (source) =>
      source.surface_id !== null && ids.includes(String(source.surface_id)),
  );
  const observedAt = timeValue(
    firstNonNull(
      object.current.updated_at,
      object.current.created_at,
      object.current.revision.captured_at,
    ),
  );
  const afterMatched =
    after !== null && observedAt !== null && observedAt > after;
  if (ids.length === 0 && after === null)
    return { matched: false, reason_code: "run_anchor_missing" };
  if ((ids.length > 0 && !idMatched) || (after !== null && !afterMatched)) {
    return {
      matched: false,
      reason_code:
        ids.length > 0
          ? "run_anchor_not_matched"
          : "evidence_before_run_anchor",
    };
  }
  return {
    matched: true,
    reason_code:
      ids.length > 0 ? "run_anchor_object_id" : "run_anchor_after_timestamp",
  };
}

function bindingForObject(object, markerTarget) {
  const candidates = [...(object.current.binding_candidates ?? [])];
  if (markerTarget) {
    candidates.push({
      tier: 3,
      basis: "body.explicit_target_marker",
      target: markerTarget,
    });
  }
  const usable = candidates.filter((candidate) => nonEmpty(candidate.target));
  if (usable.length === 0) {
    return {
      status: "unknown",
      effective: null,
      reason_code: "target_binding_missing",
    };
  }
  const strongestTier = Math.min(...usable.map((candidate) => candidate.tier));
  const strongest = usable.filter(
    (candidate) => candidate.tier === strongestTier,
  );
  const targets = sortedUnique(strongest.map((candidate) => candidate.target));
  if (targets.length > 1) {
    return {
      status: "ambiguous",
      effective: null,
      reason_code: "same_tier_target_conflict",
    };
  }
  if (strongestTier >= 4) {
    return {
      status: "unknown",
      effective: strongest[0],
      reason_code: "moving_or_weak_binding_only",
    };
  }
  return { status: "bound", effective: strongest[0], reason_code: null };
}

// The shortest abbreviation that may stand for a commit. Below this, a prefix
// match is not evidence that two claims name the same target.
const MIN_ABBREVIATED_TARGET_LENGTH = 7;

// Two target claims describe the same commit when they are equal, or when one
// is an abbreviation of the other. This is the same tolerance the target
// comparison below applies, and it is the only comparison that may be used
// between two claimed targets: comparing them as raw strings makes a short SHA
// and its full form look like two different targets.
function sameTargetClaim(left, right) {
  const a = nonEmpty(left)?.toLowerCase();
  const b = nonEmpty(right)?.toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= MIN_ABBREVIATED_TARGET_LENGTH && b.startsWith(a)) return true;
  if (b.length >= MIN_ABBREVIATED_TARGET_LENGTH && a.startsWith(b)) return true;
  return false;
}

function chooseSignal(signals) {
  if (signals.length === 0)
    return { signal: null, conflict: false, latest: [] };
  const time = (signal) => timeValue(signal.event_at) ?? -Infinity;
  const latestTime = Math.max(...signals.map(time));
  const latest = signals.filter((signal) => time(signal) === latestTime);
  const kinds = new Set(latest.map((signal) => signal.kind));
  const targets = latest.map((signal) => signal.target_claim).filter(Boolean);
  // A reviewer that posts its result across several objects at once (a review
  // submission plus its inline comments, say) repeats its completion marker on
  // each of them, and may abbreviate the SHA differently between them. That is
  // one claim expressed more than once, not two claims in conflict.
  //
  // Every claim is compared against the LONGEST one, never against an arbitrary
  // representative: `sameTargetClaim` is not transitive, so `abcdef0…111` and
  // `abcdef0…222` are both compatible with the abbreviation `abcdef0` while
  // naming different commits. Requiring each claim to be an abbreviation of one
  // longest claim makes them pairwise compatible — prefixes of a common string
  // are ordered by length — so two full SHAs that disagree are still a conflict.
  const longest = targets.reduce(
    (best, candidate) => (candidate.length > (best?.length ?? -1) ? candidate : best),
    null,
  );
  const targetsDisagree = targets.some(
    (candidate) => !sameTargetClaim(candidate, longest),
  );
  if (kinds.size > 1 || targetsDisagree) {
    return { signal: null, conflict: true, latest };
  }
  // Prefer the most specific claim, so the binding downstream compares the
  // longest SHA the reviewer actually stated. `canonical_id` breaks ties so the
  // choice stays deterministic across snapshots.
  latest.sort((left, right) => {
    const byLength =
      (nonEmpty(left.target_claim)?.length ?? 0) -
      (nonEmpty(right.target_claim)?.length ?? 0);
    return byLength !== 0
      ? byLength
      : compareNullable(left.canonical_id, right.canonical_id);
  });
  return { signal: latest[latest.length - 1], conflict: false, latest };
}

function evidenceForSignals(signals) {
  return [
    ...new Map(
      signals.map((signal) => [
        signal.canonical_id,
        {
          canonical_id: signal.canonical_id,
          sources: signal.object.sources,
          revision: signal.object.current.revision,
        },
      ]),
    ).values(),
  ].sort((left, right) =>
    compareNullable(left.canonical_id, right.canonical_id),
  );
}

function stateForReviewer(canonical, reviewer, target, runAnchor, reviewers) {
  const targetValue = targetSha(target);
  const reasons = new Set();
  const accepted = [];
  const observed = [];
  const seeds = actorSeeds(canonical.canonical_objects, reviewer, reviewers);

  for (const object of canonical.canonical_objects) {
    const markers = markerSignals(object, reviewer);
    if (markers.length === 0) continue;
    const attribution = attributeActor(object, reviewer, seeds, reviewers);
    const anchor = anchorMatch(object, runAnchor);
    for (const marker of markers) {
      const signal = {
        kind: marker.kind,
        canonical_id: object.canonical_id,
        event_at: firstNonNull(
          object.current.updated_at,
          object.current.created_at,
          object.current.revision.captured_at,
        ),
        target_claim: marker.target,
        attribution: attribution.status,
        anchor: anchor.matched ? "matched" : "unproven",
        accepted: false,
      };
      let reasonCode = null;
      if (object.identity.status === "ambiguous") {
        reasonCode = "object_identity_ambiguous";
      } else if (object.identity.status === "uncanonicalized") {
        reasonCode = "object_identity_unresolved";
      } else if (object.identity.status === "surface-local") {
        reasonCode = "object_identity_surface_local";
      } else if (object.current.body_status === "ambiguous") {
        reasonCode = "body_revision_ambiguous";
      } else if (attribution.status !== "attributed") {
        reasonCode = attribution.reason_code;
      } else if (!anchor.matched) {
        reasonCode = anchor.reason_code;
      }
      if (reasonCode) {
        reasons.add(reasonCode);
        observed.push({ ...signal, reason_code: reasonCode });
      } else {
        signal.accepted = true;
        observed.push(signal);
        accepted.push({ ...signal, object });
      }
    }
  }

  const chosen = chooseSignal(accepted);
  let state = "unknown";
  if (chosen.conflict) {
    reasons.add("conflicting_signals");
  } else if (chosen.signal) {
    const signal = chosen.signal;
    if (signal.kind === "completion") {
      const ownership = signal.object.current.ownership;
      const pendingReview =
        signal.object.object_kind === "review" &&
        ["PENDING", "DRAFT"].includes(signal.object.current.review_state);
      if (pendingReview || ownership.status === "pending") {
        reasons.add("pending_review_owner");
      } else if (
        signal.object.object_kind === "review_comment" &&
        !["owned", "standalone"].includes(ownership.status)
      ) {
        reasons.add("ownership_unresolved");
      } else {
        const binding = bindingForObject(signal.object, signal.target_claim);
        if (binding.reason_code) reasons.add(binding.reason_code);
        if (!targetValue) {
          reasons.add("target_missing");
        } else if (binding.status === "bound") {
          if (!canonical.coverage_complete) {
            reasons.add("coverage_incomplete");
          } else if (
            (() => {
              return sameTargetClaim(binding.effective.target, targetValue);
            })()
          ) {
            state = "completed@target";
          } else {
            state = "not-bound";
            reasons.add("target_mismatch");
          }
        } else {
          reasons.add("binding_unresolved");
        }
      }
    } else if (canonical.coverage_complete) {
      state = signal.kind;
    } else {
      reasons.add("coverage_incomplete");
    }
  } else {
    if (!canonical.coverage_complete) reasons.add("coverage_incomplete");
    reasons.add("no_current_run_signal");
  }

  return {
    reviewer: reviewer?.id ?? null,
    target: targetValue,
    state,
    coverage_complete: canonical.coverage_complete,
    evidence: evidenceForSignals(
      chosen.conflict ? chosen.latest : chosen.signal ? [chosen.signal] : [],
    ),
    observed_signals: observed,
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
    coverage_complete: canonical.coverage_complete,
    incomplete_surfaces: canonical.incomplete_surfaces,
    target: { sha: targetSha(target) },
    canonical_objects: canonical.canonical_objects,
    reviewer_states: selected.map((reviewer) =>
      stateForReviewer(canonical, reviewer, target, runAnchor, reviewers),
    ),
  };
}
