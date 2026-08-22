import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerScript = path.join(root, "profiles", "next-supabase", "quality", "check-migration-version-collision.mjs");
const fixturesRoot = path.join(root, "test", "fixtures", "migrations");

function runChecker(cwd) {
  return spawnSync(process.execPath, [checkerScript], { cwd, encoding: "utf8" });
}

test("a valid migration set is green", () => {
  const result = runChecker(path.join(fixturesRoot, "valid"));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No duplicate Supabase migration version prefixes/);
  assert.match(result.stdout, /checked 2 migration file\(s\)/);
});

test("different filenames sharing the same version prefix are deterministically red", () => {
  // This is the Issue #43 canonical failure mode: distinct filenames that
  // never conflict in Git but collide on Supabase's migration version
  // identity (the digits before the first underscore).
  const result = runChecker(path.join(fixturesRoot, "duplicate-version"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate Supabase migration version prefix detected/);
});

test("the failure diagnostic names the duplicate version and every colliding filename", () => {
  const result = runChecker(path.join(fixturesRoot, "duplicate-version"));
  assert.match(result.stderr, /version 20260822120000/);
  assert.match(result.stderr, /20260822120000_add_feature_a\.sql/);
  assert.match(result.stderr, /20260822120000_add_feature_b\.sql/);
});

test("nested subdirectories and non-migration files do not produce false positives", () => {
  // supabase/migrations/archive/20260101000000_create_widgets.sql shares its
  // version prefix with the top-level 20260101000000_create_widgets.sql, but
  // Supabase's own migration loader does not recurse into subdirectories, so
  // this must stay green. supabase/migrations/README.md does not match the
  // <digits>_name.sql pattern and must also be ignored.
  const result = runChecker(path.join(fixturesRoot, "nested-and-unrelated"));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /checked 1 migration file\(s\)/);
});

test("a repository with no supabase/migrations directory yet is green, not an error", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-dev-foundation-migrations-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const result = runChecker(temporaryRoot);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /checked 0 migration file\(s\)/);
});

test("the checker requires no DB, Docker, or Supabase CLI on PATH", () => {
  // A filesystem-only guardrail must not fail merely because no local
  // Supabase runtime is available — the whole point is to run before any
  // DB/Docker/Supabase startup step. spawnSync inherits this process's PATH
  // unchanged, so a pass here is direct evidence the checker did not shell
  // out to `supabase`, `docker`, or a database connection.
  const result = runChecker(path.join(fixturesRoot, "valid"));
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
});
