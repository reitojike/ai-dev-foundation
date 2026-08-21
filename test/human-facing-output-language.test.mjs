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

test("core policy defines a provider/consumer-neutral human-facing output language convention", async () => {
  const core = await readFile(path.join(root, "policy", "core.md"), "utf8");

  assert.ok(core.includes("## Human-facing output language"));

  // Reusable principle: follows the project's own default, not a hardcoded language.
  assert.ok(
    containsText(
      core,
      "human-facing output（人間が読むために agent が作成・編集する成果物）の既定言語は、その project が持つ既定言語に従います。",
    ),
  );

  // Covered surfaces from Issue #28's proposed semantics.
  for (const surface of [
    "Issue / PR の title・body・comment",
    "review finding / triage / Resolution / closure の durable evidence comment",
    "planning checkpoint、handoff、completion report",
    "セッション中の人間向け progress report・final report",
    "agent が生成・編集する Markdown / documentation",
  ]) {
    assert.ok(core.includes(surface), `missing covered surface: ${surface}`);
  }

  // Exceptions: machine-facing vocabulary is preserved, not translated.
  for (const exception of [
    "source code / identifier / symbol / API / library / framework name",
    "file path / command / script name",
    "schema / enum / protocol field 等の machine-facing text",
    "error / log / provider-native output の引用",
    "externally defined technical term / proper noun",
  ]) {
    assert.ok(core.includes(exception), `missing exception: ${exception}`);
  }
  assert.ok(
    containsText(
      core,
      "human-facing な地の文の中に、上記の technical vocabulary を原語のまま混在させることは許容します。",
    ),
  );

  // Unspecified-default fallback: observe, don't assume a hardcoded language.
  assert.ok(
    containsText(
      core,
      "project が既定言語を明示していない場合、agent は言語を仮定せず、その project の既存 human-facing artifact や communication から観測できる言語に合わせます。",
    ),
  );

  // Design constraint (Issue #28): Kernel must not hardcode a specific consumer
  // language (e.g. Japanese) as a mandatory rule.
  assert.ok(
    containsText(
      core,
      "project 自身の既定言語が何であるかは Foundation Kernel が固定する対象ではありません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "特定の project がどの言語を既定とするかは、その project の Consumer product rules、または Foundation 自身のように project が自らを consumer として扱う場合は project 自身の repo-local instructions へ記録します。",
    ),
  );
  assert.ok(
    containsText(core, "Technology profile は technology/provider 向けの具体化に限定し、project の既定言語を持ちません。"),
  );
  assert.doesNotMatch(
    core,
    /日本語(で書|必須|を既定)/,
    "policy/core.md must not hardcode Japanese (or any specific consumer language) as a mandatory Kernel rule",
  );

  // Review Protocol's machine-facing contract/field names stay untouched by this convention.
  assert.ok(
    containsText(
      core,
      "Review Protocol の Selection Contract / Execution Contract / Acquisition & Validity Contract / Resolution Contract、および `target_sha` / `finding_count` 等の record schema field 名は、この節の対象外の machine-facing structure として英語のまま保持します。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "provider-native bot 自身が固定言語で出力する内容は、この節に対する Foundation violation として扱いません。",
    ),
  );
  assert.ok(
    containsText(
      core,
      "agent が自ら作成する durable な summary / resolution comment は、この節の既定言語に従います。",
    ),
  );

  assert.doesNotMatch(core, /Codex|CodeRabbit|claude-[a-z0-9-]+|gpt-[a-z0-9-]+/i);
});

test("generated consumer AGENTS.md reflects the human-facing output language convention", async () => {
  const agents = await readFile(path.join(root, "test", "fixtures", "consumer", "AGENTS.md"), "utf8");

  assert.ok(agents.includes("## Human-facing output language"));
  assert.ok(
    containsText(
      agents,
      "human-facing output（人間が読むために agent が作成・編集する成果物）の既定言語は、その project が持つ既定言語に従います。",
    ),
  );
});

test("ai-dev-foundation repository instructions declare its own Japanese default and defer to policy/core.md", async () => {
  const rootAgents = await readFile(path.join(root, "AGENTS.md"), "utf8");

  assert.ok(
    containsText(rootAgents, "このリポジトリ（`ai-dev-foundation`）自身の既定言語は日本語です。"),
  );
  assert.ok(containsText(rootAgents, "`policy/core.md`のHuman-facing output languageに従い"));

  // Covers GitHub outputs / reports, not only in-repo Markdown docs.
  for (const surface of [
    "GitHub Issue/PRのtitle・body・comment",
    "review durable evidence comment",
    "planning checkpoint・handoff・completion report",
    "セッション中の人間向けprogress report・final report",
  ]) {
    assert.ok(containsText(rootAgents, surface), `missing covered surface in repo-local AGENTS.md: ${surface}`);
  }

  // This repo-local instruction stays separate from the canonical consumer-facing
  // policy/templates, per the existing Generated adapters boundary.
  assert.ok(
    containsText(
      rootAgents,
      "このファイルはFoundation自身を編集するためのrepo-local instructionです。",
    ),
  );
});
