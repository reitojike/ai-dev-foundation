import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectReviewEvidence,
  formatHumanSummary,
  parseReviewEvidenceArgs,
} from "../tooling/review-evidence-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function jsonResponse(body, { status = 200, link } = {}) {
  const headers = link ? { link } : undefined;
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers,
  });
}

// Builds a fetch stub from an ordered list of { match(url, init), handler(url, init) }
// entries; the first matching entry produces the response. Throws loudly on
// an unmatched URL so a test with a missing route fails clearly instead of
// hanging on a real network call.
function createFetch(routes) {
  return async (url, init = {}) => {
    const href = typeof url === "string" ? url : url.toString();
    const route = routes.find((candidate) => candidate.match(href, init));
    if (!route)
      throw new Error(`No mock route for ${init.method ?? "GET"} ${href}`);
    return route.handler(href, init);
  };
}

function graphqlVariables(init) {
  return JSON.parse(init.body).variables;
}

const PR_META = {
  head: { sha: "abc1234" },
  state: "open",
  html_url: "https://github.com/octo/demo/pull/62",
  updated_at: "2026-08-27T00:00:00Z",
};

function prRoute(pr = PR_META) {
  return {
    match: (url, init) =>
      url.endsWith("/repos/octo/demo/pulls/62") &&
      (!init.method || init.method === "GET"),
    handler: () => jsonResponse(pr),
  };
}

function emptyListRoute(suffix) {
  return {
    match: (url) =>
      url.startsWith(`https://api.github.com/repos/octo/demo${suffix}`),
    handler: () => jsonResponse([]),
  };
}

function emptyReviewThreadsRoute() {
  return {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          },
        },
      }),
  };
}

function emptyCommitStatusRoute() {
  return {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/commits/abc1234/status",
      ),
    handler: () =>
      jsonResponse({ state: "success", total_count: 0, statuses: [] }),
  };
}

function emptyCheckRunsRoute() {
  return {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/commits/abc1234/check-runs",
      ),
    handler: () => jsonResponse({ total_count: 0, check_runs: [] }),
  };
}

function baseRoutes() {
  return [
    prRoute(),
    emptyListRoute("/issues/62/comments"),
    emptyListRoute("/pulls/62/reviews"),
    emptyListRoute("/pulls/62/comments"),
    emptyReviewThreadsRoute(),
    emptyCommitStatusRoute(),
    emptyCheckRunsRoute(),
  ];
}

test("collects a representative multi-surface snapshot with independent per-surface counts", async () => {
  const routes = [
    prRoute(),
    {
      match: (url) =>
        url.startsWith(
          "https://api.github.com/repos/octo/demo/issues/62/comments",
        ),
      handler: () =>
        jsonResponse([
          {
            id: 1,
            user: { login: "alice", type: "User" },
            created_at: "t1",
            updated_at: "t1",
            html_url: "loc1",
          },
        ]),
    },
    {
      match: (url) =>
        url.startsWith(
          "https://api.github.com/repos/octo/demo/pulls/62/reviews",
        ),
      handler: () =>
        jsonResponse([
          {
            id: 2,
            user: { login: "codex" },
            state: "APPROVED",
            commit_id: "abc1234",
            submitted_at: "t2",
            html_url: "loc2",
          },
        ]),
    },
    {
      match: (url) =>
        url.startsWith(
          "https://api.github.com/repos/octo/demo/pulls/62/comments",
        ),
      handler: () =>
        jsonResponse([
          {
            id: 3,
            user: { login: "codex" },
            path: "a.mjs",
            line: 5,
            commit_id: "abc1234",
            html_url: "loc3",
          },
        ]),
    },
    {
      match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
      handler: () =>
        jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "th1",
                      isResolved: true,
                      isOutdated: false,
                      path: "a.mjs",
                      line: 5,
                      comments: {
                        nodes: [
                          {
                            id: "c1",
                            author: { login: "codex" },
                            createdAt: "t3",
                            url: "loc4",
                            commit: { oid: "abc1234" },
                          },
                        ],
                      },
                    },
                    {
                      id: "th2",
                      isResolved: false,
                      isOutdated: false,
                      path: "b.mjs",
                      line: 9,
                      comments: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        }),
    },
    {
      match: (url) =>
        url.startsWith(
          "https://api.github.com/repos/octo/demo/commits/abc1234/status",
        ),
      handler: () =>
        jsonResponse({
          state: "success",
          total_count: 2,
          statuses: [{ context: "ci/build", state: "success" }],
        }),
    },
    {
      match: (url) =>
        url.startsWith(
          "https://api.github.com/repos/octo/demo/commits/abc1234/check-runs",
        ),
      handler: () =>
        jsonResponse({
          total_count: 1,
          check_runs: [
            { id: 9, name: "test", status: "completed", conclusion: "success" },
          ],
        }),
    },
  ];

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.pr_metadata.fetch_status, "fetched");
  assert.equal(result.pr_metadata.head_sha, "abc1234");
  assert.equal(result.fetch_failures, 0);

  assert.equal(result.surfaces.conversation_comments.fetch_status, "fetched");
  assert.equal(result.surfaces.conversation_comments.count, 1);

  assert.equal(result.surfaces.review_submissions.count, 1);
  assert.equal(
    result.surfaces.review_submissions.items[0].reviewed_sha,
    "abc1234",
  );

  assert.equal(result.surfaces.inline_review_comments.count, 1);
  assert.equal(
    result.surfaces.inline_review_comments.items[0].reviewed_sha,
    "abc1234",
  );

  assert.equal(result.surfaces.review_threads.count, 2);
  assert.equal(result.surfaces.review_threads.unresolved_count, 1);
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].reviewed_sha,
    "abc1234",
  );

  assert.equal(result.surfaces.commit_status.status.state, "success");
  assert.equal(result.surfaces.check_runs.count, 1);
});

test("a surface with genuinely zero items is reported as fetched(0), not conflated with the other surfaces", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/issues/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 1,
          user: { login: "alice" },
          created_at: "t",
          updated_at: "t",
          html_url: "loc",
        },
      ]),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.conversation_comments.count, 1);
  for (const key of [
    "review_submissions",
    "inline_review_comments",
    "check_runs",
  ]) {
    assert.equal(result.surfaces[key].fetch_status, "fetched");
    assert.equal(result.surfaces[key].count, 0);
  }
  assert.equal(result.surfaces.review_threads.fetch_status, "fetched");
  assert.equal(result.surfaces.review_threads.count, 0);
  assert.equal(result.surfaces.review_threads.unresolved_count, 0);
  assert.equal(result.fetch_failures, 0);
});

test("an inline-only fixture does not misreport the other surfaces as absent", async () => {
  const routes = baseRoutes();
  routes[3] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/pulls/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 1,
          user: { login: "codex" },
          path: "a.mjs",
          line: 1,
          commit_id: "abc1234",
          html_url: "loc",
        },
      ]),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.inline_review_comments.count, 1);
  assert.equal(result.surfaces.conversation_comments.count, 0);
  assert.equal(result.surfaces.review_submissions.count, 0);
});

test("a submission-only fixture does not misreport the other surfaces as absent", async () => {
  const routes = baseRoutes();
  routes[2] = {
    match: (url) =>
      url.startsWith("https://api.github.com/repos/octo/demo/pulls/62/reviews"),
    handler: () =>
      jsonResponse([
        {
          id: 1,
          user: { login: "codex" },
          state: "COMMENTED",
          commit_id: "abc1234",
          html_url: "loc",
        },
      ]),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.review_submissions.count, 1);
  assert.equal(result.surfaces.conversation_comments.count, 0);
  assert.equal(result.surfaces.inline_review_comments.count, 0);
});

test("pagination is followed to completion, not truncated to the first page", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100",
    handler: () =>
      jsonResponse([{ id: 1, user: { login: "a" }, html_url: "loc1" }], {
        link: '<https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100&page=2>; rel="next"',
      }),
  };
  routes.splice(2, 0, {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100&page=2",
    handler: () =>
      jsonResponse([{ id: 2, user: { login: "b" }, html_url: "loc2" }]),
  });

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.conversation_comments.fetch_status, "fetched");
  assert.equal(result.surfaces.conversation_comments.count, 2);
  assert.equal(result.surfaces.conversation_comments.pages_fetched, 2);
});

test("review thread GraphQL pagination across pages accumulates the full unresolved count", async () => {
  const routes = baseRoutes();
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: (url, init) => {
      const { cursor } = graphqlVariables(init);
      if (!cursor) {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
                  nodes: [
                    {
                      id: "th1",
                      isResolved: false,
                      isOutdated: false,
                      path: "a.mjs",
                      line: 1,
                      comments: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      assert.equal(cursor, "cursor-2");
      return jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "th2",
                    isResolved: true,
                    isOutdated: false,
                    path: "b.mjs",
                    line: 2,
                    comments: { nodes: [] },
                  },
                ],
              },
            },
          },
        },
      });
    },
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.review_threads.fetch_status, "fetched");
  assert.equal(result.surfaces.review_threads.count, 2);
  assert.equal(result.surfaces.review_threads.unresolved_count, 1);
});

test("a thread with more than one page of its own comments is paginated to completion, not silently capped", async () => {
  const routes = baseRoutes();
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: (url, init) => {
      const variables = graphqlVariables(init);
      if ("id" in variables) {
        assert.equal(variables.id, "th1");
        assert.equal(variables.cursor, "comment-cursor-2");
        return jsonResponse({
          data: {
            node: {
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "c2",
                    author: { login: "b" },
                    createdAt: "t2",
                    url: "loc2",
                    commit: { oid: "abc1234" },
                  },
                ],
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "th1",
                    isResolved: false,
                    isOutdated: false,
                    path: "a.mjs",
                    line: 1,
                    comments: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "comment-cursor-2",
                      },
                      nodes: [
                        {
                          id: "c1",
                          author: { login: "a" },
                          createdAt: "t1",
                          url: "loc1",
                          commit: { oid: "abc1234" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      });
    },
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.review_threads.fetch_status, "fetched");
  assert.equal(result.surfaces.review_threads.items[0].comments.length, 2);
  assert.deepEqual(
    result.surfaces.review_threads.items[0].comments.map(
      (comment) => comment.id,
    ),
    ["c1", "c2"],
  );
});

test("a failure while paginating a thread's own comments downgrades review_threads to partial, not a silent fetched", async () => {
  const routes = baseRoutes();
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: (url, init) => {
      const variables = graphqlVariables(init);
      if ("id" in variables) {
        return jsonResponse(
          { errors: [{ message: "server error" }] },
          { status: 500 },
        );
      }
      return jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "th1",
                    isResolved: false,
                    isOutdated: false,
                    path: "a.mjs",
                    line: 1,
                    comments: {
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: "comment-cursor-2",
                      },
                      nodes: [
                        {
                          id: "c1",
                          author: { login: "a" },
                          createdAt: "t1",
                          url: "loc1",
                          commit: { oid: "abc1234" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      });
    },
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.review_threads.fetch_status, "partial");
  assert.ok(result.surfaces.review_threads.failure);
  // The thread itself, and what comments were fetched before the failure, are still reported.
  assert.equal(result.surfaces.review_threads.count, 1);
});

test("a 200 OK GraphQL response with an empty body is reported as a failure, not a crash", async () => {
  const routes = baseRoutes();
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: () => jsonResponse(null),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.review_threads.fetch_status, "failed");
  assert.equal(result.surfaces.review_threads.count, null);
  assert.ok(result.surfaces.review_threads.failure);
});

test("a surface fetch failure is reported as failed with a null count, never a false zero", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/issues/62/comments",
      ),
    handler: () =>
      jsonResponse({ message: "API rate limit exceeded" }, { status: 403 }),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.conversation_comments.fetch_status, "failed");
  assert.equal(result.surfaces.conversation_comments.count, null);
  assert.equal(result.surfaces.conversation_comments.failure.status, 403);
  assert.match(
    result.surfaces.conversation_comments.failure.message,
    /rate limit/,
  );
  // Other surfaces must still be attempted independently.
  assert.equal(result.surfaces.review_submissions.fetch_status, "fetched");
  assert.equal(result.fetch_failures, 1);
});

test("a mid-pagination failure is reported as partial, not silently truncated to a complete fetch", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100",
    handler: () =>
      jsonResponse([{ id: 1, user: { login: "a" }, html_url: "loc1" }], {
        link: '<https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100&page=2>; rel="next"',
      }),
  };
  routes.splice(2, 0, {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/issues/62/comments?per_page=100&page=2",
    handler: () => jsonResponse({ message: "server error" }, { status: 502 }),
  });

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.conversation_comments.fetch_status, "partial");
  assert.equal(result.surfaces.conversation_comments.count, 1);
  assert.equal(result.surfaces.conversation_comments.items.length, 1);
  assert.equal(result.fetch_failures, 1);
});

test("the combined commit status's own statuses list is paginated to completion, not capped at the first page", async () => {
  const routes = baseRoutes();
  routes[5] = {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100",
    handler: () =>
      jsonResponse(
        {
          state: "success",
          total_count: 2,
          statuses: [{ context: "ci/a", state: "success" }],
        },
        {
          link: '<https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100&page=2>; rel="next"',
        },
      ),
  };
  routes.splice(6, 0, {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100&page=2",
    handler: () =>
      jsonResponse({
        state: "success",
        total_count: 2,
        statuses: [{ context: "ci/b", state: "success" }],
      }),
  });

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.commit_status.fetch_status, "fetched");
  assert.equal(result.surfaces.commit_status.status.statuses.length, 2);
  assert.deepEqual(
    result.surfaces.commit_status.status.statuses.map(
      (status) => status.context,
    ),
    ["ci/a", "ci/b"],
  );
});

test("a mid-pagination failure on the combined commit status is reported as partial, not a silent fetched", async () => {
  const routes = baseRoutes();
  routes[5] = {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100",
    handler: () =>
      jsonResponse(
        {
          state: "success",
          total_count: 2,
          statuses: [{ context: "ci/a", state: "success" }],
        },
        {
          link: '<https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100&page=2>; rel="next"',
        },
      ),
  };
  routes.splice(6, 0, {
    match: (url) =>
      url ===
      "https://api.github.com/repos/octo/demo/commits/abc1234/status?per_page=100&page=2",
    handler: () => jsonResponse({ message: "server error" }, { status: 502 }),
  });

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.surfaces.commit_status.fetch_status, "partial");
  assert.equal(result.surfaces.commit_status.status.statuses.length, 1);
  assert.ok(result.surfaces.commit_status.failure);
  assert.equal(result.fetch_failures, 1);
});

// Issue #62: a status's `description` is the field that carries a reviewer's
// positive non-participation declaration (e.g. a "Review skipped: automatic
// reviews are disabled" status). Dropping it made a declined reviewer
// indistinguishable from an ordinary green status.
test("a status's description (e.g. a declined-reviewer signal) is preserved, not dropped", async () => {
  const routes = baseRoutes();
  routes[5] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/commits/abc1234/status",
      ),
    handler: () =>
      jsonResponse({
        state: "success",
        total_count: 1,
        statuses: [
          {
            context: "CodeRabbit",
            state: "success",
            description: "Review skipped: automatic reviews are disabled",
          },
        ],
      }),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(
    result.surfaces.commit_status.status.statuses[0].description,
    "Review skipped: automatic reviews are disabled",
  );
});

// Issue #62: without the raw body, an agent using only this tool's --json
// output cannot see what a reviewer actually said
// (completion markers, finding text) and would have to re-fetch every
// comment individually — defeating the point of a single fresh snapshot.
test("comment/review body text is preserved across every comment-shaped surface, not discarded", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/issues/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 1,
          user: { login: "a" },
          html_url: "loc1",
          body: "conversation body text",
        },
      ]),
  };
  routes[2] = {
    match: (url) =>
      url.startsWith("https://api.github.com/repos/octo/demo/pulls/62/reviews"),
    handler: () =>
      jsonResponse([
        {
          id: 2,
          user: { login: "a" },
          state: "APPROVED",
          html_url: "loc2",
          body: "review submission body text",
        },
      ]),
  };
  routes[3] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/pulls/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 3,
          user: { login: "a" },
          path: "a.mjs",
          line: 1,
          html_url: "loc3",
          body: "inline comment body text",
        },
      ]),
  };
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "th1",
                    isResolved: false,
                    isOutdated: false,
                    path: "a.mjs",
                    line: 1,
                    comments: {
                      nodes: [
                        {
                          id: "c1",
                          author: { login: "a" },
                          url: "loc4",
                          body: "thread comment body text",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(
    result.surfaces.conversation_comments.items[0].body,
    "conversation body text",
  );
  assert.equal(
    result.surfaces.review_submissions.items[0].body,
    "review submission body text",
  );
  assert.equal(
    result.surfaces.inline_review_comments.items[0].body,
    "inline comment body text",
  );
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].body,
    "thread comment body text",
  );
});

test("normalization retains stable object/actor identities, revision, ownership, and thread relation fields", async () => {
  const routes = baseRoutes();
  routes[1] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/issues/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 81,
          user: {
            id: 901,
            node_id: "U_node_901",
            login: "review-bot[bot]",
            type: "Bot",
          },
          created_at: "2026-09-03T00:01:00Z",
          updated_at: "2026-09-03T00:02:00Z",
          html_url: "conversation-81",
          body: "body-81",
        },
      ]),
  };
  routes[2] = {
    match: (url) =>
      url.startsWith("https://api.github.com/repos/octo/demo/pulls/62/reviews"),
    handler: () =>
      jsonResponse([
        {
          id: 91,
          user: { id: 901, node_id: "U_node_901", login: "review-bot" },
          state: "COMMENTED",
          commit_id: "abc1234",
          submitted_at: "2026-09-03T00:03:00Z",
          html_url: "review-91",
        },
      ]),
  };
  routes[3] = {
    match: (url) =>
      url.startsWith(
        "https://api.github.com/repos/octo/demo/pulls/62/comments",
      ),
    handler: () =>
      jsonResponse([
        {
          id: 101,
          user: { id: 901, node_id: "U_node_901", login: "review-bot" },
          path: "a.mjs",
          line: 4,
          commit_id: "abc1234",
          original_commit_id: "old1234",
          pull_request_review_id: 91,
          in_reply_to_id: 99,
          created_at: "2026-09-03T00:04:00Z",
          updated_at: "2026-09-03T00:05:00Z",
          html_url: "inline-101",
          body: "body-101",
        },
      ]),
  };
  routes[4] = {
    match: (url, init) => url.endsWith("/graphql") && init.method === "POST",
    handler: () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "RT_201",
                    isResolved: false,
                    isOutdated: false,
                    path: "a.mjs",
                    line: 4,
                    comments: {
                      nodes: [
                        {
                          id: "RC_201",
                          databaseId: 101,
                          url: "graphql-201",
                          createdAt: "2026-09-03T00:04:00Z",
                          updatedAt: "2026-09-03T00:06:00Z",
                          originalCommit: { oid: "old1234" },
                          author: {
                            __typename: "Bot",
                            id: "U_node_901",
                            databaseId: 901,
                            login: "review-bot",
                          },
                          commit: { oid: "abc1234" },
                          pullRequestReview: {
                            id: "PR_review_91",
                            databaseId: 91,
                          },
                          body: "body-101",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });
  assert.equal(result.surfaces.conversation_comments.items[0].database_id, 81);
  assert.deepEqual(
    result.surfaces.conversation_comments.items[0].actor_identity,
    { database_id: 901, node_id: "U_node_901" },
  );
  assert.equal(result.surfaces.review_submissions.items[0].database_id, 91);
  assert.equal(
    result.surfaces.inline_review_comments.items[0].pull_request_review_id,
    91,
  );
  assert.equal(
    result.surfaces.inline_review_comments.items[0].ownership_field_present,
    true,
  );
  assert.equal(
    result.surfaces.inline_review_comments.items[0].original_commit_sha,
    "old1234",
  );
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].database_id,
    101,
  );
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].review_id,
    91,
  );
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].updated_at,
    "2026-09-03T00:06:00Z",
  );
  assert.equal(
    result.surfaces.review_threads.items[0].comments[0].thread_id,
    "RT_201",
  );
});

test("a PR-metadata fetch failure does not crash the run and marks head-dependent surfaces not_applicable", async () => {
  const routes = baseRoutes();
  routes[0] = {
    match: (url) => url.endsWith("/repos/octo/demo/pulls/62"),
    handler: () => jsonResponse({ message: "Not Found" }, { status: 404 }),
  };

  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(routes),
  });

  assert.equal(result.pr_metadata.fetch_status, "failed");
  assert.equal(result.pr_metadata.failure.status, 404);
  assert.equal(result.surfaces.commit_status.fetch_status, "not_applicable");
  assert.equal(result.surfaces.check_runs.fetch_status, "not_applicable");
  // Surfaces that don't depend on head SHA are still attempted.
  assert.equal(result.surfaces.conversation_comments.fetch_status, "fetched");
  assert.equal(result.fetch_failures, 1);
});

test("formatHumanSummary renders a deterministic snapshot summary", async () => {
  const result = await collectReviewEvidence({
    owner: "octo",
    repo: "demo",
    pullNumber: 62,
    token: "t",
    fetchImpl: createFetch(baseRoutes()),
  });
  result.generated_at = "2026-08-27T00:00:00.000Z";

  const text = formatHumanSummary(result);

  assert.match(text, /^PR #62 review evidence snapshot \(octo\/demo\)$/m);
  assert.match(text, /^Head: abc1234 \(state: open\)$/m);
  assert.match(text, /^Conversation comments: fetched \(0\)$/m);
  assert.match(text, /^Review threads: fetched \(0\) — unresolved: 0$/m);
  assert.match(text, /^Fetch failures: 0$/m);
});

test("parseReviewEvidenceArgs parses --repo/--pr/--json and rejects malformed input", () => {
  assert.deepEqual(
    parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "62"]),
    { json: false, repo: "octo/demo", pr: "62" },
  );
  assert.deepEqual(
    parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "62", "--json"]),
    {
      json: true,
      repo: "octo/demo",
      pr: "62",
    },
  );
  assert.deepEqual(
    parseReviewEvidenceArgs([
      "--repo",
      "octo/demo",
      "--pr",
      "62",
      "--target-sha",
      "abc1234",
      "--record",
      "record.json",
      "--run-after",
      "2026-09-03T00:00:00Z",
      "--run-anchor-id",
      "anchor-1",
      "--reviewer",
      "r1",
    ]),
    {
      json: false,
      repo: "octo/demo",
      pr: "62",
      targetSha: "abc1234",
      recordPath: "record.json",
      runAfter: "2026-09-03T00:00:00Z",
      runAnchorId: "anchor-1",
      reviewerId: "r1",
    },
  );
  assert.throws(() => parseReviewEvidenceArgs(["--pr", "62"]), /Usage:/);
  assert.throws(
    () => parseReviewEvidenceArgs(["--repo", "octo/demo"]),
    /Usage:/,
  );
  assert.throws(
    () =>
      parseReviewEvidenceArgs(["--repo", "octo/demo", "--pr", "not-a-number"]),
    /Usage:/,
  );
  assert.throws(
    () =>
      parseReviewEvidenceArgs([
        "--repo",
        "octo/demo",
        "--pr",
        "62",
        "--record",
        "record.json",
      ]),
    /--target-sha/,
  );
  assert.throws(
    () =>
      parseReviewEvidenceArgs([
        "--repo",
        "octo/demo",
        "--pr",
        "62",
        "--target-sha",
        "abc1234",
      ]),
    /--run-after|--run-anchor-id/,
  );
  assert.throws(
    () =>
      parseReviewEvidenceArgs([
        "--repo",
        "octo/demo",
        "--pr",
        "62",
        "--target-sha",
        "abc1234",
        "--run-after",
        "not-a-timestamp",
      ]),
    /ISO-8601/,
  );
});

// Issue #62 boundary: this helper is mechanical acquisition only. It must
// never grow completion/Validity/triage/merge-ready judgment logic — those
// stay owned by policy/core.md's Review Protocol and the review skills.
test("the helper's source stays free of Review Protocol judgment vocabulary", async () => {
  const forbidden = [
    "merge-ready",
    "merge_ready",
    "validity",
    "triage",
    "false-positive",
    "needs-verification",
    "technical-dispute",
    "intent-question",
    "finding_count",
  ];
  for (const file of [
    "tooling/review-evidence-lib.mjs",
    "tooling/review-evidence.mjs",
  ]) {
    const source = (
      await readFile(path.join(root, file), "utf8")
    ).toLowerCase();
    for (const term of forbidden) {
      assert.ok(
        !source.includes(term),
        `${file} must not contain judgment vocabulary "${term}"`,
      );
    }
  }
});
