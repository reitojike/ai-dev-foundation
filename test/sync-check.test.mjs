import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "consumer");

function run(tool, consumer) {
  return spawnSync(process.execPath, [path.join(root, "tooling", tool), "--consumer", consumer], {
    encoding: "utf8",
  });
}

test("sync creates current adapters and check detects both input and output drift", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  const corePolicy = path.join(root, "policy", "core.md");
  const originalCorePolicy = await readFile(corePolicy, "utf8");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  t.after(() => writeFile(corePolicy, originalCorePolicy, "utf8"));

  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);

  await writeFile(corePolicy, `${originalCorePolicy}\n<!-- canonical change -->\n`);
  assert.notEqual(run("check.mjs", consumer).status, 0);
  await writeFile(corePolicy, originalCorePolicy, "utf8");
  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);

  const agents = await readFile(path.join(consumer, "AGENTS.md"), "utf8");
  const claude = await readFile(path.join(consumer, "CLAUDE.md"), "utf8");
  assert.match(agents, /Foundation core policy/);
  assert.match(agents, /Reference consumer rules/);
  assert.equal(claude, await readFile(path.join(root, "templates", "CLAUDE.md"), "utf8"));
  assert.match(claude, /^@AGENTS\.md$/m);

  await writeFile(path.join(consumer, "AGENTS.md"), `${agents}\nmanual edit\n`);
  assert.notEqual(run("check.mjs", consumer).status, 0);

  assert.equal(run("sync.mjs", consumer).status, 0);
  await writeFile(path.join(consumer, ".ai-dev-foundation", "product-rules.md"), "# Changed product rule\n");
  assert.notEqual(run("check.mjs", consumer).status, 0);
  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
});

test("bootstrap replaces only its Foundation-owned quality directory", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  const qualityDirectory = path.join(consumer, ".ai-dev-foundation", "quality");
  const staleFile = path.join(qualityDirectory, "stale-foundation-file.txt");
  const consumerFile = path.join(consumer, "consumer-owned.txt");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await mkdir(consumer, { recursive: true });
  await writeFile(consumerFile, "consumer-owned", "utf8");
  assert.equal(run("bootstrap-next-supabase.mjs", consumer).status, 0);
  await writeFile(staleFile, "stale", "utf8");

  assert.equal(run("bootstrap-next-supabase.mjs", consumer).status, 0);
  await assert.rejects(readFile(staleFile, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(consumerFile, "utf8"), "consumer-owned");
});
