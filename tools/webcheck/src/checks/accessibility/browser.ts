import type { Check } from "../../types.js";
import { pass, skipped, warning } from "../helpers.js";

type AuditPage = {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<Awaited<T>>;
  close(): Promise<void>;
};

type AuditBrowser = {
  newPage(): Promise<AuditPage>;
  close(): Promise<void>;
};

type PlaywrightModule = { chromium?: { launch(options: { headless: true }): Promise<AuditBrowser> } };
type AxeModule = { source?: string; default?: { source?: string } };
type AxeResult = { violations: Array<{ id: string; impact?: string; nodes: unknown[] }> };

const importOptional = (specifier: string): Promise<unknown> => import(specifier);

export const browserAccessibilityCheck: Check = {
  id: "accessibility.browser-audit",
  name: "rendered accessibility audit",
  category: "Accessibility",
  severity: "warning",
  async run(context) {
    if (!context.target) return skipped("deployed site required");
    let browser: AuditBrowser | undefined;
    let page: AuditPage | undefined;
    try {
      const playwright = await importOptional("playwright") as PlaywrightModule;
      if (!playwright.chromium) return skipped("optional Playwright package is not installed");
      browser = await playwright.chromium.launch({ headless: true });
      page = await browser.newPage();
      await page.goto((context.finalUrl ?? context.target).toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });

      let axeSource: string | undefined;
      try {
        const axe = await importOptional("axe-core") as AxeModule;
        axeSource = axe.source ?? axe.default?.source;
      } catch { /* axe-core is optional; use the built-in rendered DOM checks */ }

      if (axeSource) {
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<AxeResult> } }).axe;
          return axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
        });
        const violations = result.violations;
        return violations.length
          ? {
              status: "warning",
              message: `axe-core found ${violations.length} accessibility violation type(s)`,
              details: violations.slice(0, 6).map(({ id, impact, nodes }) => `${id} (${impact ?? "impact unknown"}; ${nodes.length} node(s))`).join("; ")
            }
          : pass("axe-core found no WCAG A/AA violations");
      }

      const issues = await page.evaluate(() => {
        const missingAlt = [...document.images].filter((image) => !image.hasAttribute("alt")).length;
        const unlabeledControls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
          .filter((control) => !control.getAttribute("aria-label") && !control.getAttribute("aria-labelledby") &&
            !(control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) && !control.closest("label")).length;
        const unnamedActions = [...document.querySelectorAll("a, button")]
          .filter((element) => !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.textContent?.trim() &&
            !element.querySelector("img[alt]")).length;
        return { missingAlt, unlabeledControls, unnamedActions };
      });
      const details = Object.entries(issues).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`);
      return details.length
        ? { status: "warning", message: "rendered DOM accessibility issues found", details: details.join("; ") }
        : pass("rendered DOM checks found no missing image alternatives, control labels or action names");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return skipped(`browser audit unavailable: ${message.slice(0, 120)}`);
    } finally {
      if (page) await page.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
    }
  }
};
