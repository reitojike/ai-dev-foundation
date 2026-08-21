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

test("check detects quality profile drift against the pinned Foundation checkout and bootstrap remediates it", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  const qualityFile = path.join(consumer, ".ai-dev-foundation", "quality", "eslint.config.mjs");
  const staleExtraFile = path.join(consumer, ".ai-dev-foundation", "quality", "stale-extra-file.txt");
  const productRules = path.join(consumer, ".ai-dev-foundation", "product-rules.md");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const originalProductRules = await readFile(productRules, "utf8");

  // The reference fixture's bootstrapped quality profile is current, so a
  // freshly copied consumer must pass without any remediation.
  const currentResult = run("check.mjs", consumer);
  assert.equal(currentResult.status, 0);
  assert.match(currentResult.stdout, /quality profile/i);

  // Content mutation of a Foundation-owned quality file is drift.
  const originalQualityFile = await readFile(qualityFile, "utf8");
  await writeFile(qualityFile, `${originalQualityFile}\n// consumer edit\n`, "utf8");
  const mutatedResult = run("check.mjs", consumer);
  assert.notEqual(mutatedResult.status, 0);
  assert.match(mutatedResult.stderr, /Foundation-owned quality profile is stale/);
  assert.match(mutatedResult.stderr, /eslint\.config\.mjs/);
  assert.match(mutatedResult.stderr, /bootstrap-next-supabase\.mjs/);

  // A Foundation-owned file the consumer never bootstrapped (or deleted) is
  // also drift, not a silent pass.
  await rm(qualityFile);
  const missingResult = run("check.mjs", consumer);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /eslint\.config\.mjs/);

  // A stale/extra Foundation-owned-directory file the pinned checkout no
  // longer ships is drift too — the profile isn't current until it matches
  // exactly, not just a superset.
  await writeFile(qualityFile, originalQualityFile, "utf8");
  await writeFile(staleExtraFile, "stale", "utf8");
  const extraResult = run("check.mjs", consumer);
  assert.notEqual(extraResult.status, 0);
  assert.match(extraResult.stderr, /stale-extra-file\.txt/);

  // Remediation via the documented bootstrap command restores a pass.
  assert.equal(run("bootstrap-next-supabase.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
  await assert.rejects(readFile(staleExtraFile, "utf8"), { code: "ENOENT" });

  // Consumer-owned files outside the quality directory are never part of
  // this comparison and are left untouched by check/bootstrap.
  assert.equal(await readFile(productRules, "utf8"), originalProductRules);
});

test("check detects quality profile drift in a nested subdirectory, not only top-level files", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const sourceNestedDirectory = path.join(root, "profiles", "next-supabase", "quality", "nested");
  const sourceNestedFile = path.join(sourceNestedDirectory, "nested.txt");
  t.after(() => rm(sourceNestedDirectory, { recursive: true, force: true }));
  await mkdir(sourceNestedDirectory, { recursive: true });
  await writeFile(sourceNestedFile, "nested-source\n", "utf8");

  // The pinned checkout now ships a nested file the consumer never
  // bootstrapped: missing-in-a-subdirectory must be caught, not just
  // missing top-level files.
  assert.notEqual(run("check.mjs", consumer).status, 0);

  assert.equal(run("bootstrap-next-supabase.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
  assert.equal(
    await readFile(path.join(consumer, ".ai-dev-foundation", "quality", "nested", "nested.txt"), "utf8"),
    "nested-source\n",
  );

  // The checkout stops shipping the nested file; the consumer's copy is now
  // a stale nested extra and must be reported, not silently ignored because
  // it is one directory level down.
  await rm(sourceNestedDirectory, { recursive: true, force: true });
  assert.notEqual(run("check.mjs", consumer).status, 0);
});
