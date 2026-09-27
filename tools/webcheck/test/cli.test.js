import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");

function runCli(args, cwd = root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("init creates a default config", async () => {
  const directory = mkdtempSync(join(tmpdir(), "webcheck-"));
  const result = await runCli(["init"], directory);
  assert.equal(result.code, 0);
  assert.match(readFileSync(join(directory, ".webcheck.yml"), "utf8"), /preset: default/);
});

test("remote audit checks HTML and resources", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/styles.css") {
      response.writeHead(200, { "content-type": "text/css", "content-length": "2048", "cache-control": "public, max-age=31536000" });
      response.end();
      return;
    }
    if (request.url === "/app.js") {
      response.writeHead(200, { "content-type": "application/javascript", "content-length": "2048" });
      response.end();
      return;
    }
    if (request.url === "/huge.png") {
      response.writeHead(200, { "content-type": "image/png", "content-length": "2000000", "cache-control": "public, max-age=31536000" });
      response.end();
      return;
    }
    if (request.url === "/missing.png") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *");
      return;
    }
    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<urlset><url><loc>https://example.com/</loc></url></urlset>");
      return;
    }
    if (request.url?.includes("webcheck-not-found-404")) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const html = `<!doctype html><html lang="en"><head><title>Test</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="Test page"><link rel="canonical" href="/">
      <link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/styles.css"><script src="/app.js"></script><meta property="og:title" content="Test">
      <meta property="og:description" content="Test"><meta property="og:image" content="/og.png">
    </head><body><a href="/docs" target="_blank">Docs</a><img src="/missing.png" alt="missing"><img src="/huge.png" alt="large">ok</body></html>`;
    response.writeHead(200, {
      "content-type": "text/html",
      "content-length": String(Buffer.byteLength(html)),
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'",
      "strict-transport-security": "max-age=60",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=()"
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const result = await runCli(["audit", `http://127.0.0.1:${address.port}`]);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /homepage returned HTTP 200 with text\/html/);
  assert.match(result.stdout, /internal page crawl: crawled 2 same-origin page\(s\)/);
  assert.match(result.stdout, /title present/);
  assert.match(result.stdout, /robots\.txt is available and has a User-agent directive/);
  assert.match(result.stdout, /404 page responds with 404/);
  assert.match(result.stdout, /security header quality: 2 security header quality issue/);
  assert.match(result.stdout, /viewport meta tag present/);
  assert.match(result.stdout, /new-tab link protection: 1 link\(s\) open a new tab/);
  assert.match(result.stdout, /1 of 5 resource\(s\) failed/);
  assert.match(result.stdout, /resource size: 1 resource size issue/);
  assert.match(result.stdout, /static resource\(s\) have no effective cache policy/);
  assert.match(result.stdout, /large text resource\(s\) are not compressed/);
});

test("remote audit reports a non-HTML homepage response", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const result = await runCli(["audit", `http://127.0.0.1:${address.port}`]);
  await new Promise((resolve) => server.close(resolve));
  assert.match(result.stdout, /homepage returned HTTP 503/);
});
