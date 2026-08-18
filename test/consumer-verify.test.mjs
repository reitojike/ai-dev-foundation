import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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

  for (const command of [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "build",
    "foundation:check",
    "verify:profile",
  ]) {
    assert.match(verifyCommand, new RegExp(`npm run ${command.replace(":", "\\:")}`));
    assert.equal(typeof packageJson.scripts[command], "string");
  }
});
