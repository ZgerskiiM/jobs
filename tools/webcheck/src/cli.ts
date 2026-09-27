#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { CONFIG_TEMPLATE, loadConfig } from "./config.js";
import { createContext, runAudit } from "./core/audit.js";
import { report } from "./core/reporter.js";
import { allChecks } from "./checks/index.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const ci = args.includes("--ci");

function help(): void {
  console.log(`WebCheck — practical web project audits

Usage:
  webcheck init
  webcheck audit [url] [--ci] [--config <path>]
  webcheck list

Commands:
  init       create .webcheck.yml
  audit      audit the current project or a deployed URL
  list       list available checks

Options:
  --config   use a specific config file (default: .webcheck.yml)
  --ci       exit with a non-zero code when required checks do not pass`);
}

function parseAuditArgs(values: string[]): { positionals: string[]; configPath?: string } {
  const positionals: string[] = [];
  let configPath: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--config") {
      if (configPath !== undefined) throw new Error("--config may only be supplied once");
      const next = values[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--config requires a file path");
      configPath = next;
      index += 1;
    } else if (value.startsWith("--config=")) {
      if (configPath !== undefined) throw new Error("--config may only be supplied once");
      configPath = value.slice("--config=".length);
      if (!configPath) throw new Error("--config requires a file path");
    } else if (!value.startsWith("--")) {
      positionals.push(value);
    }
  }
  if (positionals.length > 1) throw new Error("audit accepts at most one URL");
  return { positionals, configPath };
}

async function main(): Promise<void> {
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }

  if (command === "init") {
    const file = join(cwd(), ".webcheck.yml");
    if (existsSync(file)) {
      console.log(".webcheck.yml already exists; leaving it unchanged.");
      return;
    }
    writeFileSync(file, CONFIG_TEMPLATE, "utf8");
    console.log("Created .webcheck.yml");
    return;
  }

  if (command === "list") {
    console.log("Available checks:\n");
    for (const check of allChecks) console.log(`${check.category.padEnd(12)} ${check.severity.padEnd(8)} ${check.id} — ${check.name}`);
    return;
  }

  if (command === "audit") {
    try {
      const { positionals, configPath } = parseAuditArgs(args.slice(1));
      const context = await createContext(cwd(), positionals[0], configPath);
      const entries = await runAudit(context);
      const summary = report(entries, undefined, context.config.preset === "strict", context.config.requiredChecks);
      if (ci && summary.shouldFailCi) process.exitCode = 1;
    } catch (error) {
      console.error(`WebCheck: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  help();
  process.exitCode = 1;
}

void main();
