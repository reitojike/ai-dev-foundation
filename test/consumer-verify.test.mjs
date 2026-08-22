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
  const verifyCommand = packageJson.scripts.verify;
  const requiredCommands = [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "build",
    "foundation:check",
    "verify:profile",
  ];

  assert.equal(verifyCommand, requiredCommands.map((command) => `npm run ${command}`).join(" && "));
  for (const command of requiredCommands) {
    assert.equal(typeof packageJson.scripts[command], "string");
  }
});

test("verify:profile runs the filesystem-only migration collision check before any DB/Docker-touching Supabase command", async () => {
  // Issue #43: the migration version collision guardrail must execute before
  // the DB / Docker / Supabase local stack is ever touched. supabase:types:check
  // stands in for the DB/Docker-touching step here (per profile README, real
  // consumers' supabase:types shells out to `supabase gen types`), so
  // supabase:migrations:check must be sequenced strictly before it, not just
  // present somewhere in verify:profile.
  const packageJson = JSON.parse(await readFile(path.join(fixture, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["verify:profile"],
    "npm run supabase:migrations:check && npm run supabase:types:check",
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
