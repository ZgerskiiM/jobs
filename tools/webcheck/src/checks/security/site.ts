import type { AuditContext, Check, CheckResult } from "../../types.js";
import { pass, skipped } from "../helpers.js";

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function elements(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function insecureReferences(html: string, base: URL): string[] {
  const refs = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const candidate of raw.split(",")) {
      const value = candidate.trim().split(/\s+/)[0];
      try {
        const url = new URL(value, base);
        if (url.protocol === "http:") refs.add(url.toString());
      } catch { /* ignore malformed or non-URL attributes */ }
    }
  };

  for (const name of ["img", "script", "iframe", "source", "audio", "video", "track", "embed"]) {
    for (const tag of elements(html, name)) {
      add(attr(tag, "src"));
      if (name === "video") add(attr(tag, "poster"));
      add(attr(tag, "srcset"));
    }
  }
  for (const tag of elements(html, "link")) {
    const rel = attr(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    if (rel.some((value) => ["stylesheet", "icon", "preload", "modulepreload"].includes(value))) add(attr(tag, "href"));
  }

  for (const match of html.matchAll(/(?:url\(\s*["']?|@import\s+["']?)((?:http:\/\/)[^\s"')]+)/gi)) {
    add(match[1]);
  }
  return [...refs];
}

function cookieStrings(context: AuditContext): string[] {
  const headers = context.rootResponse?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,\s*(?=[^;,\s]+=)/) : [];
}

function cookieIssues(cookies: string[], secureSite: boolean): string[] {
  const issues: string[] = [];
  for (const cookie of cookies) {
    const [pair = "", ...attrs] = cookie.split(";").map((part) => part.trim());
    const name = pair.split("=", 1)[0] || "unnamed";
    const normalized = attrs.map((value) => value.toLowerCase());
    const missing: string[] = [];
    if (secureSite && !normalized.includes("secure")) missing.push("Secure");
    if (!normalized.some((value) => value.startsWith("samesite="))) missing.push("SameSite");
    if (/(?:session|auth|token|refresh|access)/i.test(name) && !normalized.includes("httponly")) missing.push("HttpOnly");
    if (missing.length) issues.push(`${name}: missing ${missing.join(", ")}`);
  }
  return issues;
}

export const securitySiteChecks: Check[] = [
  {
    id: "security.target-blank",
    name: "new-tab link protection",
    category: "Security",
    severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped(context.target ? "page HTML unavailable" : "HTML entry page not found");
      const unsafe = [...context.rootHtml.matchAll(/<a\b[^>]*>/gi)].filter(([tag]) => {
        if (attr(tag, "target")?.toLowerCase() !== "_blank") return false;
        const rel = attr(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
        return !rel.includes("noopener") && !rel.includes("noreferrer");
      });
      return unsafe.length
        ? { status: "warning", message: `${unsafe.length} link(s) open a new tab without rel=noopener or noreferrer` }
        : pass("new-tab links include rel=noopener or noreferrer");
    }
  },
  {
    id: "security.mixed-content",
    name: "mixed content",
    category: "Security",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const base = context.finalUrl ?? context.target;
      if (base.protocol !== "https:") return skipped("HTTPS page required");
      const references = insecureReferences(context.rootHtml, base);
      if (!references.length) return pass("no HTTP resources found in page HTML");
      return {
        status: "warning",
        message: `${references.length} insecure resource reference(s) found`,
        details: references.slice(0, 5).join(", ")
      };
    }
  },
  {
    id: "security.cookies",
    name: "cookie security attributes",
    category: "Security",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const cookies = cookieStrings(context);
      if (!cookies.length) return pass("no cookies set by the page response");
      const secureSite = (context.finalUrl ?? context.target).protocol === "https:";
      const issues = cookieIssues(cookies, secureSite);
      return issues.length
        ? { status: "warning", message: `${issues.length} cookie(s) may need security attributes`, details: issues.slice(0, 5).join("; ") }
        : pass("cookies have the checked security attributes");
    }
  }
];
