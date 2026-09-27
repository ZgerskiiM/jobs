import type { Check } from "../../types.js";
import { pass, skipped, warning } from "../helpers.js";
import { readProjectFile } from "../../utils.js";

const sourceExtensions = /\.(?:[cm]?[jt]sx?|py|php|java|cs|rb|go|kt|kts)$/i;
const testFile = /(?:^|\/)[^/]*\.(?:test|spec)\.[^.]+$/i;
const sqlKeyword = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
const querySink = /\b(?:queryRawUnsafe|executeRawUnsafe|prepareStatement|createQuery|mysqli_query|mysql_query|query|execute|exec)\s*\(/i;
const dynamicSql = /\$\{\s*[^}]+\s*\}|#\{\s*[^}]+\s*\}|\bf["'][^\r\n]*\{\s*[^}]+\s*\}|["'][^"'\r\n]*["']\s*(?:\+|\.|%)\s*\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/i;

export const sqlSafetyCheck: Check = {
  id: "security.sql-injection-patterns",
  name: "SQL query construction",
  category: "Security",
  severity: "warning",
  async run(context) {
    if (context.target) return skipped("local project required");
    const files = [...context.files].filter((file) => sourceExtensions.test(file) && !testFile.test(file));
    const findings: string[] = [];

    for (const file of files) {
      const source = readProjectFile(context, file);
      if (!source) continue;
      const lines = source.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const snippet = lines.slice(index, index + 4).join(" ");
        if (querySink.test(snippet) && sqlKeyword.test(snippet) && dynamicSql.test(snippet)) {
          findings.push(`${file}:${index + 1}`);
          if (findings.length === 10) break;
        }
      }
      if (findings.length === 10) break;
    }

    return findings.length
      ? { status: "warning", message: "possible dynamically constructed SQL query found", details: findings.join(", ") }
      : pass("no obvious dynamically constructed SQL queries found");
  }
};
