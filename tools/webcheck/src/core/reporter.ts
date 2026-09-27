import type { AuditEntry, CheckStatus } from "../types.js";

const symbols: Record<CheckStatus, string> = {
  pass: "✓",
  warning: "⚠",
  error: "✗",
  skipped: "○"
};

export interface ReportSummary {
  score: number;
  total: number;
  errors: number;
  warnings: number;
  shouldFailCi: boolean;
}

export function report(entries: AuditEntry[], color = process.stdout.isTTY, failOnWarning = false, requiredCheckIds: string[] = []): ReportSummary {
  const groups = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.check.category) ?? [];
    group.push(entry);
    groups.set(entry.check.category, group);
  }

  const paint = (value: string, code: number) => color ? `\u001b[${code}m${value}\u001b[0m` : value;
  console.log("\nWebCheck\n");
  for (const [category, group] of groups) {
    console.log(category);
    for (const { check, result } of group) {
      const line = `${symbols[result.status]} ${check.name}: ${result.message}`;
      const code = result.status === "error" ? 31 : result.status === "warning" ? 33 : result.status === "pass" ? 32 : 90;
      console.log(`  ${paint(line, code)}`);
      if (result.details) console.log(`    ${result.details.split(/\r?\n/)[0].slice(0, 160)}`);
    }
    console.log();
  }

  const evaluated = entries.filter(({ result }) => result.status !== "skipped");
  const score = evaluated.filter(({ result }) => result.status === "pass").length;
  const errors = entries.filter(({ result }) => result.status === "error").length;
  const warnings = entries.filter(({ result }) => result.status === "warning").length;
  const requiredFailures = requiredCheckIds.flatMap((id) => {
    const entry = entries.find(({ check }) => check.id === id);
    if (!entry) return [`${id} was not run`];
    if (entry.result.status !== "pass") return [`${id} ${entry.result.status}: ${entry.result.message}`];
    return [];
  });
  if (requiredFailures.length) {
    console.log("Required checks did not pass:");
    for (const failure of requiredFailures) console.log(`  ✗ ${failure}`);
  }
  const shouldFailCi = entries.some(({ check, result }) =>
    (result.status === "error" && ["critical", "error"].includes(check.severity)) ||
    (failOnWarning && result.status === "warning")
  ) || requiredFailures.length > 0;
  console.log(`Score: ${score}/${evaluated.length}`);
  console.log(`${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`);
  return { score, total: evaluated.length, errors, warnings, shouldFailCi };
}
