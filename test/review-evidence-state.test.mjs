import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeReviewEvidence,
  digestReviewBody,
  evaluateReviewerTargetStates,
} from "../tooling/review-evidence-state-lib.mjs";

const TARGET = "abcdef1234567";
const OTHER = "1111111222222";
const CAPTURED = "2026-09-03T00:00:00.000Z";
const OBSERVED = "2026-09-03T01:00:00.000Z";

function surface(items = [], fetchStatus = "fetched") {
  return { fetch_status: fetchStatus, items };
}

function evidence({
  conversation = [],
  reviews = [],
  inline = [],
  threads = [],
  statuses = {},
  generatedAt = CAPTURED,
} = {}) {
  return {
    repo: "org/repo",
    pull_number: 74,
    generated_at: generatedAt,
    pr_metadata: {
      fetch_status: "fetched",
      head_sha: TARGET,
    },
    surfaces: {
      conversation_comments: surface(
        conversation,
        statuses.conversation_comments ?? "fetched",
      ),
      review_submissions: surface(
        reviews,
        statuses.review_submissions ?? "fetched",
      ),
      inline_review_comments: surface(
        inline,
        statuses.inline_review_comments ?? "fetched",
      ),
      review_threads: surface(threads, statuses.review_threads ?? "fetched"),
    },
  };
}

function actorFields(
  login = "review-bot",
  databaseId = "9001",
  nodeId = "ACTOR-9001",
) {
  return {
    actor: login,
    actor_database_id: databaseId,
    actor_node_id: nodeId,
  };
}

function conversation(id, body, fields = {}) {
  return {
    id,
    ...actorFields(),
    body,
    created_at: OBSERVED,
    updated_at: OBSERVED,
    locator: "conversation-" + id,
    ...fields,
  };
}

function review(id, body = null, fields = {}) {
  return {
    id,
    ...actorFields(),
    state: "COMMENTED",
    reviewed_sha: TARGET,
    submitted_at: OBSERVED,
    body,
    locator: "review-" + id,
    ...fields,
  };
}

function inline(id, body, fields = {}) {
  return {
    id,
    ...actorFields(),
    body,
    created_at: OBSERVED,
    updated_at: OBSERVED,
    ownership_field_present: true,
    locator: "inline-" + id,
    ...fields,
  };
}

function graphqlComment(id, databaseId, body, fields = {}) {
  return {
    id,
    database_id: databaseId,
    actor: "review-bot",
    actor_database_id: "9001",
    actor_node_id: "ACTOR-9001",
    body,
    created_at: OBSERVED,
    updated_at: OBSERVED,
    ownership_field_present: true,
    locator: "graphql-" + id,
    ...fields,
  };
}

function reviewer(fields = {}) {
  return {
    id: "reviewer-one",
    actors: ["review-bot"],
    completion_marker: {
      any_of: ["DONE"],
      target_pattern: "Target:[^0-9a-fA-F]*([0-9a-fA-F]{7,40})",
    },
    rate_limit_marker: { any_of: ["RATE LIMITED"] },
    failure_marker: { any_of: ["EXECUTION FAILED"] },
    non_participation_marker: { any_of: ["DECLINED"] },
    in_flight_marker: { any_of: ["WORKING"] },
    ...fields,
  };
}

function record(fields = {}) {
  return {
    schema: "ai-dev-foundation/reviewer-capability-record@1",
    reviewers: [reviewer(fields)],
  };
}

function stateFor(input, options = {}) {
  return evaluateReviewerTargetStates(input, {
    record: options.record ?? record(),
    reviewerId: "reviewer-one",
    target: { sha: options.target ?? TARGET },
    runAnchor: options.runAnchor ?? { after: CAPTURED },
  }).reviewer_states[0];
}

test("REST and GraphQL child projections with the same stable ID form one review_comment", () => {
  const input = evidence({
    inline: [
      inline(101, "DONE Target: " + TARGET, {
        node_id: "COMMENT-101",
        review_id: 701,
      }),
    ],
    threads: [
      {
        id: "THREAD-1",
        comments: [
          graphqlComment("COMMENT-101", 101, "DONE Target: " + TARGET, {
            node_id: "COMMENT-101",
            review_id: 701,
          }),
        ],
      },
    ],
  });
  const canonical = canonicalizeReviewEvidence(input);
  const comments = canonical.canonical_objects.filter(
    (object) => object.object_kind === "review_comment",
  );
  assert.equal(comments.length, 1);
  assert.deepEqual(
    comments[0].sources.map((source) => source.surface),
    ["inline_review_comments", "review_threads"],
  );
  assert.ok(
    !canonical.canonical_objects.some(
      (object) => object.object_kind === "review_thread",
    ),
  );
});

test("a stable ID conflict is ambiguous and is never merged", () => {
  const canonical = canonicalizeReviewEvidence(
    evidence({
      inline: [
        inline(102, "DONE Target: " + TARGET, {
          node_id: "COMMENT-A",
        }),
      ],
      threads: [
        {
          id: "THREAD-2",
          comments: [
            graphqlComment("COMMENT-B", 102, "DONE Target: " + TARGET, {
              node_id: "COMMENT-B",
            }),
          ],
        },
      ],
    }),
  );
  const comments = canonical.canonical_objects.filter(
    (object) => object.object_kind === "review_comment",
  );
  assert.equal(comments.length, 2);
  assert.ok(comments.every((object) => object.identity.status === "ambiguous"));
  assert.equal(
    stateFor(
      evidence({
        inline: [
          inline(102, "DONE Target: " + TARGET, { node_id: "COMMENT-A" }),
        ],
        threads: [
          {
            id: "THREAD-2",
            comments: [
              graphqlComment("COMMENT-B", 102, "DONE Target: " + TARGET, {
                node_id: "COMMENT-B",
              }),
            ],
          },
        ],
      }),
    ).state,
    "unknown",
  );
});

test("a same-surface stable ID conflict keeps ambiguous canonical IDs distinct", () => {
  const canonical = canonicalizeReviewEvidence(
    evidence({
      inline: [
        inline(103, "DONE Target: " + TARGET, {
          database_id: "103",
          node_id: "COMMENT-C",
        }),
        inline(103, "DONE Target: " + TARGET, {
          database_id: "104",
          node_id: "COMMENT-D",
        }),
      ],
    }),
  );
  const comments = canonical.canonical_objects.filter(
    (object) => object.object_kind === "review_comment",
  );
  assert.equal(comments.length, 2);
  assert.equal(new Set(comments.map((object) => object.canonical_id)).size, 2);
  assert.ok(comments.every((object) => object.identity.status === "ambiguous"));
});

test("pending review ownership cannot become completion", () => {
  const state = stateFor(
    evidence({
      reviews: [review(701, null, { state: "PENDING" })],
      inline: [inline(201, "DONE Target: " + TARGET, { review_id: 701 })],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("pending_review_owner"));
});

test("GraphQL ownership metadata keeps a pending child out of completion", () => {
  const state = stateFor(
    evidence({
      threads: [
        {
          id: "THREAD-PENDING",
          comments: [
            graphqlComment("COMMENT-PENDING", 721, "DONE Target: " + TARGET, {
              review_id: 721,
              owner_state: "PENDING",
              owner_reviewed_sha: TARGET,
            }),
          ],
        },
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("pending_review_owner"));
});

test("missing ownership metadata never becomes completion", () => {
  const absent = inline(719, "DONE Target: " + TARGET);
  delete absent.ownership_field_present;
  const states = [
    stateFor(evidence({ inline: [absent] })),
    stateFor(
      evidence({
        inline: [
          inline(720, "DONE Target: " + TARGET, {
            ownership_field_present: false,
          }),
        ],
      }),
    ),
  ];
  for (const state of states) {
    assert.equal(state.state, "unknown");
    assert.ok(state.reason_codes.includes("ownership_unresolved"));
  }
});

test("GraphQL submitted ownership contributes a stable review binding", () => {
  const state = stateFor(
    evidence({
      threads: [
        {
          id: "THREAD-SUBMITTED",
          comments: [
            graphqlComment("COMMENT-SUBMITTED", 722, "DONE Target: " + OTHER, {
              review_id: 722,
              owner_state: "COMMENTED",
              owner_reviewed_sha: TARGET,
            }),
          ],
        },
      ],
    }),
  );
  assert.equal(state.state, "completed@target");
});

test("a standalone inline marker is evaluable when its snapshot is self-contained", () => {
  const state = stateFor(
    evidence({
      inline: [inline(202, "DONE Target: " + TARGET)],
    }),
  );
  assert.equal(state.state, "completed@target");
});

test("completion does not encode whether findings were present", () => {
  const clean = stateFor(
    evidence({ conversation: [conversation(301, "DONE Target: " + TARGET)] }),
  );
  const findingful = stateFor(
    evidence({
      reviews: [review(702, "DONE Target: " + TARGET)],
      inline: [inline(203, "finding body", { review_id: 702 })],
    }),
  );
  assert.equal(clean.state, "completed@target");
  assert.equal(findingful.state, "completed@target");
});

test("stable original binding wins over moving and body binding", () => {
  const state = stateFor(
    evidence({
      inline: [
        inline(204, "DONE Target: " + TARGET, {
          original_commit_sha: OTHER,
          reviewed_sha: TARGET,
        }),
      ],
    }),
  );
  assert.equal(state.state, "not-bound");
  assert.ok(state.reason_codes.includes("target_mismatch"));
});

test("stable review binding wins over body and moving binding", () => {
  const state = stateFor(
    evidence({
      reviews: [review(703, null, { reviewed_sha: TARGET })],
      inline: [
        inline(205, "DONE Target: " + OTHER, {
          review_id: 703,
          reviewed_sha: OTHER,
        }),
      ],
    }),
  );
  assert.equal(state.state, "completed@target");
});

test("surface and item order do not affect the canonical result", () => {
  const input = evidence({
    conversation: [conversation(401, "context")],
    reviews: [review(704, "DONE Target: " + TARGET)],
    inline: [
      inline(206, "DONE Target: " + TARGET, { node_id: "COMMENT-206" }),
      inline(207, "WORKING", { node_id: "COMMENT-207" }),
    ],
    threads: [
      {
        id: "THREAD-4",
        comments: [
          graphqlComment("COMMENT-206", 206, "DONE Target: " + TARGET, {
            node_id: "COMMENT-206",
          }),
        ],
      },
    ],
  });
  const permuted = {
    ...input,
    surfaces: {
      review_threads: {
        ...input.surfaces.review_threads,
        items: [...input.surfaces.review_threads.items].reverse(),
      },
      inline_review_comments: {
        ...input.surfaces.inline_review_comments,
        items: [...input.surfaces.inline_review_comments.items].reverse(),
      },
      review_submissions: {
        ...input.surfaces.review_submissions,
        items: [...input.surfaces.review_submissions.items].reverse(),
      },
      conversation_comments: {
        ...input.surfaces.conversation_comments,
        items: [...input.surfaces.conversation_comments.items].reverse(),
      },
    },
  };
  assert.deepEqual(
    canonicalizeReviewEvidence(input),
    canonicalizeReviewEvidence(permuted),
  );
  assert.deepEqual(stateFor(input), stateFor(permuted));
});

test("the latest observed body and revision are projected for a mutable object", () => {
  const input = evidence({
    conversation: [
      conversation(501, "WORKING", {
        updated_at: "2026-09-03T01:00:00.000Z",
      }),
      conversation(501, "DONE Target: " + TARGET, {
        updated_at: "2026-09-03T02:00:00.000Z",
      }),
    ],
  });
  const object = canonicalizeReviewEvidence(input).canonical_objects.find(
    (candidate) => candidate.object_kind === "conversation_comment",
  );
  assert.equal(object.current.body, "DONE Target: " + TARGET);
  assert.equal(object.current.updated_at, "2026-09-03T02:00:00.000Z");
  assert.equal(
    object.current.body_digest,
    digestReviewBody("DONE Target: " + TARGET),
  );
  assert.equal(object.current.revision.body_digest, object.current.body_digest);
  assert.equal(stateFor(input).state, "completed@target");
});

test("a stable actor ID carries attribution across login drift in one snapshot", () => {
  const input = evidence({
    conversation: [
      conversation(601, "context", {
        actor: "review-bot",
        actor_database_id: "9010",
        actor_node_id: "ACTOR-9010",
      }),
    ],
    inline: [
      inline(207, "DONE Target: " + TARGET, {
        actor: "review-bot[bot]",
        actor_database_id: "9010",
        actor_node_id: "ACTOR-9010",
      }),
    ],
  });
  assert.equal(stateFor(input).state, "completed@target");
});

test("a stable actor ID claimed by two reviewers cannot attribute drift", () => {
  const input = evidence({
    conversation: [
      conversation(618, "context", {
        actor: "review-bot",
        actor_database_id: "9012",
        actor_node_id: "ACTOR-9012",
      }),
      conversation(619, "context", {
        actor: "other-review-bot",
        actor_database_id: "9012",
        actor_node_id: "ACTOR-9012",
      }),
      conversation(620, "DONE Target: " + TARGET, {
        actor: "representation-drift",
        actor_database_id: "9012",
        actor_node_id: "ACTOR-9012",
      }),
    ],
  });
  const state = stateFor(input, {
    record: {
      schema: "ai-dev-foundation/reviewer-capability-record@1",
      reviewers: [
        reviewer({ actors: ["review-bot"] }),
        reviewer({ id: "reviewer-two", actors: ["other-review-bot"] }),
      ],
    },
  });
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("actor_unattributed"));
});

test("actor representation without a seed cannot prove attribution", () => {
  const input = evidence({
    conversation: [
      conversation(602, "DONE Target: " + TARGET, {
        actor: "different-login",
        actor_database_id: "9999",
        actor_node_id: "ACTOR-9999",
      }),
    ],
  });
  const state = stateFor(input);
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("actor_unattributed"));
});

test("an observation without an object identity cannot become positive completion", () => {
  const state = stateFor(
    evidence({
      conversation: [conversation(null, "DONE Target: " + TARGET)],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("object_identity_unresolved"));
});

test("database-ID-only and node-ID-only actor observations are usable when exact login is self-contained", () => {
  const databaseOnly = stateFor(
    evidence({
      conversation: [
        conversation(603, "DONE Target: " + TARGET, {
          actor_node_id: null,
        }),
      ],
    }),
  );
  const nodeOnly = stateFor(
    evidence({
      conversation: [
        conversation(604, "DONE Target: " + TARGET, {
          actor_database_id: null,
        }),
      ],
    }),
  );
  assert.equal(databaseOnly.state, "completed@target");
  assert.equal(nodeOnly.state, "completed@target");
});

test("conflicting stable actor IDs block attribution", () => {
  const state = stateFor(
    evidence({
      conversation: [
        conversation(605, "DONE Target: " + TARGET, {
          actor_database_id: "9011",
          actor_node_id: "ACTOR-A",
        }),
        conversation(605, "DONE Target: " + TARGET, {
          actor_database_id: "9011",
          actor_node_id: "ACTOR-B",
        }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("actor_identity_conflict"));
});

test("intermediate evidence is unknown, while explicit active evidence is in-flight", () => {
  assert.equal(
    stateFor(
      evidence({
        conversation: [conversation(606, "acknowledged; starting now")],
      }),
    ).state,
    "unknown",
  );
  assert.equal(
    stateFor(evidence({ conversation: [conversation(607, "WORKING")] })).state,
    "in-flight",
  );
});

test("complete snapshots preserve explicit terminal negative classes", () => {
  assert.equal(
    stateFor(evidence({ conversation: [conversation(608, "RATE LIMITED")] }))
      .state,
    "rate-limited",
  );
  assert.equal(
    stateFor(
      evidence({ conversation: [conversation(609, "EXECUTION FAILED")] }),
    ).state,
    "failed",
  );
  assert.equal(
    stateFor(evidence({ conversation: [conversation(610, "DECLINED")] })).state,
    "declined",
  );
});

test("incomplete acquisition never returns a strong state", () => {
  const state = stateFor(
    evidence({
      conversation: [conversation(611, "DONE Target: " + TARGET)],
      statuses: { review_threads: "partial" },
    }),
  );
  assert.equal(state.state, "unknown");
  assert.equal(state.coverage_complete, false);
  assert.ok(state.reason_codes.includes("coverage_incomplete"));
});

test("an empty complete acquisition is unknown", () => {
  const state = stateFor(evidence());
  assert.equal(state.state, "unknown");
  assert.equal(state.coverage_complete, true);
  assert.ok(state.reason_codes.includes("no_current_run_signal"));
});

test("a completion bound to another target is not-bound", () => {
  const state = stateFor(
    evidence({
      reviews: [review(712, "DONE", { reviewed_sha: OTHER })],
    }),
  );
  assert.equal(state.state, "not-bound");
});

test("moving-only binding cannot produce completion", () => {
  const state = stateFor(
    evidence({
      inline: [
        inline(613, "DONE", {
          reviewed_sha: TARGET,
        }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("moving_or_weak_binding_only"));
});

test("same-tier target conflict is unknown and never downgraded to a weak marker", () => {
  const state = stateFor(
    evidence({
      inline: [
        inline(614, "DONE Target: " + TARGET, { original_commit_sha: TARGET }),
        inline(614, "DONE Target: " + TARGET, { original_commit_sha: OTHER }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("same_tier_target_conflict"));
});

test("same-time completion and active signals are conflicting", () => {
  const state = stateFor(
    evidence({
      conversation: [conversation(615, "DONE Target: " + TARGET + " WORKING")],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("conflicting_signals"));
});

test("the reduced state output has no redundant lifecycle axes", () => {
  const state = stateFor(
    evidence({ conversation: [conversation(616, "DONE Target: " + TARGET)] }),
  );
  assert.deepEqual(Object.keys(state).sort(), [
    "coverage_complete",
    "evidence",
    "observed_signals",
    "reason_codes",
    "reviewer",
    "state",
    "target",
  ]);
  assert.equal(state.state, "completed@target");
});

test("legacy reviewer-capability-record@1 remains the compatibility input", () => {
  const state = stateFor(
    evidence({
      conversation: [
        conversation(617, "DONE Target: " + TARGET, {
          actor_database_id: null,
          actor_node_id: null,
        }),
      ],
    }),
    { record: record() },
  );
  assert.equal(state.state, "completed@target");
});
