import type { PackageInfo } from "@package-workbench/plugin-sdk";
import type { PackageClass, PackageClassification } from "./types";

/**
 * Package classification with a confidence score. Uses manifest shape (bin,
 * exports, scripts, private), name/path patterns, and keywords. Deterministic.
 */

const CONFIG_RE =
  /(^|[-/@])(eslint-config|prettier-config|tsconfig|.*-config|config)([-/]|$)/i;
const PLUGIN_RE = /(^|[-/])plugin([-/]|$)/i;
const SHARED_RE = /(^|[-/])(shared|common|utils?|helpers?)([-/]|$)/i;
const INFRA_RE =
  /(^|[-/])(infra|infrastructure|runtime|engine|core|kernel)([-/]|$)/i;
const EXPERIMENTAL_RE =
  /(^|[-/])(experimental|wip|poc|prototype|draft|sandbox|playground)([-/]|$)/i;
const DEPRECATED_RE = /(^|[-/])(deprecated|legacy|old)([-/]|$)/i;

export function classifyPackage(pkg: PackageInfo): PackageClassification {
  const name = pkg.name ?? "";
  const root = pkg.root.replace(/\\/g, "/");
  const manifest = pkg.manifest;
  const keywords = (
    Array.isArray(manifest.keywords) ? (manifest.keywords as string[]) : []
  ).map((k) => k.toLowerCase());
  const evidence: string[] = [];

  const pick = (
    cls: PackageClass,
    confidence: number,
    why: string,
  ): PackageClassification => ({
    class: cls,
    confidence,
    evidence: [...evidence, why],
  });

  if (
    manifest.deprecated ||
    DEPRECATED_RE.test(name) ||
    keywords.includes("deprecated")
  )
    return pick("deprecated", 0.9, "name/manifest marks it deprecated");
  if (
    EXPERIMENTAL_RE.test(name) ||
    EXPERIMENTAL_RE.test(root) ||
    keywords.includes("experimental")
  )
    return pick("experimental", 0.8, "experimental name/path/keyword");
  if (manifest.bin) return pick("cli", 0.9, "has a bin entry");
  if (PLUGIN_RE.test(name) || keywords.includes("plugin"))
    return pick("plugin", 0.8, "plugin name/keyword");
  if (CONFIG_RE.test(name)) return pick("config", 0.85, "config-style name");

  const scripts = pkg.scripts ?? {};
  const isApp =
    pkg.packageType === "app" ||
    /(^|\/)apps?\//.test(root) ||
    (pkg.private && Boolean(scripts.start || scripts.dev || scripts.serve));
  if (isApp)
    return pick(
      "app",
      pkg.packageType === "app" ? 0.85 : 0.7,
      "app layout / start script",
    );

  if (INFRA_RE.test(name))
    return pick("infra", 0.6, "infrastructure-style name");
  if (SHARED_RE.test(name)) return pick("shared", 0.65, "shared/util name");

  if (manifest.exports || manifest.main || manifest.module || manifest.types)
    return pick("library", 0.75, "has a library entry surface");
  return pick("unknown", 0.3, "no strong signals");
}
