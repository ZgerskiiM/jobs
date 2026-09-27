import type { Check } from "../../types.js";
import { buildCheck } from "./build.js";
import { envChecks } from "./project.js";
import { testsCheck } from "./tests.js";

export const deploymentChecks: Check[] = [...envChecks, buildCheck, testsCheck];
