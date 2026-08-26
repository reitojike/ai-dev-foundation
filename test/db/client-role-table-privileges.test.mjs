// Positive/negative guardrail proof for
// profiles/next-supabase/quality/check-client-role-table-privileges.mjs
// (Issue #44). Unlike every other test/*.test.mjs in this repo, this file
// needs an actual PostgreSQL server to exercise real has_table_privilege /
// server-version semantics, not just filesystem fixtures. It therefore:
//
//  - lives under test/db/, not test/, so the top-level `npm test`
//    (`test/*.test.mjs`, non-recursive) does not pick it up and does not
//    require Docker;
//  - is run explicitly via `npm run test:client-role-table-privileges-guardrail`;
//  - manages its own disposable, randomly-named, dynamically-ported
//    PostgreSQL containers, so it cannot collide with any other checkout's
//    or session's Docker resources (including a running Supabase local
//    stack) on the same machine, and requires no pre-existing local
//    Supabase stack itself.
//
// Skips (does not fail) when Docker is unavailable, mirroring the platform
// -capability skip already used for the symlink case in
// test/migration-version-collision.test.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkerScript = path.join(
  root,
  'profiles',
  'next-supabase',
  'quality',
  'check-client-role-table-privileges.mjs',
);
const fixturesRoot = path.join(root, 'test', 'fixtures', 'client-role-table-privileges');

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function dockerAvailable() {
  return spawnSync('docker', ['info'], { encoding: 'utf8' }).status === 0;
}

function startPostgresContainer(image) {
  const name = `ai-dev-foundation-privileges-test-${process.pid}-${Date.now()}`;
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      '0:5432',
      image,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    throw new Error(`Failed to start ${image}: ${run.stderr}`);
  }

  const stop = () => {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  };

  try {
    const portResult = spawnSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' });
    const firstLine = portResult.stdout.trim().split('\n')[0] ?? '';
    const match = /:(\d+)\s*$/.exec(firstLine);
    if (!match) {
      throw new Error(
        `Could not determine host port for ${name}: ${portResult.stdout}${portResult.stderr}`,
      );
    }
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${match[1]}/postgres`;

    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (
        spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' })
          .status === 0
      ) {
        ready = true;
        break;
      }
      sleep(500);
    }
    if (!ready) {
      throw new Error(`${name} did not become ready within 30s`);
    }

    return { databaseUrl, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

async function withClient(databaseUrl, run) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function resetPublicSchemaWithClientRoles(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    await client.query('drop schema public cascade; create schema public;');
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
      end
      $$;
    `);
  });
}

async function applyFixture(databaseUrl, fixtureName) {
  const sql = await readFile(path.join(fixturesRoot, `${fixtureName}.sql`), 'utf8');
  await withClient(databaseUrl, (client) => client.query(sql));
}

function runChecker(databaseUrl) {
  return spawnSync(process.execPath, [checkerScript], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_DB_URL: databaseUrl },
  });
}

if (!dockerAvailable()) {
  test('client-role table privilege guardrail (skipped: Docker unavailable)', (t) => {
    t.skip('Docker is required to exercise this checker against a real PostgreSQL server');
  });
} else {
  test('client-role table privilege guardrail', async (t) => {
    const pg17 = startPostgresContainer('postgres:17');
    t.after(pg17.stop);

    await t.test('a clean grant set (SELECT only) is green', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      await applyFixture(pg17.databaseUrl, 'clean');
      const result = runChecker(pg17.databaseUrl);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /No residual TRUNCATE\/REFERENCES\/TRIGGER\/MAINTAIN/);
    });

    await t.test('an empty public schema (no tables) is green, not an error', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      const result = runChecker(pg17.databaseUrl);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /nothing to inventory/);
    });

    await t.test(
      'anon holding TRUNCATE is deterministically red and named in the diagnostic',
      async () => {
        await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
        await applyFixture(pg17.databaseUrl, 'residual-truncate');
        const result = runChecker(pg17.databaseUrl);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /anon -> orders: TRUNCATE/);
      },
    );

    await t.test('authenticated holding REFERENCES is deterministically red', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      await applyFixture(pg17.databaseUrl, 'residual-references');
      const result = runChecker(pg17.databaseUrl);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /authenticated -> orders: REFERENCES/);
    });

    await t.test('authenticated holding TRIGGER is deterministically red', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      await applyFixture(pg17.databaseUrl, 'residual-trigger');
      const result = runChecker(pg17.databaseUrl);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /authenticated -> orders: TRIGGER/);
    });

    await t.test('anon holding MAINTAIN is deterministically red on PostgreSQL 17+', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      await applyFixture(pg17.databaseUrl, 'residual-maintain');
      const result = runChecker(pg17.databaseUrl);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /anon -> orders: MAINTAIN/);
    });

    await t.test(
      'a table whose name requires quoting (mixed-case) is still checked, not silently skipped or crashed',
      async () => {
        // Regression for a Claude review finding on this PR: the table
        // argument to has_table_privilege was originally built via unquoted
        // string concatenation ('public.' || t.tablename). Postgres's
        // regclass parsing of an unquoted identifier lowercases it, so a
        // stored table name that is not already all-lowercase - only
        // reachable via a quoted identifier at CREATE TABLE time, e.g.
        // Prisma-style "Users" - resolved to the wrong (usually
        // nonexistent) relation, either erroring the whole cross-join query
        // (masking every other table's check) or, if a same-named lowercase
        // table happened to exist, silently checking the wrong one. Fixed
        // by format('%I.%I', schema, table) to properly quote both parts.
        await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
        await applyFixture(pg17.databaseUrl, 'mixed-case-quoted-table');
        const result = runChecker(pg17.databaseUrl);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stderr, /authenticated -> Users: TRIGGER/);
      },
    );

    await t.test(
      'a grant to the PUBLIC pseudo-role is detected for PUBLIC and propagates to anon/authenticated',
      async () => {
        // Confirms the Issue #44 design-checkpoint decision to check the
        // PUBLIC pseudo-role itself, not just anon/authenticated: granting to
        // PUBLIC is the most severe case (every role gains the privilege),
        // and has_table_privilege(role, ...) resolves privileges anon/
        // authenticated inherit via PUBLIC, so both effects must be visible.
        await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
        await applyFixture(pg17.databaseUrl, 'residual-public-pseudo-role');
        const result = runChecker(pg17.databaseUrl);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /public -> orders: TRUNCATE/);
        assert.match(result.stderr, /anon -> orders: TRUNCATE/);
        assert.match(result.stderr, /authenticated -> orders: TRUNCATE/);
      },
    );

    await t.test(
      'a residual privilege on one table does not false-positive an unrelated clean table',
      async () => {
        await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
        await applyFixture(pg17.databaseUrl, 'mixed-clean-and-residual');
        const result = runChecker(pg17.databaseUrl);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /authenticated -> leaky_table: TRIGGER/);
        assert.doesNotMatch(result.stderr, /clean_table/);
      },
    );

    await t.test('the failure diagnostic includes remediating guidance', async () => {
      await resetPublicSchemaWithClientRoles(pg17.databaseUrl);
      await applyFixture(pg17.databaseUrl, 'residual-truncate');
      const result = runChecker(pg17.databaseUrl);
      assert.match(result.stderr, /revoke all on public\.<table> from public, anon, authenticated/);
    });

    await t.test(
      'a database missing the Supabase client roles fails with a clear diagnostic, not a stack trace',
      async () => {
        const bareContainer = startPostgresContainer('postgres:17');
        try {
          const result = runChecker(bareContainer.databaseUrl);
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /Role\(s\) "anon", "authenticated" do not exist/);
          assert.doesNotMatch(result.stderr, /at requireClientRolesExist/);
        } finally {
          bareContainer.stop();
        }
      },
    );

    await t.test(
      'MAINTAIN is version-gated and explicitly skipped, not crashed, before PostgreSQL 17',
      async () => {
        // has_table_privilege(role, table, 'MAINTAIN') raises "unrecognized
        // privilege type" before PostgreSQL 17 (MAINTAIN did not exist yet) -
        // confirmed against postgres:15 while building this checker. A
        // consumer pinned to an older server must still get a clean pass
        // (for TRUNCATE/REFERENCES/TRIGGER) with an explicit skip note, not a
        // crash.
        const pg15 = startPostgresContainer('postgres:15');
        try {
          await resetPublicSchemaWithClientRoles(pg15.databaseUrl);
          await applyFixture(pg15.databaseUrl, 'clean');
          const result = runChecker(pg15.databaseUrl);
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assert.match(result.stdout, /older than PostgreSQL 17/);
          assert.match(result.stdout, /MAINTAIN does not exist on this server and is skipped/);
          assert.match(result.stdout, /No residual TRUNCATE\/REFERENCES\/TRIGGER for/);
        } finally {
          pg15.stop();
        }
      },
    );
  });
}
