import type { Check } from "../../types.js";
import { error, pass, skipped } from "../helpers.js";

export const testsCheck: Check = {
  id: "deployment.tests",
  name: "project tests",
  category: "Deployment",
  severity: "error",
  async run(context) {
    if (context.target) return skipped("local project required");
    if (!context.packageJson?.scripts?.test) return skipped("no test script found");
    const result = await context.runCommand("npm test", 600_000);
    if (result.timedOut) return error("project tests timed out after 10 minutes");
    return result.code === 0
      ? pass("project tests passed")
      : error(`project tests failed (exit code ${result.code})`);
  }
};
