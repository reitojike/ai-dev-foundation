import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Foundation-owned safety boundary vs. consumer-owned permission matrix
// (Issue #44 security/design checkpoint):
//
// This checker only ever asserts about the four table-level privilege bits
// below. It never inspects, and must never be extended to inspect, SELECT /
// INSERT / UPDATE / DELETE (table- or column-level) — that permission
// matrix is entirely product-specific and stays consumer-owned (see
// profiles/next-supabase/quality/README.md). What makes TRUNCATE /
// REFERENCES / TRIGGER / MAINTAIN different is that none of them is ever
// part of an intended CRUD permission matrix for a PostgREST-style client
// role in the first place, so denying them requires no product knowledge:
//
// - TRUNCATE bypasses row level security entirely (confirmed defect,
//   stage-tracker#42 / reitojike/stage-tracker#49): a policy-only reading
//   of "is this table safe" cannot see it.
// - REFERENCES lets the grantee create a foreign key referencing the
//   table. PostgreSQL's own row security documentation names this a
//   covert channel: referential integrity checks always bypass row
//   security, so a crafted FK constraint can leak whether a specific key
//   value exists via the constraint-violation error, independent of any
//   policy.
// - TRIGGER lets the grantee attach a trigger to the table.
// - MAINTAIN (PostgreSQL 17+) permits VACUUM/ANALYZE/CLUSTER/REINDEX/
//   REFRESH MATERIALIZED VIEW — maintenance operations a client role never
//   needs, some of which can lock or rewrite the table.
//
// stage-tracker's real, hardened grant matrix (Issue #42/#49) holds none of
// these four on any of its public tables — there is no observed consumer
// need for an exception. Foundation therefore denies all four
// unconditionally, with no consumer exception/override mechanism in this
// change. Building a speculative escape hatch without an evidenced need
// would itself be the kind of premature machinery Foundation's own
// "先行実装しない" stance rejects; if a genuine need surfaces later, that is
// a new Foundation Observation / Change Proposal, not a preemptive default.
const ALWAYS_DENIED_PRIVILEGES = ['TRUNCATE', 'REFERENCES', 'TRIGGER'];

// has_table_privilege(role, table, 'MAINTAIN') raises "unrecognized
// privilege type" on a server older than PostgreSQL 17 (confirmed against
// postgres:15 while building this checker) — MAINTAIN did not exist before
// 17. Gating on the server's own reported version, rather than attempting
// the call and swallowing the error, keeps an older server's skip an
// explicit, positive diagnostic instead of a silently-caught failure that
// could just as easily hide a real connection problem.
const MAINTAIN_MIN_SERVER_VERSION_NUM = 170000;

// service_role and other administrative roles are deliberately excluded:
// they are not normal PostgREST client roles, and this checker must not
// treat them the same way (Issue #44 Invariants). 'public' is the
// PostgreSQL pseudo-role denoting PUBLIC — has_table_privilege('public',
// table, privilege) reports whether PUBLIC itself holds the privilege
// (confirmed empirically: distinct from, and not to be confused with, the
// `public` *schema*), which is the most severe case since it grants the
// privilege to literally every role.
const CLIENT_ROLES = ['anon', 'authenticated', 'public'];

// `supabase status -o json` is not safe to run concurrently — it rewrites
// the CLI's own ~/.supabase/telemetry.json through a temp file plus a
// rename, and a losing rename aborts the CLI outright. This is the same
// observed provider behavior already documented and retried in stage-
// tracker's test/rls/support/localSupabase.ts; carried over here bounded
// and unchanged now that this script also shells out to the same command.
const STATUS_ATTEMPTS = 5;
const STATUS_RETRY_BASE_MS = 150;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readDatabaseUrlFromSupabaseStatus() {
  let lastError;
  for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt += 1) {
    try {
      const raw = execFileSync('supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
        // Windows can only launch node_modules/.bin's supabase.cmd shim
        // through a shell (Node throws EINVAL otherwise); the args above
        // are static literals, not external input, so shell:true carries
        // no injection risk here.
        shell: process.platform === 'win32',
      });
      const parsed = JSON.parse(raw);
      if (typeof parsed.DB_URL !== 'string' || parsed.DB_URL.length === 0) {
        throw new Error('"supabase status -o json" did not report a DB_URL.');
      }
      return parsed.DB_URL;
    } catch (error) {
      lastError = error;
      sleep(STATUS_RETRY_BASE_MS * (attempt + 1) + Math.floor(Math.random() * 100));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Could not determine the local Supabase database URL: "supabase status -o json" failed ` +
      `${String(STATUS_ATTEMPTS)} times (last error: ${detail}). Is the local Supabase stack ` +
      `running ("supabase start")? Set SUPABASE_DB_URL to bypass this and connect directly.`,
  );
}

// SUPABASE_DB_URL is an explicit override, primarily for testing this
// checker against a database that is not a full local Supabase stack (see
// test/db/). Consumers running a normal local Supabase stack do not need
// to set it — the default path below discovers the URL the same way
// stage-tracker's own DB/RLS tests already do.
function resolveDatabaseUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  return readDatabaseUrlFromSupabaseStatus();
}

async function withPgClient(databaseUrl, run) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function requireClientRolesExist(client) {
  const roleNames = CLIENT_ROLES.filter((role) => role !== 'public');
  const { rows } = await client.query(
    `select rolname from pg_roles where rolname = any($1::text[])`,
    [roleNames],
  );
  const foundRoleNames = new Set(rows.map((row) => row.rolname));
  const missingRoleNames = roleNames.filter((role) => !foundRoleNames.has(role));
  if (missingRoleNames.length > 0) {
    throw new Error(
      `Role(s) ${missingRoleNames.map((role) => `"${role}"`).join(', ')} do not exist on this ` +
        `database. This checker expects the standard Supabase-provisioned client roles ` +
        `(anon, authenticated) to be present; is SUPABASE_DB_URL/the local Supabase stack ` +
        `pointed at a Supabase-managed database?`,
    );
  }
}

async function resolveDeniedPrivileges(client) {
  const { rows } = await client.query(`select current_setting('server_version_num') as version`);
  const serverVersionNum = Number.parseInt(rows[0].version, 10);
  if (serverVersionNum >= MAINTAIN_MIN_SERVER_VERSION_NUM) {
    return { privileges: [...ALWAYS_DENIED_PRIVILEGES, 'MAINTAIN'], serverVersionNum };
  }
  console.log(
    `Server version ${String(serverVersionNum)} is older than PostgreSQL 17 ` +
      `(${String(MAINTAIN_MIN_SERVER_VERSION_NUM)}); MAINTAIN does not exist on this server and is ` +
      `skipped. Checking: ${ALWAYS_DENIED_PRIVILEGES.join(', ')}.`,
  );
  return { privileges: [...ALWAYS_DENIED_PRIVILEGES], serverVersionNum };
}

async function findResidualPrivileges(client, deniedPrivileges) {
  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const { rows } = await client.query(
    `select t.tablename, r.role, p.privilege
     from pg_tables t
     cross join unnest($1::text[]) as r(role)
     cross join unnest($2::text[]) as p(privilege)
     where t.schemaname = 'public'
       and has_table_privilege(r.role, format('%I.%I', t.schemaname, t.tablename), p.privilege)
     order by t.tablename, r.role, p.privilege`,
    [CLIENT_ROLES, deniedPrivileges],
  );
  return { residual: rows, tableCount: tables.length };
}

function formatResidualLine(row) {
  return `${row.role} -> ${row.tablename}: ${row.privilege}`;
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  await withPgClient(databaseUrl, async (client) => {
    await requireClientRolesExist(client);
    const { privileges: deniedPrivileges, serverVersionNum } =
      await resolveDeniedPrivileges(client);
    const { residual, tableCount } = await findResidualPrivileges(client, deniedPrivileges);

    if (tableCount === 0) {
      console.log('No tables found in the public schema; nothing to inventory.');
      return;
    }

    if (residual.length > 0) {
      console.error(
        `Residual client-role table privilege(s) detected in the public schema ` +
          `(server_version_num ${String(serverVersionNum)}, checked ${String(tableCount)} table(s) for ` +
          `${deniedPrivileges.join(', ')}):`,
      );
      for (const row of residual) {
        console.error(`  ${formatResidualLine(row)}`);
      }
      console.error(
        'None of anon, authenticated, or PUBLIC may hold TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on ' +
          'any public schema table (Foundation Next.js + Supabase profile). Revoke the privilege(s) ' +
          'above, e.g.:\n' +
          '  revoke all on public.<table> from public, anon, authenticated;\n' +
          '  -- then re-grant only the SELECT/INSERT/UPDATE/DELETE this table actually intends.',
      );
      process.exitCode = 1;
    } else {
      console.log(
        `No residual ${deniedPrivileges.join('/')} for anon/authenticated/PUBLIC on any of ` +
          `${String(tableCount)} public schema table(s) (server_version_num ${String(serverVersionNum)}).`,
      );
    }
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
