import type { AuditContext, Check, CheckResult } from "../../types.js";
import { pass, skipped } from "../helpers.js";
import { crawlSite } from "./crawl.js";

type Target = { url: string; label: string };

const MAX_TARGETS = 80;
const CONCURRENCY = 8;
const TIMEOUT_MS = 5000;

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function elements(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function resolveTarget(raw: string | undefined, base: URL): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim(), base);
    if (!(["http:", "https:"].includes(url.protocol))) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function collectLinks(html: string, base: URL): Target[] {
  const targets = new Map<string, Target>();
  for (const tag of elements(html, "a")) {
    const url = resolveTarget(attr(tag, "href"), base);
    if (!url || new URL(url).origin !== base.origin) continue;
    targets.set(url, { url, label: "link" });
  }
  return [...targets.values()];
}

function collectResources(html: string, base: URL): Target[] {
  const targets = new Map<string, Target>();
  const add = (raw: string | undefined, label: string) => {
    const url = resolveTarget(raw, base);
    if (url) targets.set(url, { url, label });
  };

  for (const name of ["img", "script", "iframe", "source", "audio", "video", "track", "embed"]) {
    for (const tag of elements(html, name)) {
      const src = attr(tag, "src");
      if (src) add(src, name);
      if (name === "video") add(attr(tag, "poster"), "video poster");
      const srcset = attr(tag, "srcset");
      if (srcset) {
        for (const candidate of srcset.split(",")) add(candidate.trim().split(/\s+/)[0], `${name} srcset`);
      }
    }
  }

  for (const tag of elements(html, "link")) {
    const rel = attr(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    if (rel.some((value) => ["stylesheet", "icon", "manifest", "preload", "modulepreload", "apple-touch-icon"].includes(value))) {
      add(attr(tag, "href"), `link rel=${rel.join(" ")}`);
    }
  }
  return [...targets.values()];
}

async function requestStatus(target: Target, isResource: boolean): Promise<Response | undefined> {
  const request = async (method: "HEAD" | "GET") => fetch(target.url, {
    method,
    redirect: "follow",
    headers: { "user-agent": "webcheck/0.1" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  try {
    let response = await request(isResource ? "HEAD" : "GET");
    if (isResource && [403, 405, 501].includes(response.status)) {
      response = await request("GET");
    }
    if (response.body) await response.body.cancel().catch(() => undefined);
    return response;
  } catch {
    return undefined;
  }
}

async function findFailures(targets: Target[], isResource: boolean, context: AuditContext): Promise<Target[]> {
  const failures: Target[] = [];
  const limitedTargets = targets.slice(0, MAX_TARGETS);
  for (let offset = 0; offset < limitedTargets.length; offset += CONCURRENCY) {
    const batch = limitedTargets.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(batch.map(async (target) => ({
      target,
      response: await requestStatus(target, isResource)
    })));
    for (const { target, response } of results) {
      if (isResource) context.resourceAudit.set(target.url, { status: response?.status, headers: response?.headers ?? new Headers() });
      if (!response || response.status >= 400) failures.push(target);
    }
  }
  return failures;
}

function resultFor(kind: string, targets: Target[], failures: Target[], isResource: boolean): CheckResult {
  if (!targets.length) return pass(`no ${kind} found`);
  const truncated = targets.length > MAX_TARGETS;
  if (!failures.length && !truncated) return pass(`all ${targets.length} ${kind} responded successfully`);

  const examples = failures.slice(0, 5).map(({ url }) => url).join(", ");
  const extra = failures.length > 5 ? `, and ${failures.length - 5} more` : "";
  const limitNote = truncated ? `; checked first ${MAX_TARGETS} of ${targets.length}` : "";
  const message = failures.length
    ? `${failures.length} of ${targets.length} ${kind} failed${limitNote}`
    : `checked first ${MAX_TARGETS} of ${targets.length} ${kind}; more remain`;
  const details = examples ? `${isResource ? "Failed resources" : "Failed links"}: ${examples}${extra}` : undefined;
  return { status: "warning", message, details };
}

export const webLinkChecks: Check[] = [
  {
    id: "web.site-crawl",
    name: "internal page crawl",
    category: "Web",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const pages = await crawlSite(context);
      const failures = pages.filter(({ status }) => status === undefined || status >= 400);
      const unavailableHtml = pages.filter(({ status, html }) => status !== undefined && status < 400 && !html);
      if (failures.length || unavailableHtml.length || context.crawlTruncated) {
        const examples = failures.slice(0, 5).map(({ url, status }) => `${url} (${status ?? "unreachable"})`);
        if (unavailableHtml.length) examples.push(`${unavailableHtml.length} page(s) did not return HTML`);
        const limit = context.crawlTruncated ? "; page limit reached" : "";
        return { status: "warning", message: `crawled ${pages.length} page(s); ${failures.length + unavailableHtml.length} issue(s) found${limit}`, details: examples.join(", ") };
      }
      return pass(`crawled ${pages.length} same-origin page(s)`);
    }
  },
  {
    id: "web.broken-links",
    name: "internal links",
    category: "Web",
    severity: "warning",
    async run(context: AuditContext) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const pages = await crawlSite(context);
      const targets = [...new Map(pages.flatMap(({ url, html }) => collectLinks(html, url)).map((target) => [target.url, target])).values()];
      return resultFor("internal link(s)", targets, await findFailures(targets, false, context), false);
    }
  },
  {
    id: "web.broken-resources",
    name: "page resources",
    category: "Web",
    severity: "warning",
    async run(context: AuditContext) {
      if (!context.target) return skipped("deployed site required");
      if (!context.rootHtml) return skipped("page HTML unavailable");
      const pages = await crawlSite(context);
      const targets = [...new Map(pages.flatMap(({ url, html }) => collectResources(html, url)).map((target) => [target.url, target])).values()];
      return resultFor("resource(s)", targets, await findFailures(targets, true, context), true);
    }
  },
  {
    id: "performance.resource-size",
    name: "resource size",
    category: "Performance",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const known: Array<{ url: string; bytes: number }> = [];
      const rootLength = Number(context.rootResponse?.headers.get("content-length"));
      if (Number.isFinite(rootLength) && rootLength > 0) known.push({ url: context.finalUrl?.toString() ?? context.target.toString(), bytes: rootLength });
      for (const [url, result] of context.resourceAudit) {
        const bytes = Number(result.headers.get("content-length"));
        if (result.status !== undefined && result.status < 400 && Number.isFinite(bytes) && bytes > 0) known.push({ url, bytes });
      }
      if (!known.length) return skipped("server did not expose Content-Length for checked resources");
      const oversized = known.filter(({ bytes }) => bytes > 1_500_000);
      const total = known.reduce((sum, { bytes }) => sum + bytes, 0);
      const issues = oversized.map(({ url, bytes }) => `${url} (${(bytes / 1_000_000).toFixed(1)} MB)`);
      if (total > 5_000_000) issues.push(`known total ${(total / 1_000_000).toFixed(1)} MB across ${known.length} resource(s)`);
      return issues.length
        ? { status: "warning", message: `${issues.length} resource size issue(s)`, details: issues.slice(0, 5).join(", ") }
        : pass(`no oversized resources found among ${known.length} resources with known size`);
    }
  },
  {
    id: "performance.cache-policy",
    name: "static resource caching",
    category: "Performance",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const candidates = [...context.resourceAudit.entries()].filter(([, result]) => {
        if (result.status === undefined || result.status >= 400) return false;
        const type = result.headers.get("content-type")?.toLowerCase() ?? "";
        return /^(?:image\/|font\/|text\/(?:css|javascript)|application\/(?:javascript|x-javascript|font|wasm)|application\/x-font-)/.test(type);
      });
      if (!candidates.length) return pass("no cacheable static resources found");
      const missing = candidates.filter(([, result]) => {
        const policy = result.headers.get("cache-control")?.toLowerCase() ?? "";
        if (!policy && !result.headers.has("expires")) return true;
        if (/(?:^|,)\s*no-store\b/.test(policy)) return true;
        const maxAge = policy.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/)?.[1];
        return (maxAge !== undefined && Number(maxAge) === 0) || (!maxAge && /(?:^|,)\s*no-cache\b/.test(policy));
      });
      return missing.length
        ? { status: "warning", message: `${missing.length} of ${candidates.length} static resource(s) have no effective cache policy`, details: missing.slice(0, 5).map(([url]) => url).join(", ") }
        : pass(`all ${candidates.length} checked static resources have a cache policy`);
    }
  },
  {
    id: "performance.compression",
    name: "text resource compression",
    category: "Performance",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const candidates: Array<{ url: string; headers: Headers }> = [];
      const rootType = context.rootResponse?.headers.get("content-type")?.toLowerCase() ?? "";
      if (context.rootResponse && context.rootResponse.status < 400 && /^(?:text\/|application\/(?:javascript|json|xml))/.test(rootType)) {
        candidates.push({ url: context.finalUrl?.toString() ?? context.target.toString(), headers: context.rootResponse.headers });
      }
      for (const [url, result] of context.resourceAudit) {
        if (result.status === undefined || result.status >= 400) continue;
        const type = result.headers.get("content-type")?.toLowerCase() ?? "";
        if (/^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/.test(type)) candidates.push({ url, headers: result.headers });
      }
      const large = candidates.filter(({ headers }) => Number(headers.get("content-length")) >= 1024);
      if (!large.length) return skipped("no sufficiently large text resources with known size");
      const uncompressed = large.filter(({ headers }) => !headers.get("content-encoding"));
      return uncompressed.length
        ? { status: "warning", message: `${uncompressed.length} of ${large.length} large text resource(s) are not compressed`, details: uncompressed.slice(0, 5).map(({ url }) => url).join(", ") }
        : pass(`all ${large.length} checked large text resources are compressed`);
    }
  },
  {
    id: "performance.homepage-response-time",
    name: "homepage response time",
    category: "Performance",
    severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const elapsed = context.homepageResponseTimeMs;
      if (elapsed === undefined) return skipped("homepage response timing unavailable");
      return elapsed > 2500
        ? { status: "warning", message: `homepage took ${(elapsed / 1000).toFixed(2)}s to respond (recommended under 2.5s)` }
        : pass(`homepage responded in ${(elapsed / 1000).toFixed(2)}s`);
    }
  }
];
