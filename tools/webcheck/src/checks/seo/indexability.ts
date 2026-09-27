import type { AuditContext, Check, CheckResult } from "../../types.js";
import { error, pass, skipped, warning } from "../helpers.js";
import { crawlSite } from "../web/crawl.js";

function attributes(tag: string): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return values;
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function noindex(html: string): boolean {
  return tags(html, "meta").some((tag) => {
    const attrs = attributes(tag);
    const name = attrs.get("name")?.toLowerCase();
    return ["robots", "googlebot", "bingbot"].includes(name ?? "") && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(attrs.get("content") ?? "");
  });
}

function metadataUrl(context: AuditContext, kind: "canonical" | "og:image"): string | undefined {
  const html = context.rootHtml ?? "";
  if (kind === "canonical") {
    const tag = tags(html, "link").find((value) => attributes(value).get("rel")?.toLowerCase().split(/\s+/).includes("canonical"));
    return tag ? attributes(tag).get("href") : undefined;
  }
  const tag = tags(html, "meta").find((value) => {
    const attrs = attributes(value);
    return (attrs.get("property") ?? attrs.get("name"))?.toLowerCase() === "og:image";
  });
  return tag ? attributes(tag).get("content") : undefined;
}

async function checkUrl(url: URL): Promise<CheckResult> {
  const request = (method: "HEAD" | "GET") => fetch(url, {
    method,
    redirect: "follow",
    headers: { "user-agent": "webcheck/0.1" },
    signal: AbortSignal.timeout(5000)
  });
  try {
    let response = await request("HEAD");
    if ([403, 405, 501].includes(response.status)) response = await request("GET");
    const status = response.status;
    if (response.body) await response.body.cancel().catch(() => undefined);
    return status >= 200 && status < 400
      ? pass(`URL responds with ${status}`)
      : warning(`URL responds with ${status}`);
  } catch {
    return warning("URL could not be reached");
  }
}

function resolveMetadata(context: AuditContext, value: string | undefined, kind: string): URL | CheckResult {
  if (!value?.trim()) return skipped(`${kind} URL not present`);
  try {
    const url = new URL(value.trim(), context.finalUrl ?? context.target);
    if (!["http:", "https:"].includes(url.protocol)) return error(`${kind} URL must use HTTP or HTTPS`);
    return url;
  } catch {
    return warning(`${kind} URL is invalid`);
  }
}

export const indexabilityChecks: Check[] = [
  {
    id: "seo.noindex",
    name: "page indexability",
    category: "SEO",
    severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("HTML entry page not found");
      const header = context.rootResponse?.headers.get("x-robots-tag") ?? "";
      return noindex(context.rootHtml) || /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(header)
        ? warning("page sends a noindex directive")
        : pass("no noindex directive found");
    }
  },
  {
    id: "seo.site-metadata",
    name: "metadata across crawled pages",
    category: "SEO",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const pages = await crawlSite(context);
      const missing: string[] = [];
      const titlePaths = new Map<string, string[]>();
      for (const page of pages) {
        if (!page.html) continue;
        const label = page.url.pathname || "/";
        const title = page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!title) missing.push(`${label}: title`);
        else titlePaths.set(title, [...(titlePaths.get(title) ?? []), label]);
        if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(page.html)) missing.push(`${label}: lang`);
        if (missing.length >= 10) break;
      }
      for (const paths of titlePaths.values()) {
        if (paths.length > 1) missing.push(`duplicate title: ${paths.slice(0, 3).join(", ")}`);
      }
      return missing.length
        ? { status: "warning", message: `${missing.length} missing metadata item(s) across ${pages.length} crawled page(s)`, details: missing.join(", ") }
        : pass(`title and language metadata present across ${pages.length} crawled page(s)`);
    }
  },
  {
    id: "seo.canonical-target",
    name: "canonical URL availability",
    category: "SEO",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const resolved = resolveMetadata(context, metadataUrl(context, "canonical"), "canonical");
      return resolved instanceof URL ? checkUrl(resolved) : resolved;
    }
  },
  {
    id: "seo.opengraph-image-target",
    name: "OpenGraph image availability",
    category: "SEO",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const resolved = resolveMetadata(context, metadataUrl(context, "og:image"), "OpenGraph image");
      return resolved instanceof URL ? checkUrl(resolved) : resolved;
    }
  }
];
