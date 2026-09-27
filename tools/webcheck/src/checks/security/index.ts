import type { Check } from "../../types.js";
import { headerChecks, headerQualityCheck } from "./headers.js";
import { httpsCheck, httpRedirectCheck } from "./https.js";
import { sqlSafetyCheck } from "./sql.js";
import { securitySiteChecks } from "./site.js";
import { dependencyAuditCheck } from "./dependencies.js";

export const securityChecks: Check[] = [httpsCheck, httpRedirectCheck, ...headerChecks, headerQualityCheck, ...securitySiteChecks, sqlSafetyCheck, dependencyAuditCheck];
