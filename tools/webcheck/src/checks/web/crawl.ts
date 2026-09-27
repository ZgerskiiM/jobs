import type { AuditContext } from "../../types.js";

const MAX_PAGES = 12;
const MAX_DEPTH = 2;
const CONCURRENCY = 4;

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function links(html: string, base: URL): URL[] {
  const found = new Map<string, URL>();
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin) continue;
      url.hash = "";
      if (["mailto:", "tel:"].includes(url.protocol)) continue;
      if (!found.has(url.toString())) found.set(url.toString(), url);
    } catch { /* ignore malformed links */ }
  }
  return [...found.values()];
}

export async function crawlSite(context: AuditContext): Promise<Array<{ url: URL; status?: number; html: string }>> {
  if (context.crawledPages) return context.crawledPages;
  const rootUrl = context.finalUrl ?? context.target;
  if (!context.target || !rootUrl || !context.rootHtml) return [];

  const pages = new Map<string, { url: URL; status?: number; html: string }>();
  const visited = new Set<string>([rootUrl.toString()]);
  pages.set(rootUrl.toString(), {
    url: rootUrl,
    status: context.rootResponse?.status,
    html: context.rootHtml
  });
  let frontier = links(context.rootHtml, rootUrl).map((url) => ({ url, depth: 1 }));

  while (frontier.length && pages.size < MAX_PAGES) {
    const batch = frontier.filter(({ url }) => {
      const key = url.toString();
      if (visited.has(key)) return false;
      visited.add(key);
      return true;
    }).slice(0, Math.min(CONCURRENCY, MAX_PAGES - pages.size));
    if (!batch.length) break;
    const results = await Promise.all(batch.map(async ({ url, depth }) => {
      try {
        const response = await fetch(url, {
          redirect: "follow",
          headers: { "user-agent": "webcheck/0.1" },
          signal: AbortSignal.timeout(4000)
        });
        const finalUrl = new URL(response.url || url.toString());
        if (finalUrl.origin !== rootUrl.origin || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
          if (response.body) await response.body.cancel().catch(() => undefined);
          return { url, status: response.status, html: "", children: [] as URL[] };
        }
        const html = (await response.text()).slice(0, 1_000_000);
        return { url, status: response.status, html, children: depth < MAX_DEPTH ? links(html, finalUrl) : [] };
      } catch {
        return { url, html: "", children: [] as URL[] };
      }
    }));
    for (const page of results) {
      pages.set(page.url.toString(), { url: page.url, status: page.status, html: page.html });
      for (const url of page.children) {
        if (!visited.has(url.toString())) frontier.push({ url, depth: batch.find((item) => item.url.toString() === page.url.toString())?.depth ?? MAX_DEPTH });
      }
    }
  }
  context.crawlTruncated = frontier.length > 0 && pages.size >= MAX_PAGES;
  context.crawledPages = [...pages.values()];
  return context.crawledPages;
}
