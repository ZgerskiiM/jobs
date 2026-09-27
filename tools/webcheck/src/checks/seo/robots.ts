import type { Check } from "../../types.js";
import { fetchResource, readProjectFile } from "../../utils.js";
import { pass, skipped, warning, statusIsOk } from "../helpers.js";

export const robotsCheck: Check = {
  id: "seo.robots",
  name: "robots.txt",
  category: "SEO",
  severity: "warning",
  async run(context) {
    let text: string | undefined;
    if (!context.target) {
      text = readProjectFile(context, "robots.txt");
    } else {
      const response = await fetchResource(context, "/robots.txt");
      if (!response || !statusIsOk(response.status)) return warning("robots.txt missing or unavailable");
      try { text = await response.text(); } catch { return warning("robots.txt could not be read"); }
    }
    if (!text?.trim()) return warning("robots.txt missing or empty");
    if (!/^\s*User-agent\s*:/im.test(text)) return warning("robots.txt has no User-agent directive");
    let agents: string[] = [];
    let disallowsAll = false;
    let hasDirective = false;
    let blocksAll = false;
    const finishGroup = () => {
      if (agents.includes("*") && disallowsAll) blocksAll = true;
    };
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*/, "").trim();
      const agent = line.match(/^User-agent\s*:\s*(.*)$/i);
      if (agent) {
        if (hasDirective) {
          finishGroup();
          agents = [];
          disallowsAll = false;
          hasDirective = false;
        }
        agents.push(agent[1].trim());
        continue;
      }
      if (/^(?:Allow|Disallow|Crawl-delay|Sitemap)\s*:/i.test(line)) hasDirective = true;
      if (/^Disallow\s*:\s*\/\s*$/i.test(line)) disallowsAll = true;
    }
    finishGroup();
    return blocksAll ? warning("robots.txt blocks the whole site for all crawlers") : pass("robots.txt is available and has a User-agent directive");
  }
};
