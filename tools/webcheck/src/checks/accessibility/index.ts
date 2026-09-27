import type { Check, CheckResult } from "../../types.js";
import { error, pass, skipped, warning } from "../helpers.js";
import { browserAccessibilityCheck } from "./browser.js";

function htmlFor(context: Parameters<Check["run"]>[0]): string | undefined {
  return context.rootHtml || undefined;
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function checkImages(html: string): CheckResult {
  const images = tags(html, "img");
  const missing = images.filter((image) => !attributes(image).has("alt"));
  if (!missing.length) return pass(images.length ? "all images have an alt attribute" : "no images found");
  return error(`${missing.length} of ${images.length} image(s) missing alt text`);
}

function checkFormControls(html: string): CheckResult {
  const controls = [
    ...tags(html, "input").filter((tag) => !/\btype\s*=\s*["']?(?:hidden|submit|button|reset|image)\b/i.test(tag)),
    ...tags(html, "select"),
    ...tags(html, "textarea")
  ];
  if (!controls.length) return pass("no form controls found");

  const ids = new Set([...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]));
  const labelledIds = new Set(
    [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map((match) => match[2])
  );
  const labelledBy = (id: string) => new RegExp(`<label\\b[^>]*>[\\s\\S]*?<\\/?(?:input|select|textarea)\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>[\\s\\S]*?<\\/label\\s*>`, "i").test(html);
  const unlabeled = controls.filter((control) => {
    const attrs = attributes(control);
    if (attrs.get("aria-label")?.trim()) return false;
    const references = attrs.get("aria-labelledby")?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (references.some((id) => ids.has(id) || labelledIds.has(id))) return false;
    const id = attrs.get("id");
    if (id && labelledIds.has(id)) return false;
    if (id && labelledBy(id)) return false;
    const wrappedControl = new RegExp(`<label\\b[^>]*>[\\s\\S]*?${escapeRegExp(control)}[\\s\\S]*?<\\/label\\s*>`, "i");
    return !wrappedControl.test(html);
  });

  return unlabeled.length
    ? error(`${unlabeled.length} of ${controls.length} form control(s) have no detectable label`)
    : pass("all form controls have a detectable label");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkInteractiveNames(html: string): CheckResult {
  const interactive = [...html.matchAll(/<(button|a)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)].map(([element]) => element);
  if (!interactive.length) return pass("no links or buttons found");

  const unnamed = interactive.filter((element) => {
    const openingTag = element.match(/^<(?:button|a)\b[^>]*>/i)?.[0] ?? element;
    const attrs = attributes(openingTag);
    if (attrs.get("aria-label")?.trim() || attrs.get("aria-labelledby")?.trim() || attrs.get("title")?.trim()) return false;
    const name = element.replace(/^<(?:button|a)\b[^>]*>/i, "").replace(/<\/(?:button|a)\s*>$/i, "");
    if (name.replace(/<[^>]*>/g, " ").trim()) return false;
    return !/<img\b[^>]*\balt\s*=\s*(["'][^"']+|[^\s>]+)/i.test(name);
  });

  return unnamed.length
    ? warning(`${unnamed.length} of ${interactive.length} link(s) or button(s) have no detectable accessible name`)
    : pass("all links and buttons have a detectable accessible name");
}

function checkHeadings(html: string): CheckResult {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  if (!levels.length) return warning("no heading structure found");
  const issues: string[] = [];
  const h1Count = levels.filter((level) => level === 1).length;
  if (!h1Count) issues.push("no h1 heading");
  if (h1Count > 1) issues.push(`${h1Count} h1 headings`);
  for (let index = 1; index < levels.length; index++) {
    if (levels[index] > levels[index - 1] + 1) {
      issues.push(`heading level skips from h${levels[index - 1]} to h${levels[index]}`);
      break;
    }
  }
  return issues.length ? warning(issues.join("; ")) : pass("heading levels have a usable structure");
}

function checkIdsAndAria(html: string): CheckResult {
  const ids = [...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const known = new Set(ids);
  const missingRefs = new Set<string>();
  for (const tag of [...html.matchAll(/<[a-z][^>]*>/gi)].map(([value]) => value)) {
    const attrs = attributes(tag);
    for (const name of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"] as const) {
      for (const id of (attrs.get(name) ?? "").split(/\s+/).filter(Boolean)) {
        if (!known.has(id)) missingRefs.add(id);
      }
    }
  }
  const issues = [
    ...(duplicates.length ? [`duplicate id(s): ${duplicates.slice(0, 3).join(", ")}`] : []),
    ...(missingRefs.size ? [`ARIA references missing id(s): ${[...missingRefs].slice(0, 3).join(", ")}`] : [])
  ];
  return issues.length ? warning(issues.join("; ")) : pass("IDs are unique and ARIA references resolve");
}

function checkLandmarks(html: string): CheckResult {
  const hasMain = /<main\b/i.test(html) || /\brole\s*=\s*["']main["']/i.test(html);
  const hasNavigation = /<nav\b/i.test(html) || /\brole\s*=\s*["']navigation["']/i.test(html);
  const missing = [!hasMain && "main", !hasNavigation && "navigation"].filter(Boolean);
  return missing.length ? warning(`missing ${missing.join(" and ")} landmark`) : pass("main and navigation landmarks found");
}

function checkHiddenFocusables(html: string): CheckResult {
  const hidden = [...html.matchAll(/<(a|button|input|select|textarea)\b[^>]*>/gi)].filter(([tag, name]) => {
    if (!/aria-hidden\s*=\s*["']?true\b/i.test(tag)) return false;
    return name.toLowerCase() !== "a" || /\bhref\s*=/.test(tag);
  });
  return hidden.length
    ? warning(`${hidden.length} focusable element(s) are marked aria-hidden`)
    : pass("no focusable elements marked aria-hidden");
}

export const accessibilityChecks: Check[] = [
  browserAccessibilityCheck,
  {
    id: "accessibility.image-alt",
    name: "image alternative text",
    category: "Accessibility",
    severity: "error",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkImages(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.form-labels",
    name: "form labels",
    category: "Accessibility",
    severity: "error",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkFormControls(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.interactive-names",
    name: "link and button names",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkInteractiveNames(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.viewport",
    name: "mobile viewport",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      if (!html) return skipped("HTML entry page not found");
      const viewport = tags(html, "meta").some((tag) => {
        const attrs = attributes(tag);
        return attrs.get("name")?.toLowerCase() === "viewport" && Boolean(attrs.get("content")?.trim());
      });
      return viewport ? pass("viewport meta tag present") : warning("viewport meta tag missing");
    }
  },
  {
    id: "accessibility.headings",
    name: "heading hierarchy",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkHeadings(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.ids-aria",
    name: "unique IDs and ARIA references",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkIdsAndAria(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.landmarks",
    name: "page landmarks",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkLandmarks(html) : skipped("HTML entry page not found");
    }
  },
  {
    id: "accessibility.aria-hidden-focusable",
    name: "hidden focusable controls",
    category: "Accessibility",
    severity: "warning",
    async run(context) {
      const html = htmlFor(context);
      return html ? checkHiddenFocusables(html) : skipped("HTML entry page not found");
    }
  }
];
