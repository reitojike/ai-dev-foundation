import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripWhitespace(text) {
  return text.replace(/\s+/g, "");
}

function containsText(haystack, needle) {
  return stripWhitespace(haystack).includes(stripWhitespace(needle));
}

test("Next.js + Supabase quality profile defines shared local stack exclusive-resource guidance", async () => {
  const readme = await readFile(
    path.join(root, "profiles", "next-supabase", "quality", "README.md"),
    "utf8",
  );

  assert.ok(readme.includes("## Worktree/checkoutをまたぐlocal Supabase stack"));
  assert.ok(readme.includes("### Shared local stack"));
  assert.ok(readme.includes("### Isolated local stack"));

  for (const operation of [
    "`supabase start` / `supabase stop`",
    "`supabase db reset`",
    "migration apply / rollback相当のoperation",
    "DB / RLS / auth integration test",
    "schema由来のgenerated types生成、およびdrift verification",
    "`verify:profile`",
    "full `verify`",
  ]) {
    assert.ok(readme.includes(operation), `missing exclusive-resource operation: ${operation}`);
  }

  assert.ok(
    containsText(readme, "そのstackはshared local stackです。次を**exclusive resource**として扱います。"),
  );

  // The core failure mode: exit 0 / CI green does not imply valid evidence
  // when the observed DB state came from a different checkout.
  assert.ok(
    containsText(
      readme,
      "exit code 0やCI greenであっても、参照したDB stateがverification対象の" +
        "checkout由来でなければ、その結果はverification evidenceとしてinvalidです。",
    ),
  );
  assert.ok(
    containsText(
      readme,
      "既に起動しているshared stackの現在stateを、それだけを根拠に自checkoutの" +
        "verification evidenceとして扱わない。",
    ),
  );

  // Isolated stacks must not be forced into unnecessary serialization.
  assert.ok(
    containsText(
      readme,
      "isolated local stackでは上記のexclusive serializationを要求しません。",
    ),
  );
  assert.ok(
    containsText(
      readme,
      "local Supabaseを使うconsumerが常にshared local stackである、という前提は置きません。",
    ),
  );

  // Foundation must not pin a specific ownership-confirmation mechanism.
  assert.ok(
    containsText(
      readme,
      "Foundationが特定の実装を指定しません。consumer / runtimeに合った合理的な" +
        "mechanismを選びますが、選んだmechanismはitem 1のtime-of-check/time-of-use" +
        "gapを許容しないことを満たす必要があります",
    ),
  );

  // Ownership confirmation must not be a point-in-time check alone (TOCTOU).
  assert.ok(
    containsText(
      readme,
      "そのownershipをoperation完了まで排他的に維持する。" +
        "一時点のcheck（time-of-check）だけでoperationの実行（time-of-use）中の" +
        "排他性を保証しない方法は、この要件を満たしません。",
    ),
  );

  // The ownership-hold requirement must cover every operation on the
  // exclusive-resource list, not only destructive/stateful ones — a
  // read-only DB/RLS test or drift check can still observe wrong-checkout
  // state if it runs without holding ownership.
  assert.ok(
    containsText(
      readme,
      "上記でexclusive resourceとして列挙したoperation（destructive /" +
        "statefulなDB operationだけでなく、read-only寄りのDB / RLS / auth" +
        "integration testやgenerated types drift verificationを含む）の前に、" +
        "そのstackに対するexclusive ownershipを確認し",
    ),
  );
});

test("Foundation Kernel keeps Supabase-specific semantics out of policy/core.md", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  assert.doesNotMatch(core, /Supabase/i);
});

test("project-rules.md points consumers at the actual bootstrapped quality profile path", async () => {
  const projectRules = await readFile(
    path.join(root, "profiles", "next-supabase", "project-rules.md"),
    "utf8",
  );
  const bootstrapTooling = await readFile(
    path.join(root, "tooling", "bootstrap-next-supabase.mjs"),
    "utf8",
  );

  // The pointer must name the consumer-relative path that bootstrap actually
  // writes to, not a bare "quality/README.md" a consumer agent cannot resolve
  // from AGENTS.md alone.
  assert.ok(projectRules.includes("`.ai-dev-foundation/quality/README.md`"));
  assert.match(bootstrapTooling, /"\.ai-dev-foundation",\s*"quality"/);
  assert.ok(
    containsText(
      projectRules,
      "consumer の `.ai-dev-foundation/quality/README.md`（Foundation リポジトリでは" +
        "`profiles/next-supabase/quality/README.md`）を正本とします。",
    ),
  );
});

test("the documented reference consumer's bootstrapped quality profile is not stale", async () => {
  // README.md:13 documents test/fixtures/consumer/ as "最小の reference consumer".
  // project-rules.md now names its .ai-dev-foundation/quality/README.md as the
  // canonical path a consumer agent resolves to, so that checked-in copy must
  // not silently drift from the live profile source (otherwise the pointer
  // resolves to stale guidance instead of the current normative content).
  const sourceDirectory = path.join(root, "profiles", "next-supabase", "quality");
  const fixtureDirectory = path.join(root, "test", "fixtures", "consumer", ".ai-dev-foundation", "quality");

  const sourceFiles = (await readdir(sourceDirectory)).sort();
  const fixtureFiles = (await readdir(fixtureDirectory)).sort();
  assert.deepEqual(fixtureFiles, sourceFiles);

  for (const file of sourceFiles) {
    const [sourceContent, fixtureContent] = await Promise.all([
      readFile(path.join(sourceDirectory, file), "utf8"),
      readFile(path.join(fixtureDirectory, file), "utf8"),
    ]);
    assert.equal(
      fixtureContent,
      sourceContent,
      `test/fixtures/consumer/.ai-dev-foundation/quality/${file} is stale; ` +
        "run: node tooling/bootstrap-next-supabase.mjs --consumer test/fixtures/consumer",
    );
  }
});
