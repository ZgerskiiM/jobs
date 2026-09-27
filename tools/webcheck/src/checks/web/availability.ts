import type { Check } from "../../types.js";
import { fetchResource } from "../../utils.js";
import { error, pass, skipped, warning, statusIsOk } from "../helpers.js";

export const webChecks: Check[] = [
  {
    id: "web.homepage-response", name: "homepage response", category: "Web", severity: "error",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const response = context.rootResponse;
      if (!response) return error("homepage did not return an HTTP response");
      if (response.status < 200 || response.status >= 300) return error(`homepage returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") return error(`homepage content type is ${contentType || "missing"}, expected HTML`);
      return pass(`homepage returned HTTP ${response.status} with text/html`);
    }
  },
  {
    id: "web.404", name: "404 page", category: "Web", severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const response = context.notFoundResponse ?? await fetchResource(context, "/webcheck-not-found-404");
      if (!response) return warning("404 page could not be checked");
      return response.status === 404 ? pass("404 page responds with 404") : warning(`expected 404, got ${response.status}`);
    }
  },
  {
    id: "web.robots", name: "/robots.txt reachable", category: "Web", severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const response = await fetchResource(context, "/robots.txt");
      return statusIsOk(response?.status) ? pass("/robots.txt reachable") : warning("/robots.txt unavailable");
    }
  },
  {
    id: "web.sitemap", name: "/sitemap.xml reachable", category: "Web", severity: "warning",
    async run(context) {
      if (!context.target) return skipped("deployed site required");
      const response = await fetchResource(context, "/sitemap.xml");
      return statusIsOk(response?.status) ? pass("/sitemap.xml reachable") : warning("/sitemap.xml unavailable");
    }
  }
];
