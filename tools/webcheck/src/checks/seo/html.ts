import type { Check } from "../../types.js";
import { htmlHas } from "../../utils.js";
import { error, pass, skipped, warning } from "../helpers.js";

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

const htmlChecks: Check[] = [
  {
    id: "seo.title", name: "title", category: "SEO", severity: "error",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      return htmlHas(context, /<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/i) ? pass("title present") : error("title missing");
    }
  },
  {
    id: "seo.description", name: "meta description", category: "SEO", severity: "error",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      return htmlHas(context, /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']+|<meta\b[^>]*content=["'][^"']+["'][^>]*name=["']description["']/i) ? pass("meta description present") : error("meta description missing");
    }
  },
  {
    id: "seo.canonical", name: "canonical", category: "SEO", severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      return htmlHas(context, /<link\b[^>]*rel=["']canonical["'][^>]*href=["'][^"']+|<link\b[^>]*href=["'][^"']+["'][^>]*rel=["']canonical["']/i) ? pass("canonical present") : warning("canonical missing");
    }
  },
  {
    id: "seo.favicon", name: "favicon", category: "SEO", severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      return htmlHas(context, /<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["'][^"']+/i) ? pass("favicon present") : warning("favicon missing");
    }
  },
  {
    id: "seo.opengraph", name: "OpenGraph", category: "SEO", severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      const html = context.rootHtml ?? "";
      const title = /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["'][^"']+|<meta\b[^>]*content=["'][^"']+["'][^>]*(?:property|name)=["']og:title["']/i.test(html);
      const description = /<meta\b[^>]*(?:property|name)=["']og:description["'][^>]*content=["'][^"']+|<meta\b[^>]*content=["'][^"']+["'][^>]*(?:property|name)=["']og:description["']/i.test(html);
      const image = /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["'][^"']+|<meta\b[^>]*content=["'][^"']+["'][^>]*(?:property|name)=["']og:image["']/i.test(html);
      if (title && description && image) return pass("OpenGraph title, description and image present");
      const missing = [!title && "title", !description && "description", !image && "image"].filter(Boolean).join(", ");
      return warning(`OpenGraph ${missing} missing`);
    }
  },
  {
    id: "seo.lang", name: "html lang", category: "SEO", severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      return htmlHas(context, /<html\b[^>]*\blang=["'][^"']+["']/i) ? pass("html lang present") : warning("html lang missing");
    }
  },
  {
    id: "seo.metadata-quality", name: "metadata quality", category: "SEO", severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      const title = context.rootHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() ?? "";
      const descriptions = tags(context.rootHtml, "meta").filter((tag) => attribute(tag, "name")?.toLowerCase() === "description");
      const description = descriptions.map((tag) => attribute(tag, "content")?.trim() ?? "").find(Boolean) ?? "";
      const canonicals = tags(context.rootHtml, "link").filter((tag) => attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("canonical"));
      const issues: string[] = [];
      if (title && title.length > 70) issues.push(`title is ${title.length} characters (recommended maximum is 70)`);
      if (title && title.length < 15) issues.push(`title is only ${title.length} characters`);
      if (description && description.length > 160) issues.push(`description is ${description.length} characters (recommended maximum is 160)`);
      if (description && description.length < 50) issues.push(`description is only ${description.length} characters`);
      if (descriptions.length > 1) issues.push(`${descriptions.length} meta descriptions found`);
      if (canonicals.length > 1) issues.push(`${canonicals.length} canonical links found`);
      return issues.length
        ? { status: "warning", message: `${issues.length} metadata quality issue(s)`, details: issues.join("; ") }
        : pass("title, description and canonical counts look reasonable");
    }
  },
  {
    id: "seo.structured-data-json",
    name: "structured data JSON-LD",
    category: "SEO",
    severity: "warning",
    async run(context) {
      if (!context.rootHtml) return skipped("index.html not found");
      const scripts = [...context.rootHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(([tag]) => /type\s*=\s*["']application\/ld\+json["']/i.test(tag));
      if (!scripts.length) return skipped("no JSON-LD structured data found");
      const invalid = scripts.flatMap(([, , body], index) => {
        try { JSON.parse(body.trim()); return []; }
        catch { return [`JSON-LD block ${index + 1} is invalid JSON`]; }
      });
      return invalid.length
        ? { status: "warning", message: `${invalid.length} invalid JSON-LD block(s)`, details: invalid.join("; ") }
        : pass(`all ${scripts.length} JSON-LD block(s) contain valid JSON`);
    }
  }
];

export default htmlChecks;
