import type { Check } from "../../types.js";
import { fetchResource, readProjectFile } from "../../utils.js";
import { pass, warning, statusIsOk } from "../helpers.js";

function validateSitemap(xml: string): string | undefined {
  const root = xml.match(/<\s*(urlset|sitemapindex)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/i);
  if (!root) return "sitemap is not a urlset or sitemapindex XML document";
  const locations = [...root[0].matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map((match) =>
    match[1].trim().replaceAll("&amp;", "&")
  );
  if (!locations.length) return "sitemap contains no loc entries";
  const invalid = locations.find((location) => {
    try { return !["http:", "https:"].includes(new URL(location).protocol); }
    catch { return true; }
  });
  return invalid ? `sitemap contains an invalid absolute URL: ${invalid.slice(0, 100)}` : undefined;
}

export const sitemapCheck: Check = {
  id: "seo.sitemap",
  name: "sitemap.xml",
  category: "SEO",
  severity: "warning",
  async run(context) {
    let xml: string | undefined;
    if (!context.target) {
      xml = readProjectFile(context, "sitemap.xml");
    } else {
      const response = await fetchResource(context, "/sitemap.xml");
      if (!response || !statusIsOk(response.status)) return warning("sitemap.xml missing or unavailable");
      try { xml = await response.text(); } catch { return warning("sitemap.xml could not be read"); }
    }
    if (!xml?.trim()) return warning("sitemap.xml missing or empty");
    const problem = validateSitemap(xml);
    return problem ? warning(problem) : pass("sitemap XML and loc URLs look valid");
  }
};
