import type { Check } from "../../types.js";
import { indexabilityChecks } from "./indexability.js";
import { robotsCheck } from "./robots.js";
import { sitemapCheck } from "./sitemap.js";
import htmlChecks from "./html.js";

export const seoChecks: Check[] = [robotsCheck, sitemapCheck, ...htmlChecks, ...indexabilityChecks];
