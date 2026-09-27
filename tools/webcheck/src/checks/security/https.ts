import type { Check } from "../../types.js";
import { error, pass, skipped } from "../helpers.js";

export const httpsCheck: Check = {
  id: "security.https",
  name: "HTTPS",
  category: "Security",
  severity: "error",
  async run(context) {
    if (!context.target) return skipped("deployed site required");
    return (context.finalUrl?.protocol ?? context.target.protocol) === "https:" ? pass("HTTPS enabled") : error("HTTPS missing");
  }
};

export const httpRedirectCheck: Check = {
  id: "security.http-redirect",
  name: "HTTP → HTTPS redirect",
  category: "Security",
  severity: "error",
  async run(context) {
    if (!context.target) return skipped("deployed site required");
    if (context.target.protocol !== "http:") return skipped("pass an http:// URL to verify redirect");
    return context.httpRedirect ? pass("HTTP redirects to HTTPS") : error("HTTP does not redirect to HTTPS");
  }
};
