import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "consumer");

function verify() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const arguments_ = process.platform === "win32" ? ["/d", "/s", "/c", "npm run verify"] : ["run", "verify"];
  return spawnSync(command, arguments_, {
    cwd: fixture,
    encoding: "utf8",
    timeout: 120_000,
  });
}

test("consumer verify is green and detects generated adapter and profile drift", async (t) => {
  const agentsPath = path.join(fixture, "AGENTS.md");
  const typesPath = path.join(fixture, "src", "database.types.ts");
  const packagePath = path.join(fixture, "package.json");
  const originalAgents = await readFile(agentsPath, "utf8");
  const originalTypes = await readFile(typesPath, "utf8");
  const originalPackage = await readFile(packagePath, "utf8");
  t.after(async () => {
    await writeFile(agentsPath, originalAgents);
    await writeFile(typesPath, originalTypes);
    await writeFile(packagePath, originalPackage);
  });

  assert.equal(verify().status, 0);

  await writeFile(agentsPath, `${originalAgents}\ndrift\n`);
  assert.notEqual(verify().status, 0);

  await writeFile(agentsPath, originalAgents);
  await writeFile(typesPath, "export type Database = {};\n");
  assert.notEqual(verify().status, 0);

  await writeFile(typesPath, originalTypes);
  await writeFile(typesPath, originalTypes.replace("title: string", "title: number"));
  assert.notEqual(verify().status, 0);

  await writeFile(typesPath, originalTypes);
  const packageJson = JSON.parse(originalPackage);
  delete packageJson.scripts.build;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  assert.notEqual(verify().status, 0);
});

test("consumer verify fixes the required command set", async () => {
  const packageJson = JSON.parse(await readFile(path.join(fixture, "package.json"), "utf8"));
  const requiredLanes = ["verify:code", "verify:build", "verify:database"];

  assert.equal(
    packageJson.scripts.verify,
    requiredLanes.map((command) => `npm run ${command}`).join(" && "),
  );

  const requiredCodeCommands = ["format:check", "lint", "typecheck", "test:unit", "foundation:check", "verify:profile:code"];
  assert.equal(
    packageJson.scripts["verify:code"],
    requiredCodeCommands.map((command) => `npm run ${command}`).join(" && "),
  );
  assert.equal(packageJson.scripts["verify:build"], "npm run build");
  assert.equal(packageJson.scripts["verify:database"], "npm run verify:profile:database");

  for (const command of [...requiredLanes, ...requiredCodeCommands, "verify:profile:database"]) {
    assert.equal(typeof packageJson.scripts[command], "string");
  }
});

test("Verify / Code lane runs the filesystem-only migration collision check; Verify / Database lane runs the DB/Docker-touching Supabase command", async () => {
  // Issue #43 (migration collision guardrail must precede any DB/Docker-touching
  // Supabase command) plus Issue #59 (Verify / Code, Build, Database responsibility
  // lanes): the invariant is now structural — supabase:migrations:check lives in
  // verify:profile:code (Verify / Code lane), supabase:types:check stands in for
  // the DB/Docker-touching step (per profile README, real consumers' supabase:types
  // shells out to `supabase gen types`) and lives in verify:profile:database
  // (Verify / Database lane). The top-level `verify` composition (asserted above)
  // already runs verify:code strictly before verify:database, so this ordering
  // holds without needing the two checks to share one script.
  const packageJson = JSON.parse(await readFile(path.join(fixture, "package.json"), "utf8"));
  const codeSteps = packageJson.scripts["verify:profile:code"].split(" && ").map((step) => step.trim());
  const databaseSteps = packageJson.scripts["verify:profile:database"].split(" && ").map((step) => step.trim());

  assert.ok(
    codeSteps.includes("npm run supabase:migrations:check"),
    "verify:profile:code must run supabase:migrations:check",
  );
  assert.ok(
    databaseSteps.includes("npm run supabase:types:check"),
    "verify:profile:database must run supabase:types:check",
  );
  assert.ok(
    !databaseSteps.includes("npm run supabase:migrations:check"),
    "the filesystem-only migration collision check must not also run in the Verify / Database lane",
  );
  assert.equal(
    packageJson.scripts["supabase:migrations:check"],
    "node .ai-dev-foundation/quality/check-migration-version-collision.mjs",
  );
});

test("consumer verify detects a duplicate Supabase migration version prefix", async (t) => {
  const migrationsDirectory = path.join(fixture, "supabase", "migrations");
  const colliding = path.join(migrationsDirectory, "20260101000000_create_todos_again.sql");
  t.after(() => rm(colliding, { force: true }));

  // Same version prefix as the fixture's existing 20260101000000_create_todos.sql,
  // different filename — the Issue #43 canonical failure mode, which Git alone
  // would never flag as a conflict.
  await writeFile(colliding, "create table todos_again (id uuid primary key);\n");

  const result = verify();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate Supabase migration version prefix detected/);
  assert.match(result.stderr, /20260101000000_create_todos\.sql/);
  assert.match(result.stderr, /20260101000000_create_todos_again\.sql/);
});
