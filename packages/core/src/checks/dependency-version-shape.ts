import { defineCheck, pass, skip, warn } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

/**
 * Sanity-check that dependency version specifiers are well-formed. Catches typos
 * like "^^1.0.0" or an accidental empty string. Deterministic, no network.
 */
// One comparator (single, not repeated), then a semver-ish version; multiple
// such ranges may be joined by spaces, `-`, or `||`.
const COMP = "(\\^|~|>=|<=|>|<|=)?";
const VER = "\\d+(\\.\\d+)?(\\.\\d+)?(\\.[x*])?([-+][0-9A-Za-z.-]+)?";
const RANGE = `${COMP}\\s*${VER}`;

const VALID = new RegExp(
  [
    "^\\*$",
    "^latest$",
    "^workspace:.+",
    "^(file|link|portal):.+",
    "^npm:.+",
    "^(git\\+|github:|gitlab:|bitbucket:|https?:).+",
    `^${RANGE}(\\s*(\\|\\||-|\\s)\\s*${RANGE})*$`,
  ].join("|"),
);

export const dependencyVersionShape = defineCheck({
  id: CheckId.dependencyVersionShape,
  label: "Dependency versions well-formed",
  description:
    "Every dependency/devDependency/peerDependency version specifier has a recognizable shape.",
  severity: "low",
  weight: 1,

  async run({ package: pkg }) {
    const all: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    const names = Object.keys(all);
    if (names.length === 0) return skip("No dependencies declared");

    const bad: string[] = [];
    for (const name of names) {
      const spec = all[name];
      if (
        typeof spec !== "string" ||
        spec.trim() === "" ||
        !VALID.test(spec.trim())
      ) {
        bad.push(`${name}: ${JSON.stringify(spec)}`);
      }
    }

    if (bad.length === 0)
      return pass(`${names.length} version specifier(s) look valid`);
    return warn("low", `${bad.length} suspicious version specifier(s)`, {
      evidence: bad,
    });
  },
});
