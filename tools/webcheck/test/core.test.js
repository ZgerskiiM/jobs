import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../dist/config.js";
import { allChecks } from "../dist/checks/index.js";
import { envChecks } from "../dist/checks/deployment/project.js";
import { report } from "../dist/core/reporter.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist", "cli.js");

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("config defaults include distinct web and deployment categories", () => {
  assert.equal(DEFAULT_CONFIG.checks.web, true);
  assert.equal(DEFAULT_CONFIG.checks.deployment, true);
});

test("config accepts strict preset and category overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-config-"));
  try {
    writeFileSync(join(directory, ".webcheck.yml"), "preset: strict\nchecks:\n  web: false\n  seo: true\n");
    const config = loadConfig(directory);
    assert.equal(config.preset, "strict");
    assert.equal(config.checks.web, false);
    assert.equal(config.checks.seo, true);
    assert.equal(config.checks.security, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("config can be selected per audit and skipped required checks fail CI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-config-select-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("ok");
  });
  try {
    writeFileSync(join(directory, ".webcheck.remote.yml"), [
      "checks:",
      "  seo: false",
      "  security: false",
      "  accessibility: false",
      "  deployment: false",
      "  web: false",
      "  performance: false",
      "required-checks: web.homepage-response",
      ""
    ].join("\n"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await runCli([
      "audit", `http://127.0.0.1:${address.port}`, "--ci", "--config", ".webcheck.remote.yml"
    ], directory);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /web\.homepage-response was not run/);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("secret scan accepts placeholder env examples but still rejects token-like values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-secrets-"));
  const secretCheck = envChecks.find(({ id }) => id === "deployment.secrets");
  assert.ok(secretCheck);
  const file = join(directory, "backend", ".env.example");
  try {
    const context = {
      cwd: directory,
      files: new Set(["backend/.env.example"]),
      runCommand: async () => ({ code: 1, output: "" })
    };
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(directory, "backend")));
    writeFileSync(file, "TELEGRAM_SYNC_TOKEN=change-this-to-a-long-random-placeholder-value\n");
    assert.equal((await secretCheck.run(context)).status, "pass");
    writeFileSync(file, "TELEGRAM_SYNC_TOKEN=abcdefghijklmnopqrstuvwxyz123456\n");
    assert.equal((await secretCheck.run(context)).status, "error");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("private env check includes nested files and excludes tracked examples", async () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-env-files-"));
  const envCheck = allChecks.find(({ id }) => id === "deployment.env-ignored");
  assert.ok(envCheck);
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(directory, "backend")));
    writeFileSync(join(directory, ".gitignore"), ".env\n.env.*\n!.env.example\n");
    writeFileSync(join(directory, "backend", ".env"), "TOKEN=private\n");
    const context = {
      cwd: directory,
      files: new Set([".gitignore", "backend/.env"]),
      trackedFiles: "",
      runCommand: async () => ({ code: 0, output: context.trackedFiles })
    };
    assert.equal((await envCheck.run(context)).status, "pass");
    context.trackedFiles = "backend/.env\0";
    assert.equal((await envCheck.run(context)).status, "error");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("config rejects malformed or unknown options with a line number", () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-config-"));
  try {
    writeFileSync(join(directory, ".webcheck.yml"), "preset: default\n+\nchecks:\n  web: true\n");
    assert.throws(() => loadConfig(directory), /Invalid \.webcheck\.yml:2/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict preset makes warnings fail CI and default mode does not", () => {
  const entry = {
    check: { id: "example", name: "example", category: "SEO", severity: "warning", run: async () => ({ status: "warning", message: "issue" }) },
    result: { status: "warning", message: "issue" }
  };
  const original = console.log;
  console.log = () => {};
  try {
    assert.equal(report([entry], false, false).shouldFailCi, false);
    assert.equal(report([entry], false, true).shouldFailCi, true);
  } finally {
    console.log = original;
  }
});

test("CLI --ci respects default and strict warning thresholds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-ci-"));
  try {
    const baseConfig = "checks:\n  seo: false\n  security: false\n  accessibility: false\n  deployment: true\n  web: false\n  performance: false\n";
    writeFileSync(join(directory, ".webcheck.yml"), `preset: default\n${baseConfig}`);
    const defaultResult = await runCli(["audit", "--ci"], directory);
    assert.equal(defaultResult.code, 0);

    writeFileSync(join(directory, ".webcheck.yml"), `preset: strict\n${baseConfig}`);
    const strictResult = await runCli(["audit", "--ci"], directory);
    assert.equal(strictResult.code, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("registered checks have unique IDs and include the new crawl and accessibility audits", () => {
  const ids = allChecks.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("web.site-crawl"));
  assert.ok(ids.includes("accessibility.headings"));
  assert.ok(ids.includes("accessibility.browser-audit"));
  assert.ok(ids.includes("seo.site-metadata"));
  assert.ok(ids.length >= 50);
});
