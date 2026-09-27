import type { Check } from "../../types.js";
import { pass, skipped, error } from "../helpers.js";

export const buildCheck: Check = {
  id: "deployment.production-build",
  name: "production build",
  category: "Deployment",
  severity: "error",
  async run(context) {
    if (context.target) return skipped("local project required");
    const script = context.packageJson?.scripts?.build;
    if (!script) return skipped("no build script found");
    const testScript = context.packageJson?.scripts?.test ?? "";
    if (/(?:^|&&|;)\s*npm\s+run\s+build\b/.test(testScript)) {
      return skipped("build runs as part of the project test script");
    }
    const result = await context.runCommand("npm run build", 300_000);
    if (result.timedOut) return error("production build timed out after 5 minutes");
    return result.code === 0 ? pass("production build works") : error("production build failed");
  }
};
