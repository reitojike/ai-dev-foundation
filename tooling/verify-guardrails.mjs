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
const expectedLintFailures = new Map([
  ["architecture-reverse-import", { ruleId: "no-restricted-imports", minimumCount: 4 }],
  ["no-any", { ruleId: "@typescript-eslint/no-explicit-any", minimumCount: 1 }],
  ["no-assertion", { ruleId: "no-restricted-syntax", minimumCount: 2 }],
  ["no-non-null", { ruleId: "@typescript-eslint/no-non-null-assertion", minimumCount: 1 }],
  ["no-suppression", { ruleId: "foundation/no-suppression", minimumCount: 2 }],
]);
const expectedTypecheckFailures = new Map([["strict-typecheck", "TS7006"]]);
const expectedPrettierFailures = new Set(["no-prettier"]);

const fixtureNames = await readdir(fixturesRoot);
const profile = await import(pathToFileURL(profileConfig).href);
const prettierOptions = (await import(pathToFileURL(prettierConfig).href)).default;
const profilePrettier = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "prettier", "bin", "prettier.cjs"),
    "--config",
    prettierConfig,
    "--check",
    path.dirname(profileConfig),
  ],
  { cwd: root, encoding: "utf8" },
);
assert.equal(
  profilePrettier.status,
  0,
  `quality profile is not Prettier-compatible\n${profilePrettier.stdout}${profilePrettier.stderr}`,
);

for (const name of fixtureNames) {
  const fixture = path.join(fixturesRoot, name);
  const sourceDirectory = path.join(fixture, "src");
  const boundaryConfig = name === "architecture-reverse-import"
    ? [profile.architectureImportBoundary({
      files: ["src/shared/**/*.{ts,tsx}"],
      // Depth-independent, anchored patterns (see profiles/next-supabase/quality/README.md):
      // "../**/features" (and "/**") matches a restricted import regardless of how deep the
      // importing shared-layer file is nested, unlike a bare "../features/**" pattern which
      // only matches a direct sibling import.
      restrictedPatterns: [
        "../**/features",
        "../**/features/**",
        "../**/app",
        "../**/app/**",
        "@/features",
        "@/features/**",
        "@/app",
        "@/app/**",
      ],
      message: "Fixture shared layer must not import higher layers.",
    })]
    : [];
  const eslint = new ESLint({
    cwd: fixture,
    overrideConfigFile: profileConfig,
    overrideConfig: boundaryConfig,
    ignore: false,
  });
  const lintResults = await eslint.lintFiles(name === "valid" ? ["src", "eslint.config.mjs"] : ["src"]);
  const lintRuleIds = lintResults.flatMap((result) => result.messages)
    .filter((message) => message.severity === 2)
    .map((message) => message.ruleId);
  const expectedLintFailure = expectedLintFailures.get(name);

  if (expectedLintFailure) {
    const matchingCount = lintRuleIds.filter((ruleId) => ruleId === expectedLintFailure.ruleId).length;
    assert.ok(
      matchingCount >= expectedLintFailure.minimumCount,
      `${name}: expected ${expectedLintFailure.ruleId} at least ${expectedLintFailure.minimumCount} time(s), got ${lintRuleIds.join(", ") || "no ESLint errors"}`,
    );
  } else {
    assert.deepEqual(lintRuleIds, [], `${name}: unexpected ESLint errors: ${lintRuleIds.join(", ")}`);
  }

  const typecheck = spawnSync(
    process.execPath,
    [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--project", fixture, "--pretty", "false"],
    { cwd: root, encoding: "utf8" },
  );
  const typecheckFailed = typecheck.status !== 0;
  const expectedTypecheckDiagnostic = expectedTypecheckFailures.get(name);
  assert.equal(
    typecheckFailed,
    expectedTypecheckDiagnostic !== undefined,
    `${name}: TypeScript outcome did not match expectation\n${typecheck.error ?? ""}${typecheck.stdout}${typecheck.stderr}`,
  );
  if (expectedTypecheckDiagnostic) {
    assert.match(
      `${typecheck.stdout}${typecheck.stderr}`,
      new RegExp(expectedTypecheckDiagnostic),
      `${name}: expected TypeScript diagnostic ${expectedTypecheckDiagnostic}`,
    );
  }

  for (const file of await readdir(sourceDirectory, { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue;
    const source = await readFile(path.join(sourceDirectory, file), "utf8");
    assert.equal(
      await prettier.check(source, { ...prettierOptions, filepath: file }),
      !expectedPrettierFailures.has(name),
      `${name}/${file}: Prettier outcome did not match expectation`,
    );
  }
}

console.log(`Verified ${fixtureNames.length} guardrail fixtures.`);
