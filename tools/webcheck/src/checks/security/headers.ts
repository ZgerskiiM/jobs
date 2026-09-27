import type { Check } from "../../types.js";
import { header, pass, skipped, warning } from "../helpers.js";

const names = [
  ["security.csp", "Content-Security-Policy"],
  ["security.content-type", "X-Content-Type-Options"],
  ["security.referrer", "Referrer-Policy"],
  ["security.permissions", "Permissions-Policy"],
  ["security.hsts", "Strict-Transport-Security"]
] as const;

export const headerChecks: Check[] = names.map(([id, name]) => ({
  id,
  name,
  category: "Security",
  severity: "error",
  async run(context) {
    if (name === "Strict-Transport-Security" && (context.finalUrl ?? context.target)?.protocol !== "https:") {
      return skipped("HTTPS required for HSTS");
    }
    return header(context, name);
  }
}));

export const headerQualityCheck: Check = {
  id: "security.header-quality",
  name: "security header quality",
  category: "Security",
  severity: "warning",
  async run(context) {
    if (!context.target) return skipped("deployed site required");
    const headers = context.rootResponse?.headers;
    if (!headers) return skipped("homepage response unavailable");
    const issues: string[] = [];
    const csp = headers.get("content-security-policy");
    if (headers.has("content-security-policy")) {
      if (!csp?.trim()) issues.push("CSP is empty");
      else if (/(?:^|;)\s*script-src\b[^;]*(?:'unsafe-eval'|unsafe-eval)(?:\s|;|$)/i.test(csp)) issues.push("CSP allows unsafe-eval");
      else if (/(?:^|;)\s*script-src\b[^;]*'unsafe-inline'/i.test(csp)) issues.push("CSP allows unsafe-inline scripts");
      if (csp && /(?:^|;)\s*(?:default-src|script-src|style-src)\b[^;]*\*/i.test(csp)) issues.push("CSP contains a wildcard source");
    }

    const hsts = headers.get("strict-transport-security");
    if ((context.finalUrl ?? context.target)?.protocol === "https:" && headers.has("strict-transport-security")) {
      const maxAge = hsts?.match(/(?:^|;)\s*max-age\s*=\s*(\d+)/i)?.[1];
      if (!maxAge) issues.push("HSTS max-age is missing or invalid");
      else if (Number(maxAge) < 15_552_000) issues.push("HSTS max-age is shorter than 180 days");
    }

    const contentType = headers.get("x-content-type-options");
    if (contentType && contentType.trim().toLowerCase() !== "nosniff") issues.push("X-Content-Type-Options should be nosniff");

    const hasFrameProtection = headers.has("x-frame-options") || /(?:^|;)\s*frame-ancestors\b/i.test(csp ?? "");
    if (!hasFrameProtection) issues.push("clickjacking protection is missing (X-Frame-Options or CSP frame-ancestors)");
    if (/unsafe-url/i.test(headers.get("referrer-policy") ?? "")) issues.push("Referrer-Policy exposes full URLs");

    return issues.length
      ? { status: "warning", message: `${issues.length} security header quality issue(s)`, details: issues.join("; ") }
      : pass("present security headers meet the basic value checks");
  }
};
