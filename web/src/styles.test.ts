import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static cascade checks for the dark-theme button rules (#40).
 *
 * The dark theme overrides the accent-button foreground to a dark ink
 * (`:root.dark … button { color: #18181b }`, specificity 0,3,1). Ghost and
 * danger buttons must opt back out with a *higher* specificity rule, otherwise
 * their `color: var(--fg)` / `color: #fff` base rules lose the cascade and the
 * label becomes invisible (dark ink on a dark surface). These tests pin that
 * invariant per container instead of relying on a manual browser walkthrough.
 */

// `import css from "./styles.css?raw"` yields an empty string under vitest
// (CSS modules are stubbed in the test pipeline), so read the source directly.
function readStylesheet(): string {
  const candidates = [
    resolve(process.cwd(), "src/styles.css"),
    resolve(process.cwd(), "web/src/styles.css"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(`styles.css not found from ${process.cwd()}`);
  }
  return readFileSync(path, "utf8");
}

interface CssRule {
  selectors: string[];
  declarations: string;
}

function parseRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;

    const selectorText = source.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }

    const body = source.slice(open + 1, cursor - 1);
    if (selectorText.startsWith("@")) {
      rules.push(...parseRules(body));
    } else {
      rules.push({
        selectors: selectorText
          .split(",")
          .map((selector) => selector.trim())
          .filter(Boolean),
        declarations: body,
      });
    }
    index = cursor;
  }

  return rules;
}

function colorOf(rule: CssRule): string | undefined {
  const match = rule.declarations.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
  return match?.[1].trim();
}

function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const rest = selector
    .replace(/#[\w-]+/g, " ")
    .replace(/\.[\w-]+/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/::[\w-]+/g, " ")
    .replace(/:(?!:)[\w-]+/g, " ");
  const elements =
    rest
      .split(/\s+/)
      .filter((part) => /^[a-zA-Z][\w-]*$/.test(part)).length + pseudoElements;
  return [ids, classes, elements];
}

function compareSpecificity(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

const rules = parseRules(readStylesheet());
const rulesBySelector = new Map<string, CssRule>();
for (const rule of rules) {
  for (const selector of rule.selectors) {
    rulesBySelector.set(selector, rule);
  }
}

/** Base (light-theme) rules that render a ghost button label with `var(--fg)`. */
function baseGhostSelectors(): string[] {
  return rules
    .filter((rule) => colorOf(rule) === "var(--fg)")
    .flatMap((rule) => rule.selectors)
    .filter(
      (selector) =>
        selector.includes(".ghost") && !selector.startsWith(":root.dark "),
    );
}

describe("dark theme button cascade", () => {
  it("has a higher-specificity ghost rescue for every ghost button container", () => {
    const baseSelectors = baseGhostSelectors();
    expect(baseSelectors.length).toBeGreaterThan(0);

    for (const base of baseSelectors) {
      const darkGhost = `:root.dark ${base}`;
      const darkGhostRule = rulesBySelector.get(darkGhost);
      expect(darkGhostRule, `missing dark rule for ${base}`).toBeDefined();
      expect(colorOf(darkGhostRule!)).toBe("var(--fg)");

      // The same container also gets the dark accent-button ink override; the
      // ghost rescue must out-rank it or the label renders dark-on-dark.
      const accentSelector = darkGhost.replace(/\.ghost\b/, "");
      const accentRule = rulesBySelector.get(accentSelector);
      if (accentRule) {
        expect(
          compareSpecificity(
            specificity(darkGhost),
            specificity(accentSelector),
          ),
          `${darkGhost} must out-specify ${accentSelector}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("rescues the containers that the #40 review found invisible in dark mode", () => {
    const baseSelectors = baseGhostSelectors();
    expect(baseSelectors).toEqual(
      expect.arrayContaining([
        ".subscriptions-toolbar button.ghost",
        ".form-actions button.ghost",
        ".auth-form button.ghost",
      ]),
    );
  });

  it("keeps danger buttons on white text in dark mode wherever ghost is rescued", () => {
    for (const base of baseGhostSelectors()) {
      const darkDanger = `:root.dark ${base.replace(/\.ghost\b/, ".danger")}`;
      const dangerRule = rulesBySelector.get(darkDanger);
      expect(dangerRule, `missing dark rule for ${darkDanger}`).toBeDefined();
      expect(colorOf(dangerRule!)).toBe("#fff");
    }
  });
});
