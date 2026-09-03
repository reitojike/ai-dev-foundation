import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalizeReviewEvidence,
  digestReviewBody,
  evaluateReviewerTargetStates,
} from "../tooling/review-evidence-state-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "abcdef1234567";
const OTHER_TARGET = "1111111222222";
const ACTOR_DATABASE_ID = "9001";
const ACTOR_NODE_ID = "BOT_actor_9001";
const RUN_AFTER = "2026-09-03T00:00:00.000Z";
const RESULT_AT = "2026-09-03T01:00:00.000Z";

function actor(
  login = "review-bot",
  { databaseId = ACTOR_DATABASE_ID, nodeId = ACTOR_NODE_ID } = {},
) {
  return {
    actor: login,
    actor_identity: { database_id: databaseId, node_id: nodeId },
  };
}

function completionBody(target = TARGET) {
  return `DONE\nReviewed commit: ${target}`;
}

function comment({
  id = 100,
  databaseId = String(id),
  nodeId = null,
  login = "review-bot",
  actorIdentity = { database_id: ACTOR_DATABASE_ID, node_id: ACTOR_NODE_ID },
  body = completionBody(),
  createdAt = RESULT_AT,
  updatedAt = RESULT_AT,
  reviewedSha = null,
  originalCommitSha = null,
  reviewId = null,
  ownershipFieldPresent = true,
  threadId = null,
} = {}) {
  return {
    id,
    database_id: databaseId,
    node_id: nodeId,
    actor: login,
    actor_identity: actorIdentity,
    body,
    created_at: createdAt,
    updated_at: updatedAt,
    reviewed_sha: reviewedSha,
    original_commit_sha: originalCommitSha,
    pull_request_review_id: reviewId,
    ownership_field_present: ownershipFieldPresent,
    thread_id: threadId,
  };
}

function review({
  id = 700,
  databaseId = String(id),
  login = "review-bot",
  body = "",
  state = "COMMENTED",
  reviewedSha = TARGET,
  createdAt = RESULT_AT,
  submittedAt = RESULT_AT,
} = {}) {
  return {
    id,
    database_id: databaseId,
    actor: login,
    actor_identity: { database_id: ACTOR_DATABASE_ID, node_id: ACTOR_NODE_ID },
    body,
    state,
    reviewed_sha: reviewedSha,
    created_at: createdAt,
    submitted_at: submittedAt,
  };
}

function evidence({
  conversation = [],
  submissions = [],
  inline = [],
  threads = [],
  statuses = {},
  generatedAt = "2026-09-03T02:00:00.000Z",
} = {}) {
  const surface = (items, fetchStatus = "fetched") => ({
    fetch_status: fetchStatus,
    count: items.length,
    items,
  });
  return {
    repo: "acme/review-fixtures",
    pull_number: 74,
    generated_at: generatedAt,
    pr_metadata: {
      fetch_status: "fetched",
      head_sha: TARGET,
      state: "open",
      updated_at: generatedAt,
    },
    surfaces: {
      conversation_comments: surface(
        conversation,
        statuses.conversation_comments ?? "fetched",
      ),
      review_submissions: surface(
        submissions,
        statuses.review_submissions ?? "fetched",
      ),
      inline_review_comments: surface(
        inline,
        statuses.inline_review_comments ?? "fetched",
      ),
      review_threads: {
        ...surface(threads, statuses.review_threads ?? "fetched"),
        unresolved_count: 0,
      },
    },
  };
}

function record({
  schema = "ai-dev-foundation/reviewer-capability-record@2",
  reviewer = {},
} = {}) {
  return {
    schema,
    reviewers: [
      {
        id: "reviewer-one",
        actors: ["review-bot"],
        actor_identities: [
          { database_id: ACTOR_DATABASE_ID, node_id: ACTOR_NODE_ID },
        ],
        completion_marker: {
          any_of: ["DONE"],
          target_pattern: "Reviewed commit:\\s*([0-9a-f]{7,40})",
        },
        rate_limit_marker: { any_of: ["RATE_LIMITED"] },
        failure_marker: { any_of: ["EXECUTION_FAILED"] },
        non_participation_marker: { any_of: ["DECLINED"] },
        in_flight_marker: { any_of: ["RUNNING"] },
        ...reviewer,
      },
    ],
  };
}

function stateFor(input, options = {}) {
  const result = evaluateReviewerTargetStates(input, {
    record: options.record ?? record(),
    reviewerId: "reviewer-one",
    target: options.target ?? TARGET,
    runAnchor: options.runAnchor ?? { after: RUN_AFTER, ids: [] },
  });
  return result.reviewer_states[0];
}

test("behavior fixture inventory names protocol classes without provider names", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(
        root,
        "test",
        "fixtures",
        "review-evidence",
        "behavior-classes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(fixture.schema, "ai-dev-foundation/review-evidence-fixtures@1");
  assert.equal(fixture.cases.length, 18);
  assert.ok(
    fixture.cases.every((name) => !/codex|claude|rabbit|provider/i.test(name)),
  );
});

test("REST and GraphQL representations with the same database ID form one canonical object", () => {
  const rest = comment({
    id: 501,
    databaseId: "501",
    body: completionBody(),
    originalCommitSha: TARGET,
  });
  const graphql = comment({
    id: "RC_node_501",
    databaseId: "501",
    nodeId: "RC_node_501",
    body: completionBody(),
    originalCommitSha: TARGET,
    threadId: "RT_node_501",
  });
  const snapshot = canonicalizeReviewEvidence(
    evidence({
      inline: [rest],
      threads: [{ id: "RT_node_501", comments: [graphql], is_resolved: false }],
    }),
  );
  const comments = snapshot.canonical_objects.filter(
    (object) => object.object_kind === "review_comment",
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0].identity.status, "stable");
  assert.equal(comments[0].identity.database_id, "501");
  assert.equal(comments[0].observations.length, 2);
  assert.equal(comments[0].provenance.length, 2);
  assert.equal(
    comments[0].current.body_digest,
    digestReviewBody(completionBody()),
  );
  assert.equal(
    stateFor(
      evidence({
        inline: [rest],
        threads: [
          { id: "RT_node_501", comments: [graphql], is_resolved: false },
        ],
      }),
    ).state,
    "completed@target",
  );
});

test("stable database/node ID conflict never merges and is marked ambiguous", () => {
  const snapshot = canonicalizeReviewEvidence(
    evidence({
      inline: [
        comment({ id: 502, databaseId: "502", nodeId: "RC_A" }),
        comment({ id: 503, databaseId: "502", nodeId: null }),
      ],
      threads: [
        {
          id: "RT_502",
          comments: [
            comment({ id: "RC_B", databaseId: "502", nodeId: "RC_B" }),
          ],
          is_resolved: false,
        },
      ],
    }),
  );
  const comments = snapshot.canonical_objects.filter(
    (object) => object.object_kind === "review_comment",
  );
  assert.equal(comments.length, 3);
  assert.ok(comments.every((object) => object.identity.status === "ambiguous"));
  assert.equal(
    stateFor(
      evidence({
        inline: [
          comment({ id: 502, databaseId: "502", nodeId: "RC_A" }),
          comment({ id: 503, databaseId: "502", nodeId: null }),
        ],
        threads: [
          {
            id: "RT_502",
            comments: [
              comment({ id: "RC_B", databaseId: "502", nodeId: "RC_B" }),
            ],
            is_resolved: false,
          },
        ],
      }),
    ).state,
    "unknown",
  );
});

test("a completion marker on a comment owned by a pending review is not positive", () => {
  const input = evidence({
    submissions: [
      review({ id: 703, databaseId: "703", state: "PENDING", body: "" }),
    ],
    inline: [
      comment({
        id: 704,
        databaseId: "704",
        reviewId: "703",
        originalCommitSha: TARGET,
      }),
    ],
  });
  const state = stateFor(input);
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("pending_review_owner"));
});

test("an explicitly standalone inline marker can complete without review ownership", () => {
  const state = stateFor(
    evidence({
      inline: [
        comment({
          id: 705,
          databaseId: "705",
          originalCommitSha: TARGET,
          reviewId: null,
          ownershipFieldPresent: true,
        }),
      ],
    }),
  );
  assert.equal(state.state, "completed@target");
  assert.equal(state.binding_status, "target-bound");
});

test("completion is surface-neutral for findingful and finding-free results", () => {
  const findingFree = stateFor(
    evidence({
      conversation: [
        comment({ id: 706, databaseId: "706", originalCommitSha: null }),
      ],
    }),
  );
  const findingful = stateFor(
    evidence({
      submissions: [
        review({
          id: 707,
          databaseId: "707",
          body: completionBody(),
          reviewedSha: TARGET,
        }),
      ],
    }),
  );
  assert.equal(findingFree.state, "completed@target");
  assert.equal(findingful.state, "completed@target");
});

test("stable original binding wins over moving context and a conflicting body marker", () => {
  const state = stateFor(
    evidence({
      inline: [
        comment({
          id: 708,
          databaseId: "708",
          reviewedSha: TARGET,
          originalCommitSha: OTHER_TARGET,
        }),
      ],
    }),
  );
  assert.equal(state.state, "not-bound");
  assert.equal(state.binding_status, "mismatch");
  assert.equal(state.fallback_eligible, false);
  assert.equal(state.effective_binding.basis, "comment.original_commit");
});

test("stable review ownership binding wins over body and moving target claims", () => {
  const state = stateFor(
    evidence({
      submissions: [
        review({
          id: 730,
          databaseId: "730",
          reviewedSha: TARGET,
        }),
      ],
      inline: [
        comment({
          id: 731,
          databaseId: "731",
          reviewId: "730",
          body: completionBody(OTHER_TARGET),
          reviewedSha: OTHER_TARGET,
          originalCommitSha: null,
        }),
      ],
    }),
  );
  assert.equal(state.state, "completed@target");
  assert.equal(state.effective_binding.basis, "review.owner.submitted_commit");
  assert.equal(state.effective_binding.target, TARGET);
});

test("an inline marker with unresolved ownership is not positive", () => {
  const state = stateFor(
    evidence({
      submissions: [review({ id: 733, databaseId: "733", state: "COMMENTED" })],
      inline: [
        comment({
          id: 732,
          databaseId: "732",
          reviewId: "733",
          originalCommitSha: TARGET,
          ownershipFieldPresent: false,
        }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("ownership_unresolved"));
});

test("the latest observed body is current and retains earlier revision provenance", () => {
  const oldBody = "RUNNING";
  const newBody = completionBody();
  const input = evidence({
    conversation: [
      comment({
        id: 709,
        databaseId: "709",
        body: oldBody,
        createdAt: "2026-09-03T00:05:00.000Z",
        updatedAt: "2026-09-03T00:10:00.000Z",
      }),
      comment({
        id: 709,
        databaseId: "709",
        body: newBody,
        createdAt: "2026-09-03T00:05:00.000Z",
        updatedAt: "2026-09-03T00:20:00.000Z",
      }),
    ],
  });
  const canonical = canonicalizeReviewEvidence(input);
  const object = canonical.canonical_objects.find(
    (candidate) => candidate.object_kind === "conversation_comment",
  );
  assert.equal(object.current.body, newBody);
  assert.equal(object.current.updated_at, "2026-09-03T00:20:00.000Z");
  assert.equal(object.current.body_digest, digestReviewBody(newBody));
  assert.equal(object.observations.length, 2);
  assert.ok(
    object.observations.some(
      (observation) =>
        observation.body === oldBody &&
        observation.body_digest === digestReviewBody(oldBody),
    ),
  );
  assert.equal(stateFor(input).state, "completed@target");
});

test("stable actor identity permits login drift across surfaces", () => {
  const input = evidence({
    inline: [
      comment({
        id: 710,
        databaseId: "710",
        login: "review-bot[bot]",
        originalCommitSha: TARGET,
      }),
    ],
    threads: [
      {
        id: "RT_710",
        comments: [
          comment({
            id: "RC_710",
            databaseId: "710",
            nodeId: "RC_710",
            login: "review-bot",
            originalCommitSha: TARGET,
          }),
        ],
        is_resolved: false,
      },
    ],
  });
  assert.equal(stateFor(input).state, "completed@target");
});

test("an unattributed actor cannot produce positive completion", () => {
  const input = evidence({
    inline: [
      comment({
        id: 711,
        databaseId: "711",
        login: null,
        actorIdentity: {},
        originalCommitSha: TARGET,
      }),
    ],
  });
  const state = stateFor(input);
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("actor_unattributed"));
});

test("intermediate text is unknown while explicit in-flight evidence is non-terminal", () => {
  const intermediate = stateFor(
    evidence({
      conversation: [
        comment({
          id: 712,
          databaseId: "712",
          body: "Environment information follows.",
        }),
      ],
    }),
  );
  const inFlight = stateFor(
    evidence({
      conversation: [comment({ id: 713, databaseId: "713", body: "RUNNING" })],
    }),
  );
  assert.equal(intermediate.state, "unknown");
  assert.equal(intermediate.terminal, false);
  assert.equal(inFlight.state, "in-flight");
  assert.equal(inFlight.terminal, false);
  assert.equal(inFlight.fallback_eligible, false);
});

test("conflicting completion and in-flight signals do not become terminal by order", () => {
  const state = stateFor(
    evidence({
      conversation: [
        comment({
          id: 734,
          databaseId: "734",
          body: `${completionBody()}\nRUNNING`,
        }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.equal(state.terminal, false);
  assert.ok(state.reason_codes.includes("conflicting_signals"));
});

test("explicit terminal negative evidence is fallback eligible only with complete acquisition", () => {
  const complete = stateFor(
    evidence({
      conversation: [
        comment({ id: 714, databaseId: "714", body: "RATE_LIMITED" }),
      ],
    }),
  );
  const incomplete = stateFor(
    evidence({
      conversation: [
        comment({ id: 715, databaseId: "715", body: "RATE_LIMITED" }),
      ],
      statuses: { inline_review_comments: "partial" },
    }),
  );
  assert.equal(complete.state, "rate-limited");
  assert.equal(complete.terminal, true);
  assert.equal(complete.polarity, "negative");
  assert.equal(complete.fallback_eligible, true);
  assert.equal(incomplete.state, "rate-limited");
  assert.equal(incomplete.fallback_eligible, false);
  assert.ok(
    incomplete.reason_codes.includes("fallback_requires_complete_coverage"),
  );
});

test("incomplete acquisition cannot produce completed@target", () => {
  const state = stateFor(
    evidence({
      conversation: [
        comment({ id: 716, databaseId: "716", originalCommitSha: TARGET }),
      ],
      statuses: { review_threads: "partial" },
    }),
  );
  assert.equal(state.state, "unknown");
  assert.equal(state.binding_status, "unknown");
  assert.equal(state.fallback_eligible, false);
  assert.ok(state.reason_codes.includes("coverage_incomplete"));
});

test("empty acquisition is indeterminate rather than an execution failure", () => {
  const state = stateFor(evidence());
  assert.equal(state.state, "unknown");
  assert.equal(state.terminal, false);
  assert.equal(state.polarity, "indeterminate");
  assert.equal(state.fallback_eligible, false);
  assert.ok(state.reason_codes.includes("no_current_run_signal"));
});

test("a structurally bound completion for another target is not-bound", () => {
  const state = stateFor(
    evidence({
      submissions: [
        review({
          id: 717,
          databaseId: "717",
          body: completionBody(TARGET),
          reviewedSha: OTHER_TARGET,
        }),
      ],
    }),
  );
  assert.equal(state.state, "not-bound");
  assert.equal(state.terminal, true);
  assert.equal(state.polarity, "positive");
  assert.equal(state.fallback_eligible, false);
});

test("a conflict between two candidates at the strongest binding tier is ambiguous", () => {
  const input = evidence({
    submissions: [
      review({
        id: 729,
        databaseId: "729",
        body: completionBody(TARGET),
        reviewedSha: TARGET,
      }),
      review({
        id: 729,
        databaseId: "729",
        body: completionBody(TARGET),
        reviewedSha: OTHER_TARGET,
      }),
    ],
  });
  const state = stateFor(input);
  assert.equal(state.state, "unknown");
  assert.equal(state.binding_status, "ambiguous");
  assert.ok(state.reason_codes.includes("same_tier_target_conflict"));
});

test("canonical projection is invariant under surface and item order permutation", () => {
  const input = evidence({
    conversation: [
      comment({ id: 718, databaseId: "718", originalCommitSha: TARGET }),
    ],
    submissions: [
      review({
        id: 719,
        databaseId: "719",
        body: completionBody(),
        reviewedSha: TARGET,
      }),
    ],
    inline: [
      comment({ id: 720, databaseId: "720", originalCommitSha: TARGET }),
    ],
    threads: [
      {
        id: "RT_718",
        comments: [
          comment({
            id: "RC_718",
            databaseId: "718",
            nodeId: "RC_718",
            originalCommitSha: TARGET,
          }),
        ],
        is_resolved: true,
      },
    ],
  });
  const permuted = {
    ...input,
    surfaces: {
      ...input.surfaces,
      conversation_comments: {
        ...input.surfaces.conversation_comments,
        items: [...input.surfaces.conversation_comments.items].reverse(),
      },
      review_submissions: {
        ...input.surfaces.review_submissions,
        items: [...input.surfaces.review_submissions.items].reverse(),
      },
      inline_review_comments: {
        ...input.surfaces.inline_review_comments,
        items: [...input.surfaces.inline_review_comments.items].reverse(),
      },
      review_threads: {
        ...input.surfaces.review_threads,
        items: [...input.surfaces.review_threads.items].reverse(),
      },
    },
  };
  assert.deepEqual(
    canonicalizeReviewEvidence(input),
    canonicalizeReviewEvidence(permuted),
  );
  assert.deepEqual(stateFor(input), stateFor(permuted));
});

test("legacy @1 permits only exact-login, self-contained single-surface attribution", () => {
  const legacy = record({
    schema: "ai-dev-foundation/reviewer-capability-record@1",
    reviewer: { actor_identities: undefined },
  });
  const selfContained = stateFor(
    evidence({
      conversation: [
        comment({
          id: 721,
          databaseId: "721",
          login: "review-bot",
          actorIdentity: {},
          originalCommitSha: null,
        }),
      ],
    }),
    { record: legacy },
  );
  const drifted = stateFor(
    evidence({
      conversation: [
        comment({
          id: 722,
          databaseId: "722",
          login: "review-bot[bot]",
          actorIdentity: {},
          originalCommitSha: null,
        }),
      ],
    }),
    { record: legacy },
  );
  const crossSurface = stateFor(
    evidence({
      inline: [
        comment({
          id: 723,
          databaseId: "723",
          login: "review-bot",
          actorIdentity: {},
        }),
      ],
      threads: [
        {
          id: "RT_723",
          comments: [
            comment({
              id: "RC_723",
              databaseId: "723",
              nodeId: "RC_723",
              login: "review-bot[bot]",
              actorIdentity: {},
            }),
          ],
          is_resolved: false,
        },
      ],
    }),
    { record: legacy },
  );
  assert.equal(selfContained.state, "completed@target");
  assert.equal(drifted.state, "unknown");
  assert.equal(crossSurface.state, "unknown");
});

test("@2 actor database-ID-only and node-ID-only entries are sufficient", () => {
  const databaseOnlyRecord = record({
    reviewer: { actor_identities: [{ database_id: ACTOR_DATABASE_ID }] },
  });
  const nodeOnlyRecord = record({
    reviewer: { actor_identities: [{ node_id: ACTOR_NODE_ID }] },
  });
  assert.equal(
    stateFor(
      evidence({
        conversation: [
          comment({ id: 724, databaseId: "724", originalCommitSha: null }),
        ],
      }),
      { record: databaseOnlyRecord },
    ).state,
    "completed@target",
  );
  assert.equal(
    stateFor(
      evidence({
        conversation: [
          comment({ id: 725, databaseId: "725", originalCommitSha: null }),
        ],
      }),
      { record: nodeOnlyRecord },
    ).state,
    "completed@target",
  );
});

test("conflicting stable actor IDs make attribution ambiguous", () => {
  const input = evidence({
    inline: [
      comment({
        id: 726,
        databaseId: "726",
        actorIdentity: {
          database_id: ACTOR_DATABASE_ID,
          node_id: "BOT_actor_A",
        },
      }),
    ],
    threads: [
      {
        id: "RT_726",
        comments: [
          comment({
            id: "RC_726",
            databaseId: "726",
            nodeId: "RC_726",
            actorIdentity: {
              database_id: ACTOR_DATABASE_ID,
              node_id: "BOT_actor_B",
            },
          }),
        ],
        is_resolved: false,
      },
    ],
  });
  const state = stateFor(input);
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("actor_identity_conflict"));
});

test("moving binding alone is not promoted to a stable target binding", () => {
  const state = stateFor(
    evidence({
      inline: [
        comment({
          id: 727,
          databaseId: "727",
          body: "DONE",
          reviewedSha: TARGET,
          originalCommitSha: null,
        }),
      ],
    }),
  );
  assert.equal(state.state, "unknown");
  assert.ok(state.reason_codes.includes("moving_or_weak_binding_only"));
});

test("state output exposes deterministic lifecycle axes instead of prose", () => {
  const state = stateFor(
    evidence({
      inline: [
        comment({ id: 728, databaseId: "728", originalCommitSha: TARGET }),
      ],
    }),
  );
  assert.deepEqual(Object.keys(state).sort(), [
    "binding_status",
    "coverage",
    "effective_binding",
    "evidence",
    "fallback_eligible",
    "observed_signals",
    "polarity",
    "reason_codes",
    "reviewer",
    "state",
    "target",
    "terminal",
  ]);
  assert.equal(typeof state.terminal, "boolean");
  assert.equal(typeof state.fallback_eligible, "boolean");
});
