import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allChecks } from "../checks/index.js";
import { loadConfig } from "../config.js";
import { createCommandRunner, listProjectFiles } from "../utils.js";
import type { AuditContext, AuditEntry, Check } from "../types.js";

export async function createContext(cwd: string, targetInput?: string, configPath = ".webcheck.yml"): Promise<AuditContext> {
  const target = targetInput ? new URL(targetInput) : undefined;
  if (target && !["http:", "https:"].includes(target.protocol)) {
    throw new Error("URL must use http:// or https://");
  }

  const context: AuditContext = {
    cwd,
    target,
    config: loadConfig(cwd, configPath),
    remoteResources: new Map(),
    resourceAudit: new Map(),
    failedResources: new Set(),
    files: listProjectFiles(cwd),
    runCommand: createCommandRunner(cwd),
    resolve: (...parts) => resolve(cwd, ...parts)
  };

  const packagePath = join(cwd, "package.json");
  if (existsSync(packagePath)) {
    try { context.packageJson = JSON.parse(readFileSync(packagePath, "utf8")); } catch { /* handled by build checks */ }
  }

  if (target) {
    await loadRemotePage(context);
  } else {
    const candidates = ["index.html", "public/index.html", "src/index.html", "app/index.html"];
    const index = candidates.find((file) => context.files.has(file));
    if (index) context.rootHtml = readFileSync(join(cwd, index), "utf8");
  }
  return context;
}

async function loadRemotePage(context: AuditContext): Promise<void> {
  if (!context.target) return;
  const inputUrl = context.target.toString();
  if (context.target.protocol === "http:") {
    try {
      context.initialResponse = await fetch(inputUrl, {
        redirect: "manual",
        headers: { "user-agent": "webcheck/0.1" },
        signal: AbortSignal.timeout(6000)
      });
      const location = context.initialResponse.headers.get("location");
      context.httpRedirect = context.initialResponse.status >= 300 && context.initialResponse.status < 400 && Boolean(location && new URL(location, inputUrl).protocol === "https:");
    } catch {
      context.initialResponse = undefined;
      context.httpRedirect = false;
    }
  }

  const startedAt = Date.now();
  try {
    context.rootResponse = await fetch(inputUrl, {
      redirect: "follow",
      headers: { "user-agent": "webcheck/0.1" },
      signal: AbortSignal.timeout(10000)
    });
    context.rootHtml = await context.rootResponse.text();
    context.finalUrl = new URL(context.rootResponse.url || inputUrl);
  } catch {
    context.rootResponse = undefined;
    context.rootHtml = "";
  } finally {
    context.homepageResponseTimeMs = Date.now() - startedAt;
  }
}

function categoryEnabled(context: AuditContext, check: Check): boolean {
  const key = check.category.toLowerCase();
  return context.config.checks[key] !== false;
}

export async function runAudit(context: AuditContext): Promise<AuditEntry[]> {
  const selected = allChecks.filter((check) => categoryEnabled(context, check));
  const entries: AuditEntry[] = [];
  for (const check of selected) {
    try {
      entries.push({ check, result: await check.run(context) });
    } catch (error) {
      entries.push({
        check,
        result: { status: "error", message: `${check.name} failed`, details: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  return entries;
}
