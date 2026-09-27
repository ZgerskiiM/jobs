import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { WebcheckConfig } from "./types.js";

export const DEFAULT_CONFIG: WebcheckConfig = {
  preset: "default",
  checks: { seo: true, security: true, accessibility: true, deployment: true, web: true, performance: true },
  requiredChecks: []
};

export const CONFIG_TEMPLATE = [
  "preset: default",
  "",
  "checks:",
  "  seo: true",
  "  security: true",
  "  accessibility: true",
  "  deployment: true",
  "  web: true",
  "  performance: true",
  "",
  "# Comma-separated check IDs that must pass (a skipped check fails the CI gate).",
  "# required-checks: deployment.tests,security.dependency-audit",
  ""
].join("\n");

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function loadConfig(cwd: string, configPath = ".webcheck.yml"): WebcheckConfig {
  const file = resolve(cwd, configPath);
  const label = relative(cwd, file).replace(/\\/g, "/") || configPath;
  if (!existsSync(file)) return structuredClone(DEFAULT_CONFIG);

  const config = structuredClone(DEFAULT_CONFIG);
  const validKeys = new Set(Object.keys(config.checks));
  const seen = new Set<string>();
  let inChecks = false;
  for (const [index, rawLine] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^checks:\s*$/.test(line)) {
      if (inChecks) throw new Error(`Invalid ${label}:${index + 1}: duplicate checks section`);
      inChecks = true;
      continue;
    }
    const match = line.match(/^(\s*)([\w-]+):\s*(.*?)\s*$/);
    if (!match) throw new Error(`Invalid ${label}:${index + 1}: expected "key: value"`);
    const [, indent, key, rawValue] = match;
    if (inChecks && !indent) inChecks = false;
    if (inChecks) {
      if (!/^\s{2,}$/.test(indent)) throw new Error(`Invalid ${label}:${index + 1}: check options must be indented`);
      if (!validKeys.has(key)) throw new Error(`Invalid ${label}:${index + 1}: unknown check category "${key}"`);
      if (seen.has(key)) throw new Error(`Invalid ${label}:${index + 1}: duplicate category "${key}"`);
      const value = parseBoolean(rawValue);
      if (value === undefined) throw new Error(`Invalid ${label}:${index + 1}: ${key} must be true or false`);
      config.checks[key] = value;
      seen.add(key);
    } else {
      if (indent) throw new Error(`Invalid ${label}:${index + 1}: unexpected indentation`);
      if (key === "required-checks") {
        if (seen.has(key)) throw new Error(`Invalid ${label}:${index + 1}: duplicate required-checks`);
        const ids = rawValue.split(",").map((id) => id.trim()).filter(Boolean);
        if (ids.some((id) => !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/i.test(id))) {
          throw new Error(`Invalid ${label}:${index + 1}: required-checks must be comma-separated check IDs`);
        }
        if (new Set(ids).size !== ids.length) throw new Error(`Invalid ${label}:${index + 1}: duplicate required check ID`);
        config.requiredChecks = ids;
        seen.add(key);
        continue;
      }
      if (key !== "preset") throw new Error(`Invalid ${label}:${index + 1}: unknown setting "${key}"`);
      if (seen.has(key)) throw new Error(`Invalid ${label}:${index + 1}: duplicate preset`);
      if (!["default", "strict"].includes(rawValue)) throw new Error(`Invalid ${label}:${index + 1}: preset must be default or strict`);
      config.preset = rawValue;
      seen.add(key);
    }
  }
  return config;
}
