import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "consumer");
const skillsSource = path.join(root, "skills");

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

  // A plain sync (the operation consumers routinely run) must materialize the
  // Foundation-owned skill bundle too — there is no separate step to forget.
  const skillFiles = (await readdir(skillsSource)).sort();
  const consumerSkillFiles = (await readdir(path.join(consumer, ".ai-dev-foundation", "skills"))).sort();
  assert.deepEqual(consumerSkillFiles, skillFiles);
  for (const file of skillFiles) {
    assert.equal(
      await readFile(path.join(consumer, ".ai-dev-foundation", "skills", file), "utf8"),
      await readFile(path.join(skillsSource, file), "utf8"),
    );
  }
});

test("sync materializes the skill bundle and check detects skill bundle drift", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  const skillFile = path.join(consumer, ".ai-dev-foundation", "skills", "review-code.md");
  const staleExtraFile = path.join(consumer, ".ai-dev-foundation", "skills", "stale-extra-skill.md");
  const productRules = path.join(consumer, ".ai-dev-foundation", "product-rules.md");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const originalProductRules = await readFile(productRules, "utf8");

  // The reference fixture's synced skill bundle is current, so a freshly
  // copied consumer must pass without running sync first.
  assert.equal(run("check.mjs", consumer).status, 0);

  // Content mutation of a Foundation-owned skill file is drift.
  const originalSkillFile = await readFile(skillFile, "utf8");
  await writeFile(skillFile, `${originalSkillFile}\n<!-- consumer edit -->\n`, "utf8");
  const mutatedResult = run("check.mjs", consumer);
  assert.notEqual(mutatedResult.status, 0);
  assert.match(mutatedResult.stderr, /Foundation-owned skill bundle is stale/);
  assert.match(mutatedResult.stderr, /review-code\.md/);
  assert.match(mutatedResult.stderr, /sync\.mjs/);

  // A Foundation-owned skill file the consumer never synced (or deleted) is
  // also drift, not a silent pass.
  await rm(skillFile);
  const missingResult = run("check.mjs", consumer);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /review-code\.md/);

  // A stale/extra file in the Foundation-owned skill directory the pinned
  // checkout no longer ships is drift too.
  await writeFile(skillFile, originalSkillFile, "utf8");
  await writeFile(staleExtraFile, "stale", "utf8");
  const extraResult = run("check.mjs", consumer);
  assert.notEqual(extraResult.status, 0);
  assert.match(extraResult.stderr, /stale-extra-skill\.md/);

  // Remediation is the same routine operation consumers already run — no
  // separate bootstrap step for skills.
  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
  await assert.rejects(readFile(staleExtraFile, "utf8"), { code: "ENOENT" });

  // Consumer-owned files outside the skill directory are never part of this
  // comparison and are left untouched by sync/check.
  assert.equal(await readFile(productRules, "utf8"), originalProductRules);
});

test("check detects skill bundle drift in a nested subdirectory, not only top-level files", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const sourceNestedDirectory = path.join(skillsSource, "nested");
  const sourceNestedFile = path.join(sourceNestedDirectory, "nested.md");
  t.after(() => rm(sourceNestedDirectory, { recursive: true, force: true }));
  await mkdir(sourceNestedDirectory, { recursive: true });
  await writeFile(sourceNestedFile, "nested-source\n", "utf8");

  // The pinned checkout now ships a nested skill file the consumer never
  // synced: missing-in-a-subdirectory must be caught, not just missing
  // top-level files.
  assert.notEqual(run("check.mjs", consumer).status, 0);

  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
  assert.equal(
    await readFile(path.join(consumer, ".ai-dev-foundation", "skills", "nested", "nested.md"), "utf8"),
    "nested-source\n",
  );

  // The checkout stops shipping the nested skill file; the consumer's copy
  // is now a stale nested extra and must be reported.
  await rm(sourceNestedDirectory, { recursive: true, force: true });
  assert.notEqual(run("check.mjs", consumer).status, 0);
});

test("a repin without re-syncing leaves the skill bundle stale, and check catches it", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  const sourceSkillFile = path.join(skillsSource, "review-code.md");
  const originalSourceSkillFile = await readFile(sourceSkillFile, "utf8");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  t.after(() => writeFile(sourceSkillFile, originalSourceSkillFile, "utf8"));

  assert.equal(run("check.mjs", consumer).status, 0);

  // Simulate a Foundation repin that changed the canonical skill content: the
  // consumer's materialized copy is now stale even though nobody touched it.
  await writeFile(sourceSkillFile, `${originalSourceSkillFile}\n<!-- repinned content -->\n`, "utf8");
  const staleResult = run("check.mjs", consumer);
  assert.notEqual(staleResult.status, 0);
  assert.match(staleResult.stderr, /Foundation-owned skill bundle is stale/);

  // Re-running sync (the consumer's routine operation) remediates it.
  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
});

test("Foundation sync/check/bootstrap never touch consumer-owned guidance outside the exact-match directories", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-"));
  const consumer = path.join(temporaryRoot, "consumer");
  await cp(fixture, consumer, { recursive: true });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  // Consumer-owned guidance/skills live in their own namespace, physically
  // separate from the Foundation-owned exact-match `.ai-dev-foundation/skills/`
  // and `.ai-dev-foundation/quality/` directories.
  const consumerSkillFile = path.join(consumer, ".ai-dev-foundation", "consumer-skills", "local-note.md");
  await mkdir(path.dirname(consumerSkillFile), { recursive: true });
  await writeFile(consumerSkillFile, "# Consumer-owned local skill note\n", "utf8");

  assert.equal(run("sync.mjs", consumer).status, 0);
  assert.equal(run("check.mjs", consumer).status, 0);
  assert.equal(run("bootstrap-next-supabase.mjs", consumer).status, 0);

  assert.equal(await readFile(consumerSkillFile, "utf8"), "# Consumer-owned local skill note\n");
});

test("the documented reference consumer's synced skill bundle is not stale", async () => {
  // README.md documents test/fixtures/consumer/ as the reference consumer, so
  // its checked-in .ai-dev-foundation/skills/ snapshot must not silently
  // drift from the Foundation repo's skills/ source.
  const fixtureSkillsDirectory = path.join(fixture, ".ai-dev-foundation", "skills");
  const sourceFiles = (await readdir(skillsSource)).sort();
  const fixtureFiles = (await readdir(fixtureSkillsDirectory)).sort();
  assert.deepEqual(fixtureFiles, sourceFiles);

  for (const file of sourceFiles) {
    const [sourceContent, fixtureContent] = await Promise.all([
      readFile(path.join(skillsSource, file), "utf8"),
      readFile(path.join(fixtureSkillsDirectory, file), "utf8"),
    ]);
    assert.equal(
      fixtureContent,
      sourceContent,
      `test/fixtures/consumer/.ai-dev-foundation/skills/${file} is stale; ` +
        "run: node tooling/sync.mjs --consumer test/fixtures/consumer",
    );
  }
});

test("the distributed skill bundle does not assume an unresolvable Foundation-repo-only path", async () => {
  // The distributed .ai-dev-foundation/skills/*.md files repeatedly reference
  // `policy/core.md`, a path that only exists in the Foundation repository.
  // In the reference consumer fixture, that path must never be presented as
  // resolvable on its own — each distributed skill file must carry the
  // consumer-context resolution note pointing at the generated AGENTS.md's
  // Foundation policy section instead.
  const fixtureSkillsDirectory = path.join(fixture, ".ai-dev-foundation", "skills");
  const skillFiles = (await readdir(skillsSource)).filter((file) => file.endsWith(".md"));

  for (const file of skillFiles) {
    const content = (await readFile(path.join(fixtureSkillsDirectory, file), "utf8")).replace(/\s+/g, "");
    assert.ok(
      content.includes(
        "の規範的なルールはgenerated`AGENTS.md`の`##Foundationpolicy`sectionとして配布されます。".replace(
          /\s+/g,
          "",
        ),
      ),
      `${file} must state how policy/core.md references resolve in consumer context`,
    );
    assert.ok(
      content.includes(
        "consumerリポジトリに`policy/core.md`というpathが存在することは前提にしません。".replace(/\s+/g, ""),
      ),
      `${file} must not assume a policy/core.md path exists in the consumer repository`,
    );
  }
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
