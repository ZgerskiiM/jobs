import type { AuditContext, CheckResult } from "../types.js";

export const skipped = (message: string): CheckResult => ({ status: "skipped", message });
export const pass = (message: string): CheckResult => ({ status: "pass", message });
export const warning = (message: string): CheckResult => ({ status: "warning", message });
export const error = (message: string, details?: string): CheckResult => ({ status: "error", message, details });

export function remote(context: AuditContext): boolean {
  return Boolean(context.target);
}

export function header(context: AuditContext, name: string): CheckResult {
  if (!remote(context)) return skipped("deployed site required");
  return context.rootResponse?.headers.has(name)
    ? pass(`${name} present`)
    : error(`${name} missing`);
}

export function statusIsOk(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 400;
}
