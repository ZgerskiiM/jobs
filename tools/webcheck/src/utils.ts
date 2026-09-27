import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import type { AuditContext } from "./types.js";

export function hasFile(context: AuditContext, file: string): boolean {
  return context.files.has(file) || existsSync(join(context.cwd, file));
}

export function readProjectFile(context: AuditContext, file: string): string | undefined {
  const path = join(context.cwd, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function htmlHas(context: AuditContext, pattern: RegExp): boolean {
  return Boolean(context.rootHtml && pattern.test(context.rootHtml));
}

export function resourceUrl(context: AuditContext, path: string): string {
  return new URL(path, context.target).toString();
}

export async function fetchResource(context: AuditContext, path: string): Promise<Response | undefined> {
  if (!context.target) return undefined;
  const url = resourceUrl(context, path);
  if (context.remoteResources.has(url)) return context.remoteResources.get(url);
  if (context.failedResources.has(url)) return undefined;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "webcheck/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(6000)
    });
    context.remoteResources.set(url, response);
    return response;
  } catch {
    context.failedResources.add(url);
    return undefined;
  }
}

export function createCommandRunner(cwd: string) {
  return (command: string, timeoutMs = 120_000): Promise<{ code: number; output: string; timedOut?: boolean }> => new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;
    const maxOutputBytes = 64 * 1024;
    const append = (chunk: Buffer) => {
      if (outputBytes >= maxOutputBytes) return;
      const remaining = maxOutputBytes - outputBytes;
      const text = chunk.subarray(0, remaining).toString();
      output += text;
      outputBytes += Buffer.byteLength(text);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const finish = (result: { code: number; output: string; timedOut?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => finish({ code: 1, output, timedOut }));
    child.on("close", (code) => finish({ code: timedOut ? 124 : code ?? 1, output, timedOut }));
  });
}

export function listProjectFiles(cwd: string): Set<string> {
  const files = new Set<string>();
  const ignored = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  const walk = (directory: string) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.add(relative(cwd, absolute).replaceAll("\\", "/"));
    }
  };
  walk(cwd);
  return files;
}
