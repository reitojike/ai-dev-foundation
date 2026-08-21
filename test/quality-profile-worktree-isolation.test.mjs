import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
        "mechanismを選びます。",
    ),
  );
});

test("Foundation Kernel keeps Supabase-specific semantics out of policy/core.md", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");
  assert.doesNotMatch(core, /Supabase/i);
});
