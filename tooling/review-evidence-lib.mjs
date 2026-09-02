// Issue #62: deterministic mechanical acquisition of GitHub durable review
// surfaces for a single PR snapshot. This module does not decide whether a
// review is complete, whether a reviewed target is acceptable, how to
// categorize a finding, or whether the PR is ready to merge — it only
// fetches, paginates, and normalizes what each surface returned. Those
// semantic judgments stay in policy/core.md's Review Protocol and the
// review skills; this file must not encode them.

import { HEAD_BOUND_SURFACES, MARKER_KINDS } from "./reviewer-record-lib.mjs";

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
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              databaseId
              url
              createdAt
              author { login }
              commit { oid }
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
          author { login }
          commit { oid }
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

// Review thread resolved/unresolved state is only exposed by the GraphQL
// API, not REST, so this surface is fetched separately from the other list
// surfaces. unresolved_count reflects the full thread list once that list
// itself is complete, even if fetch_status ends up "partial" because a
// single thread's own comments couldn't be paginated to completion — that
// failure narrows only that thread's comment list, not thread enumeration
// or resolved state. unresolved_count is unreliable only when fetch_status
// is "failed" (the thread list itself was never fully enumerated).
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
        unresolved_count: null,
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
        unresolved_count: null,
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

  const unresolvedCount = nodes.filter((node) => node.isResolved === false).length;
  if (threadCommentsFailure) {
    return {
      fetch_status: "partial",
      count: nodes.length,
      unresolved_count: unresolvedCount,
      pages_fetched: pages,
      items: nodes,
      failure: threadCommentsFailure,
    };
  }
  return { fetch_status: "fetched", count: nodes.length, unresolved_count: unresolvedCount, pages_fetched: pages, items: nodes, failure: null };
}

function normalizeConversationComment(item) {
  return {
    id: item.id,
    actor: item.user?.login ?? null,
    actor_type: item.user?.type ?? null,
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
    path: item.path ?? null,
    line: item.line ?? item.original_line ?? null,
    reviewed_sha: item.commit_id ?? null,
    original_commit_sha: item.original_commit_id ?? null,
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
    is_resolved: node.isResolved ?? null,
    is_outdated: node.isOutdated ?? null,
    path: node.path ?? null,
    line: node.line ?? null,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id ?? null,
      actor: comment.author?.login ?? null,
      created_at: comment.createdAt ?? null,
      reviewed_sha: comment.commit?.oid ?? null,
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
// review comments, review threads (with resolved state), combined commit
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
    if (key === "review_threads" && surface.fetch_status === "fetched") {
      line += ` — unresolved: ${surface.unresolved_count}`;
    }
    lines.push(line);
  }

  lines.push("");
  lines.push(`Fetch failures: ${result.fetch_failures}`);
  return lines.join("\n");
}

// --- Reviewer target completion state (Issue #72 Phase 1) -------------------
//
// Given a snapshot from collectReviewEvidence() and a consumer's reviewer
// capability record, this reports each reviewer's target completion state
// mechanically, together with the surface item locator and the literal marker
// that decided it. It stays inside the same boundary as the rest of this file:
// it matches declared markers and compares SHAs. It never categorizes a
// finding, never decides whether a run satisfies a review obligation, and never
// converts a missing or unfetched surface into `0 findings`.

const SHA_MIN_PREFIX_LENGTH = 7;

// Flattens one snapshot surface into uniform items so marker matching does not
// have to know each surface's field names. `actor` is null on the per-commit
// surfaces, which carry no author in this snapshot's normalized shape — those
// items are matched by marker text alone (a known narrowing, documented in the
// README alongside the surfaces' other coverage limits).
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
          fields: { reviewed_sha: comment.reviewed_sha },
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

function surfaceIsComplete(evidence, surfaceKey) {
  return evidence?.surfaces?.[surfaceKey]?.fetch_status === "fetched";
}

function markerSurfaces(reviewer) {
  const surfaces = new Set(reviewer.result_surfaces ?? []);
  for (const kind of MARKER_KINDS) {
    for (const surface of reviewer[kind]?.surfaces ?? []) surfaces.add(surface);
  }
  return [...surfaces];
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

function resolveBoundTarget(marker, item, headSha) {
  if (marker.target_field) return item.fields?.[marker.target_field] ?? null;
  if (marker.target_pattern) return new RegExp(marker.target_pattern).exec(item.body ?? "")?.[1] ?? null;
  if (item.head_bound) return headSha;
  return null;
}

// Abbreviated SHAs appear in comment bodies, so a prefix relation counts as the
// same target — but only from a length that cannot collide by accident.
function shaMatches(left, right) {
  if (!left || !right) return false;
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < SHA_MIN_PREFIX_LENGTH) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function byTimestampDescending(left, right) {
  if (!left.timestamp) return 1;
  if (!right.timestamp) return -1;
  if (left.timestamp === right.timestamp) return 0;
  return left.timestamp < right.timestamp ? 1 : -1;
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
    if (newest === null || item.timestamp > newest) newest = item.timestamp;
  }
  return newest;
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
  if (!anchor || !match.timestamp) return { applies: true, scope: "unscoped" };
  return match.timestamp >= anchor
    ? { applies: true, scope: "after-run-anchor" }
    : { applies: false, scope: "before-run-anchor" };
}

function collectMatches(reviewer, evidence, kind, headSha, expectedTarget, anchor) {
  const marker = reviewer[kind];
  if (!marker) return [];
  const actors = new Set((reviewer.actors ?? []).map((actor) => actor.toLowerCase()));
  const matches = [];
  for (const surfaceKey of marker.surfaces ?? []) {
    for (const item of surfaceItems(evidence, surfaceKey)) {
      // A null actor is only legitimate on the head-bound per-commit surfaces,
      // which carry no author at all. On a comment-shaped surface it means the
      // author is unknown (e.g. a deleted account), and accepting it would let
      // any comment carrying a generic marker stand in for the reviewer's.
      if (item.actor === null && !item.head_bound) continue;
      if (item.actor !== null && !actors.has(item.actor.toLowerCase())) continue;
      const markerText = matchedMarkerText(marker, item.body);
      if (markerText === null) continue;
      const match = {
        marker_kind: kind,
        surface: item.surface,
        actor: item.actor,
        locator: item.locator,
        timestamp: item.timestamp ?? null,
        marker: markerText,
        bound_target: resolveBoundTarget(marker, item, headSha),
      };
      matches.push({ ...match, ...scopeMatch(match, expectedTarget, anchor) });
    }
  }
  return matches.sort(byTimestampDescending);
}

function evaluateReviewer(reviewer, evidence, expectedTarget, headSha, since) {
  const surfacesUsed = markerSurfaces(reviewer);
  const incompleteSurfaces = surfacesUsed.filter((surface) => !surfaceIsComplete(evidence, surface));
  const evidenceComplete = incompleteSurfaces.length === 0;
  const runAnchor = runAnchorTimestamp(reviewer, evidence, since);

  const matches = Object.fromEntries(
    MARKER_KINDS.map((kind) => [
      kind,
      collectMatches(reviewer, evidence, kind, headSha, expectedTarget, runAnchor),
    ]),
  );
  // Only in-scope matches may set state or signal. Out-of-scope ones stay in
  // matched_evidence so the reason a stale marker was NOT applied is visible.
  const applied = Object.fromEntries(
    MARKER_KINDS.map((kind) => [kind, matches[kind].filter((match) => match.applies)]),
  );

  const completionAtTarget = applied.completion_marker.find((match) => shaMatches(match.bound_target, expectedTarget));
  const completionElsewhere = matches.completion_marker.find(
    (match) => match.bound_target && !shaMatches(match.bound_target, expectedTarget),
  );
  const completionUnbound = applied.completion_marker.find((match) => !match.bound_target);

  let state;
  let reason;
  let decisive = null;
  if (completionAtTarget) {
    state = "completed@target";
    reason = "completion_marker_bound_to_target";
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
    reason = "completion_marker_bound_to_other_target";
    decisive = completionElsewhere;
  } else if (completionUnbound) {
    state = "unknown";
    reason = "completion_marker_target_unresolved";
    decisive = completionUnbound;
  } else {
    state = "unknown";
    reason = evidenceComplete ? "no_matching_marker" : "fetch_incomplete";
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

  const matchedEvidence = [];
  for (const candidate of [decisive, signalMatch]) {
    if (candidate && !matchedEvidence.includes(candidate)) matchedEvidence.push(candidate);
  }
  for (const kind of MARKER_KINDS) {
    const [latest] = matches[kind];
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
    lines.push(
      `${reviewer.id} [${reviewer.default_class}]: ${reviewer.target_completion_state}${signal} (${reviewer.reason})`,
    );
    for (const match of reviewer.matched_evidence) {
      const scope = match.applies ? match.scope : `NOT APPLIED (${match.scope})`;
      lines.push(`  ${match.marker_kind}: "${match.marker}" [${scope}] @ ${match.locator ?? "no locator"}`);
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

const USAGE =
  "Usage: node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> [--json] [--token <token>] [--reviewers <path>] [--target-sha <sha>] [--since <ISO timestamp>]";

// Reads the value belonging to a flag. A trailing flag (or one followed by the
// next flag) has no value: taking argv[index + 1] blindly would leave the field
// `undefined` — which a later `!== undefined` guard skips — or silently swallow
// the following flag as the value.
function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} must be followed by a value. ${USAGE}`);
  }
  return value;
}

export function parseReviewEvidenceArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      args.repo = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--pr") {
      args.pr = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--token") {
      args.token = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--reviewers") {
      args.reviewers = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--target-sha") {
      args.targetSha = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--since") {
      args.since = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.repo || !args.repo.includes("/")) {
    throw new Error(USAGE);
  }
  if (!args.pr || !/^\d+$/.test(args.pr)) {
    throw new Error(USAGE);
  }
  if (args.targetSha !== undefined && !/^[0-9a-f]{7,40}$/i.test(args.targetSha)) {
    throw new Error("--target-sha must be a commit SHA (at least 7 hex characters)");
  }
  if (args.since !== undefined && Number.isNaN(Date.parse(args.since))) {
    throw new Error("--since must be an ISO 8601 timestamp");
  }
  return args;
}
