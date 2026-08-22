import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Mirrors supabase/cli's own migration filename parsing (migrateFilePattern
// in apps/cli-go/pkg/migration/file.go): version identity is the leading run
// of digits before the first underscore, and only direct .sql files in the
// migrations directory are considered migrations — ListLocalMigrations skips
// subdirectories rather than recursing into them, and skips any filename
// that doesn't match "<digits>_name.sql".
//
// Version identity is compared as a raw string, not a number: supabase/cli's
// own schema_migrations table declares `version text NOT NULL PRIMARY KEY`
// (apps/cli-go/pkg/migration/history.go), so Supabase's own collision check
// is a text-equality check, not a numeric one.
const MIGRATION_FILENAME_PATTERN = /^([0-9]+)_(.*)\.sql$/;
const migrationsDirectory = path.join(process.cwd(), 'supabase', 'migrations');

async function readMigrationFilenames(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    // No supabase/migrations directory yet is a valid, collision-free state.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  // Mirrors ListLocalMigrations' `if migration.IsDir() { continue }`: only
  // directories are excluded, not symlinks — Dirent.isFile() would also
  // silently exclude a migration file that exists as a symlink.
  return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
}

function groupFilenamesByVersion(filenames) {
  const filenamesByVersion = new Map();
  for (const filename of filenames) {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    if (!match) continue;
    const [, version] = match;
    const matchingFilenames = filenamesByVersion.get(version) ?? [];
    matchingFilenames.push(filename);
    filenamesByVersion.set(version, matchingFilenames);
  }
  return filenamesByVersion;
}

const filenames = await readMigrationFilenames(migrationsDirectory);
const filenamesByVersion = groupFilenamesByVersion(filenames);
const collisions = [...filenamesByVersion.entries()]
  .filter(([, matchingFilenames]) => matchingFilenames.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (collisions.length > 0) {
  console.error('Duplicate Supabase migration version prefix detected in supabase/migrations:');
  for (const [version, matchingFilenames] of collisions) {
    console.error(`  version ${version}:`);
    for (const filename of [...matchingFilenames].sort()) {
      console.error(`    - ${filename}`);
    }
  }
  console.error(
    'Each supabase/migrations file must have a unique <version>_name.sql prefix; rename one of the files above.',
  );
  process.exitCode = 1;
} else {
  const migrationCount = [...filenamesByVersion.values()].reduce(
    (total, group) => total + group.length,
    0,
  );
  console.log(
    `No duplicate Supabase migration version prefixes (checked ${migrationCount} migration file(s)).`,
  );
}
