import type { Check } from "../../types.js";
import { hasFile } from "../../utils.js";
import { error, pass, skipped, warning } from "../helpers.js";

type AuditReport = {
  vulnerabilities?: {
    critical?: number;
    high?: number;
    moderate?: number;
    low?: number;
    info?: number;
    total?: number;
  };
};

export const dependencyAuditCheck: Check = {
  id: "security.dependency-audit",
  name: "production dependency vulnerabilities",
  category: "Security",
  severity: "error",
  async run(context) {
    if (context.target) return skipped("local project required");
    if (!context.packageJson) return skipped("package.json not found");
    if (!hasFile(context, "package-lock.json") && !hasFile(context, "npm-shrinkwrap.json")) {
      return skipped("npm lockfile not found; dependency audit requires a reproducible npm dependency tree");
    }

    const result = await context.runCommand("npm audit --omit=dev --json", 120_000);
    let audit: AuditReport | undefined;
    try {
      const start = result.output.indexOf("{");
      if (start >= 0) audit = JSON.parse(result.output.slice(start)) as AuditReport;
    } catch { /* npm may have returned a network or registry error instead of audit JSON */ }

    const counts = audit?.vulnerabilities;
    if (!counts) {
      const detail = result.timedOut
        ? "npm audit timed out after 2 minutes"
        : result.output.split(/\r?\n/).find((line) => line.trim())?.slice(0, 180) ?? "npm audit returned no JSON report";
      return error(`dependency audit could not complete (exit code ${result.code})`, detail);
    }

    const critical = counts.critical ?? 0;
    const high = counts.high ?? 0;
    const moderate = counts.moderate ?? 0;
    const low = counts.low ?? 0;
    const total = counts.total ?? critical + high + moderate + low + (counts.info ?? 0);
    if (critical || high) {
      return error(`${critical} critical and ${high} high vulnerability finding(s) in production dependencies`, `npm audit reported ${total} finding(s) total`);
    }
    if (moderate || low) {
      return warning(`${moderate} moderate and ${low} low vulnerability finding(s) in production dependencies`);
    }
    return pass("no production dependency vulnerabilities found by npm audit");
  }
};
