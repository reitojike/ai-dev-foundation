// Issue #62: deterministic mechanical acquisition of GitHub durable review
// surfaces for a single PR snapshot. This module does not decide whether a
// review is complete, whether a reviewed target is acceptable, how to
// categorize a finding, or whether the PR is ready to merge — it only
// fetches, paginates, and normalizes what each surface returned. Those
// semantic judgments stay in policy/core.md's Review Protocol and the
// review skills; this file must not encode them.

const GITHUB_API_ROOT = "https://api.github.com";

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

function restHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-dev-foundation-review-evidence",
  };
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function readJsonBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function failureFromResponse(response, body) {
  const message = body && typeof body === "object" && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
  return { status: response.status, message };
}

// Fetches one REST page. Throws an object with { failure } on non-2xx so
// callers can distinguish "no page fetched yet" (failed) from "some pages
// already fetched, this one broke" (partial) without losing prior items.
async function fetchRestPage(fetchImpl, token, url) {
  const response = await fetchImpl(url, { headers: restHeaders(token) });
  const body = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error("REST page fetch failed");
    error.failure = failureFromResponse(response, body);
    throw error;
  }
  return { body, nextUrl: parseNextLink(response.headers.get("link")) };
}

// Generic paginated REST list surface. `extractItems` pulls the array out of
// a page body (bare array for most list endpoints, a named field for others
// like check-runs). Pagination that fails after collecting >=1 page is
// reported as "partial" (count reflects only what was fetched, not the
// surface's true total) rather than silently truncated to "fetched".
export async function fetchPaginatedSurface(fetchImpl, token, initialUrl, extractItems = (body) => (Array.isArray(body) ? body : [])) {
  let url = initialUrl;
  let items = [];
  let pages = 0;
  while (url) {
    let page;
    try {
      page = await fetchRestPage(fetchImpl, token, url);
    } catch (error) {
      return {
        fetch_status: pages === 0 ? "failed" : "partial",
        count: pages === 0 ? null : items.length,
        pages_fetched: pages,
        items,
        failure: error.failure ?? { status: null, message: error.message },
      };
    }
    pages += 1;
    items = items.concat(extractItems(page.body));
    url = page.nextUrl;
  }
  return { fetch_status: "fetched", count: items.length, pages_fetched: pages, items, failure: null };
}

// The combined-status endpoint's `statuses` array is itself paginated (one
// entry per context, which can exceed a single page on a commit with many
// status contexts). This follows it to completion via fetchPaginatedSurface
// like every other list surface, while separately capturing the page-level
// `state`/`total_count` fields that aren't part of the paginated array.
export async function fetchCombinedStatusSurface(fetchImpl, token, url) {
  const summary = { state: null, total_count: null };
  const result = await fetchPaginatedSurface(fetchImpl, token, url, (body) => {
    if (body && typeof body === "object") {
      if ("state" in body) summary.state = body.state ?? null;
      if ("total_count" in body) summary.total_count = body.total_count ?? null;
    }
    return body?.statuses ?? [];
  });
  return { ...result, state: summary.state, total_count: summary.total_count };
}

async function fetchGraphQL(fetchImpl, token, query, variables) {
  const response = await fetchImpl(`${GITHUB_API_ROOT}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ai-dev-foundation-review-evidence",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await readJsonBody(response);
  if (!response.ok) {
    const error = new Error("GraphQL request failed");
    error.failure = failureFromResponse(response, body);
    throw error;
  }
  if (body?.errors?.length) {
    const error = new Error("GraphQL response contained errors");
    error.failure = { status: null, message: body.errors.map((graphqlError) => graphqlError.message).join("; ") };
    throw error;
  }
  return body?.data ?? null;
}

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          comments(first: 50) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              databaseId
              url
              createdAt
              updatedAt
              author { login databaseId id }
              commit { oid }
              originalCommit { oid }
              pullRequestReview {
                databaseId
                id
                state
                submittedAt
                commit { oid }
              }
              body
            }
          }
        }
      }
    }
  }
}`;

const THREAD_COMMENTS_QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          databaseId
          url
          createdAt
          updatedAt
          author { login databaseId id }
          commit { oid }
          originalCommit { oid }
          pullRequestReview {
            databaseId
            id
            state
            submittedAt
            commit { oid }
          }
          body
        }
      }
    }
  }
}`;

// A thread's own `comments` connection can exceed the first page fetched by
// REVIEW_THREADS_QUERY (>50 replies on one thread). This follows that
// specific thread's comments to completion so review_threads can only ever
// report fetch_status "fetched" when every thread's comment list is
// genuinely complete, not just its first 50.
async function completeThreadComments(fetchImpl, token, threadId, firstPage) {
  let comments = firstPage?.nodes ?? [];
  let pageInfo = firstPage?.pageInfo;
  while (pageInfo?.hasNextPage) {
    const data = await fetchGraphQL(fetchImpl, token, THREAD_COMMENTS_QUERY, { id: threadId, cursor: pageInfo.endCursor });
    const connection = data?.node?.comments;
    if (!connection) throw new Error("thread comments connection missing from GraphQL response");
    comments = comments.concat(connection.nodes ?? []);
    pageInfo = connection.pageInfo;
  }
  return comments;
}

// Review-thread comments are fetched separately from the REST surfaces. The
// thread is an acquisition envelope; only its child comments enter the
// canonical review_comment projection.
export async function fetchReviewThreadsSurface(fetchImpl, token, owner, repo, pullNumber) {
  let cursor = null;
  let nodes = [];
  let pages = 0;
  for (;;) {
    let data;
    try {
      data = await fetchGraphQL(fetchImpl, token, REVIEW_THREADS_QUERY, { owner, repo, number: pullNumber, cursor });
    } catch (error) {
      return {
        fetch_status: pages === 0 ? "failed" : "partial",
        count: pages === 0 ? null : nodes.length,
        pages_fetched: pages,
        items: nodes,
        failure: error.failure ?? { status: null, message: error.message },
      };
    }
    pages += 1;
    const connection = data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      return {
        fetch_status: pages === 1 ? "failed" : "partial",
        count: pages === 1 ? null : nodes.length,
        pages_fetched: pages,
        items: nodes,
        failure: { status: null, message: "reviewThreads connection missing from GraphQL response (PR/repo may not exist)" },
      };
    }
    nodes = nodes.concat(connection.nodes ?? []);
    if (connection.pageInfo?.hasNextPage) {
      cursor = connection.pageInfo.endCursor;
    } else {
      break;
    }
  }
  let threadCommentsFailure = null;
  for (const node of nodes) {
    if (!node.comments?.pageInfo?.hasNextPage) continue;
    try {
      node.comments = { nodes: await completeThreadComments(fetchImpl, token, node.id, node.comments) };
    } catch (error) {
      threadCommentsFailure = error.failure ?? { status: null, message: error.message };
      break;
    }
  }

  if (threadCommentsFailure) {
    return {
      fetch_status: "partial",
      count: nodes.length,
      pages_fetched: pages,
      items: nodes,
      failure: threadCommentsFailure,
    };
  }
  return { fetch_status: "fetched", count: nodes.length, pages_fetched: pages, items: nodes, failure: null };
}

function normalizeConversationComment(item) {
  return {
    id: item.id,
    actor: item.user?.login ?? null,
    actor_type: item.user?.type ?? null,
    actor_database_id: item.user?.id ?? null,
    actor_node_id: item.user?.node_id ?? null,
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
    locator: item.html_url ?? null,
    body: item.body ?? null,
  };
}

function normalizeReviewSubmission(item) {
  return {
    id: item.id,
    actor: item.user?.login ?? null,
    actor_type: item.user?.type ?? null,
    actor_database_id: item.user?.id ?? null,
    actor_node_id: item.user?.node_id ?? null,
    state: item.state ?? null,
    reviewed_sha: item.commit_id ?? null,
    submitted_at: item.submitted_at ?? null,
    locator: item.html_url ?? null,
    body: item.body ?? null,
  };
}

function normalizeInlineReviewComment(item) {
  return {
    id: item.id,
    actor: item.user?.login ?? null,
    actor_type: item.user?.type ?? null,
    actor_database_id: item.user?.id ?? null,
    actor_node_id: item.user?.node_id ?? null,
    path: item.path ?? null,
    line: item.line ?? item.original_line ?? null,
    reviewed_sha: item.commit_id ?? null,
    original_commit_sha: item.original_commit_id ?? null,
    review_id: item.pull_request_review_id ?? null,
    review_node_id: item.pull_request_review_node_id ?? null,
    ownership_field_present: true,
    in_reply_to_id: item.in_reply_to_id ?? null,
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
    locator: item.html_url ?? null,
    body: item.body ?? null,
  };
}

function normalizeReviewThread(node) {
  return {
    id: node.id ?? null,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id ?? null,
      database_id: comment.databaseId ?? null,
      node_id: comment.id ?? null,
      actor: comment.author?.login ?? null,
      actor_database_id: comment.author?.databaseId ?? null,
      actor_node_id: comment.author?.id ?? null,
      created_at: comment.createdAt ?? null,
      updated_at: comment.updatedAt ?? null,
      reviewed_sha: comment.commit?.oid ?? null,
      original_commit_sha: comment.originalCommit?.oid ?? null,
      review_id: comment.pullRequestReview?.databaseId ?? null,
      review_node_id: comment.pullRequestReview?.id ?? null,
      owner_state: comment.pullRequestReview?.state ?? null,
      owner_reviewed_sha: comment.pullRequestReview?.commit?.oid ?? null,
      ownership_field_present: true,
      state: comment.pullRequestReview?.state ?? null,
      locator: comment.url ?? null,
      body: comment.body ?? null,
    })),
  };
}

// Keeps only name/status/conclusion/timestamps/locator. Does not capture
// output.summary, output.text, or line-level annotations — a reviewer that
// posts findings only in those fields is not represented here, and a caller
// needing that content must fetch it separately (README "Review evidence
// helper" documents this as a known coverage limit).
function normalizeCheckRun(item) {
  return {
    id: item.id,
    name: item.name ?? null,
    status: item.status ?? null,
    conclusion: item.conclusion ?? null,
    started_at: item.started_at ?? null,
    completed_at: item.completed_at ?? null,
    locator: item.html_url ?? null,
  };
}

function normalizeStatus(status) {
  return {
    context: status.context ?? null,
    state: status.state ?? null,
    description: status.description ?? null,
    target_url: status.target_url ?? null,
    created_at: status.created_at ?? null,
    updated_at: status.updated_at ?? null,
  };
}

function notApplicableSurface(note) {
  return { fetch_status: "not_applicable", count: null, pages_fetched: 0, items: [], failure: null, note };
}

// Collects a single PR's durable GitHub review-evidence surfaces: PR
// metadata/head SHA, Conversation comments, review submissions, inline
// review comments, review-thread comments, combined commit
// status, and check runs. Every surface reports its own fetch_status
// (fetched / partial / failed / not_applicable) and count independently —
// a failure on one surface never becomes a 0 on another, and a 0 count is
// only ever reported when the surface actually completed a fetch.
export async function collectReviewEvidence({ owner, repo, pullNumber, token, fetchImpl = defaultFetch }) {
  const restBase = `${GITHUB_API_ROOT}/repos/${owner}/${repo}`;

  let prBody = null;
  let prMetadataFailure = null;
  try {
    const page = await fetchRestPage(fetchImpl, token, `${restBase}/pulls/${pullNumber}`);
    prBody = page.body;
  } catch (error) {
    prMetadataFailure = error.failure ?? { status: null, message: error.message };
  }
  const headSha = prBody?.head?.sha ?? null;

  const [conversationComments, reviewSubmissions, inlineReviewComments, reviewThreads] = await Promise.all([
    fetchPaginatedSurface(fetchImpl, token, `${restBase}/issues/${pullNumber}/comments?per_page=100`),
    fetchPaginatedSurface(fetchImpl, token, `${restBase}/pulls/${pullNumber}/reviews?per_page=100`),
    fetchPaginatedSurface(fetchImpl, token, `${restBase}/pulls/${pullNumber}/comments?per_page=100`),
    fetchReviewThreadsSurface(fetchImpl, token, owner, repo, pullNumber),
  ]);

  // commit_status/check_runs are fetched for this snapshot's headSha only —
  // GitHub's status/check-runs endpoints are per-commit, with no "all
  // commits in this PR" equivalent. A reviewer that left status/check
  // evidence only on an earlier (ancestor) SHA is not represented here; a
  // caller needing that must fetch it separately for that SHA.
  //
  // commit_status uses the combined-status endpoint, which GitHub defines
  // as the *latest* status per context — an earlier status on the same
  // (headSha, context) pair that a later status superseded is not
  // recoverable from this surface, and fetch_status still reports "fetched"
  // (this is a known coverage gap, not a fetch failure; see README).
  let commitStatus;
  let checkRuns;
  if (headSha) {
    [commitStatus, checkRuns] = await Promise.all([
      fetchCombinedStatusSurface(fetchImpl, token, `${restBase}/commits/${headSha}/status?per_page=100`),
      fetchPaginatedSurface(
        fetchImpl,
        token,
        `${restBase}/commits/${headSha}/check-runs?per_page=100`,
        (body) => body?.check_runs ?? [],
      ),
    ]);
  } else {
    commitStatus = notApplicableSurface("head SHA unavailable because PR metadata fetch failed");
    checkRuns = notApplicableSurface("head SHA unavailable because PR metadata fetch failed");
  }

  const surfaces = {
    conversation_comments: { ...conversationComments, items: conversationComments.items.map(normalizeConversationComment) },
    review_submissions: { ...reviewSubmissions, items: reviewSubmissions.items.map(normalizeReviewSubmission) },
    inline_review_comments: { ...inlineReviewComments, items: inlineReviewComments.items.map(normalizeInlineReviewComment) },
    review_threads: { ...reviewThreads, items: reviewThreads.items.map(normalizeReviewThread) },
    commit_status:
      commitStatus.fetch_status === "not_applicable"
        ? { fetch_status: "not_applicable", failure: null, status: null, note: commitStatus.note }
        : {
            fetch_status: commitStatus.fetch_status,
            failure: commitStatus.failure,
            status:
              commitStatus.fetch_status === "failed"
                ? null
                : { state: commitStatus.state, total_count: commitStatus.total_count, statuses: commitStatus.items.map(normalizeStatus) },
          },
    check_runs: { ...checkRuns, items: checkRuns.items.map(normalizeCheckRun) },
  };

  let fetchFailures = prMetadataFailure ? 1 : 0;
  for (const surface of Object.values(surfaces)) {
    if (surface.fetch_status === "failed" || surface.fetch_status === "partial") fetchFailures += 1;
  }

  return {
    repo: `${owner}/${repo}`,
    pull_number: pullNumber,
    generated_at: new Date().toISOString(),
    pr_metadata: prBody
      ? { fetch_status: "fetched", failure: null, head_sha: headSha, state: prBody.state ?? null, html_url: prBody.html_url ?? null, updated_at: prBody.updated_at ?? null }
      : { fetch_status: "failed", failure: prMetadataFailure, head_sha: null, state: null, html_url: null, updated_at: null },
    surfaces,
    fetch_failures: fetchFailures,
  };
}

const SURFACE_LABELS = [
  ["conversation_comments", "Conversation comments"],
  ["review_submissions", "Review submissions"],
  ["inline_review_comments", "Inline review comments"],
  ["review_threads", "Review threads"],
  ["commit_status", "Commit status (combined)"],
  ["check_runs", "Check runs"],
];

// Renders the same collectReviewEvidence() result as a human-readable
// snapshot summary. Purely a presentation of the counts/fetch states already
// computed above — it adds no new judgment.
export function formatHumanSummary(result) {
  const lines = [];
  lines.push(`PR #${result.pull_number} review evidence snapshot (${result.repo})`);
  if (result.pr_metadata.fetch_status === "fetched") {
    lines.push(`Head: ${result.pr_metadata.head_sha ?? "unknown"} (state: ${result.pr_metadata.state ?? "unknown"})`);
  } else {
    lines.push(`Head: unknown (PR metadata fetch failed: ${result.pr_metadata.failure?.message ?? "unknown error"})`);
  }
  lines.push(`Snapshot fetched at: ${result.generated_at}`);
  lines.push("");

  for (const [key, label] of SURFACE_LABELS) {
    const surface = result.surfaces[key];
    if (!surface) continue;
    let line = `${label}: ${surface.fetch_status}`;
    if (key === "commit_status") {
      if (surface.fetch_status === "fetched" || surface.fetch_status === "partial") {
        line += ` (state: ${surface.status?.state ?? "unknown"}, contexts: ${surface.status?.statuses?.length ?? 0})`;
      }
    } else if (surface.count !== null && surface.count !== undefined) {
      line += ` (${surface.count})`;
    }
    if (surface.fetch_status === "failed" || surface.fetch_status === "partial") {
      line += ` — ${surface.failure?.message ?? "unknown failure"}`;
    }
    if (surface.fetch_status === "not_applicable" && surface.note) {
      line += ` — ${surface.note}`;
    }
    lines.push(line);
  }

  lines.push("");
  lines.push(`Fetch failures: ${result.fetch_failures}`);
  return lines.join("\n");
}

export function parseReviewEvidenceArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      args.repo = argv[index + 1];
      index += 1;
    } else if (arg === "--pr") {
      args.pr = argv[index + 1];
      index += 1;
    } else if (arg === "--token") {
      args.token = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--state") {
      args.state = true;
    } else if (arg === "--target-sha") {
      args.targetSha = argv[index + 1];
      index += 1;
    } else if (arg === "--record") {
      args.record = argv[index + 1];
      index += 1;
    } else if (arg === "--reviewer") {
      args.reviewer = argv[index + 1];
      index += 1;
    } else if (arg === "--run-after") {
      args.runAfter = argv[index + 1];
      index += 1;
    } else if (arg === "--run-anchor-id") {
      args.runAnchorId = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.repo || !args.repo.includes("/")) {
    throw new Error("Usage: node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> [--json] [--token <token>]");
  }
  if (!args.pr || !/^\d+$/.test(args.pr)) {
    throw new Error("Usage: node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> [--json] [--token <token>]");
  }
  const stateOptions = ["targetSha", "record", "reviewer", "runAfter", "runAnchorId"];
  if (!args.state && stateOptions.some((key) => args[key] !== undefined)) {
    throw new Error("State options require --state");
  }
  if (args.state && !args.targetSha) {
    throw new Error("State mode requires --target-sha");
  }
  if (args.state && !/^[0-9a-f]{7,40}$/i.test(args.targetSha)) {
    throw new Error("State mode requires --target-sha <7-40 hex SHA>");
  }
  if (args.state && !args.runAfter && !args.runAnchorId) {
    throw new Error("State mode requires --run-after or --run-anchor-id");
  }
  if (args.runAfter !== undefined && Number.isNaN(Date.parse(args.runAfter)))
    throw new Error("Usage: --run-after needs an ISO-8601 timestamp");
  return args;
}
