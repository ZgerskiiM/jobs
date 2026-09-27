import type { Check } from "../types.js";
import { accessibilityChecks } from "./accessibility/index.js";
import { deploymentChecks } from "./deployment/index.js";
import { seoChecks } from "./seo/index.js";
import { securityChecks } from "./security/index.js";
import { webChecks } from "./web/availability.js";
import { webLinkChecks } from "./web/links.js";

export const allChecks: Check[] = [
  ...accessibilityChecks,
  ...seoChecks,
  ...securityChecks,
  ...deploymentChecks,
  ...webChecks,
  ...webLinkChecks
];
