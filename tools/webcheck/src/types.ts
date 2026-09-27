import type { PathLike } from "node:fs";

export type Severity = "critical" | "error" | "warning" | "info";
export type CheckStatus = "pass" | "warning" | "error" | "skipped";

export interface CheckResult {
  status: CheckStatus;
  message: string;
  details?: string;
}

export interface Check {
  id: string;
  name: string;
  category: string;
  severity: Severity;
  run(context: AuditContext): Promise<CheckResult>;
}

export interface WebcheckConfig {
  preset: string;
  checks: Record<string, boolean>;
  requiredChecks: string[];
}

export interface AuditContext {
  cwd: string;
  target?: URL;
  config: WebcheckConfig;
  rootResponse?: Response;
  rootHtml?: string;
  homepageResponseTimeMs?: number;
  crawledPages?: Array<{ url: URL; status?: number; html: string }>;
  crawlTruncated?: boolean;
  initialResponse?: Response;
  httpRedirect?: boolean;
  notFoundResponse?: Response;
  finalUrl?: URL;
  remoteResources: Map<string, Response>;
  resourceAudit: Map<string, { status?: number; headers: Headers }>;
  failedResources: Set<string>;
  files: Set<string>;
  packageJson?: { scripts?: Record<string, string> };
  runCommand(command: string, timeoutMs?: number): Promise<{ code: number; output: string; timedOut?: boolean }>;
  resolve(...parts: string[]): PathLike;
}

export interface AuditEntry {
  check: Check;
  result: CheckResult;
}
