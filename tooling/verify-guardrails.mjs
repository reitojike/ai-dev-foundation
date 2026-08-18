import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import prettier from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(root, "test", "fixtures", "guardrails");
const profileConfig = path.join(root, "profiles", "next-supabase", "quality", "eslint.config.mjs");
const prettierConfig = path.join(root, "profiles", "next-supabase", "quality", "prettier.config.mjs");
const expectedFailures = new Set([
  "architecture-reverse-import",
  "no-any",
  "no-assertion",
  "no-non-null",
  "no-suppression",
]);

const fixtureNames = await readdir(fixturesRoot);
const profile = await import(pathToFileURL(profileConfig).href);
const prettierOptions = (await import(pathToFileURL(prettierConfig).href)).default;

for (const name of fixtureNames) {
  const fixture = path.join(fixturesRoot, name);
  const sourceDirectory = path.join(fixture, "src");
  const boundaryConfig = name === "architecture-reverse-import"
    ? [profile.architectureImportBoundary({
      files: ["src/shared/**/*.{ts,tsx}"],
      restrictedPatterns: ["../features/**", "../app/**", "@/features/**", "@/app/**"],
      message: "Fixture shared layer must not import higher layers.",
    })]
    : [];
  const eslint = new ESLint({
    cwd: fixture,
    overrideConfigFile: profileConfig,
    overrideConfig: boundaryConfig,
    ignore: false,
  });
  const lintResults = await eslint.lintFiles(["src"]);
  const errorCount = lintResults.reduce((total, result) => total + result.errorCount, 0);
  const shouldFail = expectedFailures.has(name);

  assert.equal(errorCount > 0, shouldFail, `${name}: lint outcome did not match expectation`);

  const typecheck = spawnSync(
    process.execPath,
    [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--project", fixture, "--pretty", "false"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(typecheck.status, 0, `${name}: TypeScript failed\n${typecheck.error ?? ""}${typecheck.stdout}${typecheck.stderr}`);

  for (const file of await readdir(sourceDirectory, { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue;
    const source = await readFile(path.join(sourceDirectory, file), "utf8");
    assert.equal(await prettier.check(source, { ...prettierOptions, filepath: file }), true, `${name}/${file}: not formatted`);
  }
}

console.log(`Verified ${fixtureNames.length} guardrail fixtures.`);
