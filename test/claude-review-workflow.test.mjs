import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "claude-review.yml");

test("Claude review workflow restricts its trigger to trusted commenters", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  // Regression proof for Issue #18 Blocker 4: a PR comment containing "@claude"
  // must no longer be sufficient on its own to run a job holding
  // CLAUDE_CODE_OAUTH_TOKEN. The job condition must also gate on the
  // commenter's author_association.
  assert.match(
    workflow,
    /github\.event\.comment\.author_association/,
    "job condition must gate on the commenter's author_association",
  );

  const ifMatch = workflow.match(/if:\s*>([\s\S]*?)\n {4}runs-on:/);
  assert.ok(ifMatch, "could not locate the claude-review job's `if` condition");
  const condition = ifMatch[1];

  assert.match(condition, /contains\(github\.event\.comment\.body, '@claude'\)/);

  // The allowlist must actually gate github.event.comment.author_association
  // itself (not merely appear somewhere in the condition alongside it), or a
  // future edit could decouple the two while this assertion stays green.
  assert.match(
    condition,
    /contains\(fromJSON\('\["OWNER",\s*"MEMBER",\s*"COLLABORATOR"\]'\),\s*github\.event\.comment\.author_association\)/,
    "trusted association allowlist must be applied to github.event.comment.author_association",
  );

  for (const trustedAssociation of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.ok(
      condition.includes(trustedAssociation),
      `trusted-actor allowlist must include ${trustedAssociation}`,
    );
  }

  // The allowlist must not admit an untrusted/public association such as a
  // fork PR's default "NONE"/"CONTRIBUTOR"/"FIRST_TIME_CONTRIBUTOR" commenter.
  for (const untrustedAssociation of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR"]) {
    assert.ok(
      !condition.includes(untrustedAssociation),
      `trusted-actor allowlist must not include ${untrustedAssociation}`,
    );
  }
});

test("Claude review workflow uses bounded runtime tuning from first-consumer evidence", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  // Regression proof for Issue #18 Blocker 4: first-consumer Discovery hit
  // `error_max_turns` at the previous `--max-turns 10` / `timeout-minutes: 15`
  // defaults on a realistically sized review. `--max-turns 30` /
  // `timeout-minutes: 25` is the first-consumer-validated baseline; this must
  // not regress below it.
  const maxTurnsMatch = workflow.match(/--max-turns (\d+)/);
  assert.ok(maxTurnsMatch, "workflow must configure --max-turns");
  assert.ok(
    Number(maxTurnsMatch[1]) >= 30,
    `--max-turns must be at least 30 (first-consumer baseline), got ${maxTurnsMatch[1]}`,
  );

  const timeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(timeoutMatch, "job must configure timeout-minutes");
  assert.ok(
    Number(timeoutMatch[1]) >= 25,
    `timeout-minutes must be at least 25 (first-consumer baseline), got ${timeoutMatch[1]}`,
  );
});
