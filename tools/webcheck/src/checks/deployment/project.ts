import type { Check } from "../../types.js";
import { hasFile, readProjectFile } from "../../utils.js";
import { error, pass, warning } from "../helpers.js";

export const envChecks: Check[] = [
  {
    id: "deployment.env-ignored", name: ".env not committed", category: "Deployment", severity: "critical",
    async run(context) {
      const gitignore = readProjectFile(context, ".gitignore") ?? "";
      const envFiles = [...context.files].filter((file) => {
        const name = file.slice(file.lastIndexOf("/") + 1);
        return name === ".env" || (name.startsWith(".env.") && !/\.(?:example|template)$/i.test(name));
      });
      if (!envFiles.length) return pass("no private .env files present");
      const ignored = /(^|\n)\s*\.env(?:\*|\s|$)/m.test(gitignore) || /(^|\n)\s*\.env\/\*/m.test(gitignore);
      const trackedResult = await context.runCommand("git ls-files --cached -z");
      const trackedFiles = new Set(trackedResult.code === 0 ? trackedResult.output.split("\0") : []);
      const issues: string[] = [];
      for (const file of envFiles) {
        if (!ignored) issues.push(`${file} is not covered by .gitignore`);
        if (trackedFiles.has(file)) issues.push(`${file} is tracked by git`);
      }
      return issues.length ? error(issues.join("; ")) : pass("private .env files are ignored and untracked");
    }
  },
  {
    id: "deployment.debug", name: "debug settings", category: "Deployment", severity: "warning",
    async run(context) {
      const candidates = [...context.files].filter((file) => /\.(?:js|jsx|ts|tsx|json|env|yml|yaml)$/.test(file));
      const debug = /(?:debug|NODE_ENV)\s*[:=]\s*(?:true|["']?development["']?)/i;
      const hit = candidates.find((file) => debug.test(readProjectFile(context, file) ?? ""));
      return hit ? warning(`possible debug setting in ${hit}`) : pass("no obvious debug settings found");
    }
  },
  {
    id: "deployment.env-example", name: ".env.example", category: "Deployment", severity: "warning",
    async run(context) {
      const found = [...context.files].some((file) => /(?:^|\/)\.env\.example$/i.test(file));
      return found ? pass(".env.example exists") : warning(".env.example missing");
    }
  },
  {
    id: "deployment.gitignore", name: ".gitignore", category: "Deployment", severity: "warning",
    async run(context) { return hasFile(context, ".gitignore") ? pass(".gitignore exists") : warning(".gitignore missing"); }
  },
  {
    id: "deployment.secrets", name: "obvious secrets", category: "Deployment", severity: "critical",
    async run(context) {
      let candidates = [...context.files].filter((file) => !file.startsWith(".git/") && !file.endsWith(".lock"));
      const trackedFiles = await context.runCommand("git ls-files --cached -z");
      if (trackedFiles.code === 0) {
        candidates = trackedFiles.output.split("\0").filter((file) => context.files.has(file) && !file.endsWith(".lock"));
      }
      const secretPatterns = [
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /\bAKIA[0-9A-Z]{16}\b/,
        /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
        /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
        /(?:api[_-]?key|secret|token|password)[ \t]*[:=][ \t]*["']?(?!your[_ -]?|example|change[_ -]?(?:me|this|in[_ -]?production)|replace[_ -]?(?:me|with|this)|set[_ -]?(?:me|in[_ -]?production)|placeholder)[A-Za-z0-9_\-/+=]{16,}/i
      ];
      const hit = candidates.find((file) => secretPatterns.some((pattern) => pattern.test(readProjectFile(context, file) ?? "")));
      return hit ? error(`possible secret found in ${hit}`) : pass("no obvious secrets found");
    }
  }
];
