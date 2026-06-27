/**
 * Theme model. `system` follows the OS; `light`/`dark` are explicit. Pure
 * helpers so resolution + cycling are testable; the desktop applies the result
 * as a `data-theme` attribute and persists the preference.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Resolve a preference to a concrete theme given the OS preference. */
export function resolveTheme(
  pref: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** Cycle light → dark → system → light (for a single toggle button). */
export function nextThemePreference(pref: ThemePreference): ThemePreference {
  return pref === "light" ? "dark" : pref === "dark" ? "system" : "light";
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
