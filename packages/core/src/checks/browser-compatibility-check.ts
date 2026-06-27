import {
  defineCheck,
  fail,
  pass,
  skip,
  warn,
} from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { analyzeBrowserCompat } from "../runtime/browser-compat";
import { detectRuntime } from "../runtime/detect";

/**
 * Browser-compatibility analysis. Statically scans source for Node built-ins
 * that would break in a browser, and reports accordingly. Only meaningful for
 * packages that are (or could be) browser-targeted — pure server packages skip.
 */
export const browserCompatibilityCheck = defineCheck({
  id: CheckId.browserCompatibility,
  label: "Browser compatibility",
  description:
    "Source contains no Node built-ins that would break in a browser.",
  severity: "medium",
  weight: 1,

  async run({ package: pkg }) {
    const browser = await analyzeBrowserCompat(pkg);
    const detection = detectRuntime(pkg, browser.hardBreakers);
    const browserIntended =
      detection.intended.includes("browser") ||
      detection.intended.includes("electron_renderer");

    if (browser.usages.length === 0) {
      return browserIntended
        ? pass(
            `No Node built-ins found in ${browser.filesScanned} source file(s)`,
          )
        : skip("No Node built-ins used (browser not an intended target)");
    }

    if (browser.hardBreakers.length > 0) {
      const lines = [
        `Package uses Node built-ins:`,
        ...browser.hardBreakers.map((n) => `- ${n}`),
        "",
        "Browser compatibility: FAIL",
      ];
      const evidence = browser.usages
        .filter((u) => u.impact === "hard")
        .flatMap((u) => u.files.map((f) => `${u.name} → ${f}`));
      // Hard breakers in a browser-targeted package are a real failure; in a
      // server-only package they're expected, so only warn.
      return browserIntended
        ? fail(
            "high",
            `Uses ${browser.hardBreakers.length} browser-incompatible Node built-in(s)`,
            { details: lines.join("\n"), evidence },
          )
        : warn(
            "low",
            `Uses Node built-ins (${browser.hardBreakers.join(", ")}) — fine for a Node package`,
            { evidence },
          );
    }

    return warn(
      "low",
      `Uses polyfillable Node built-ins: ${browser.usages.map((u) => u.name).join(", ")}`,
      {
        details:
          "These work in a browser only if your bundler injects polyfills.",
      },
    );
  },
});
