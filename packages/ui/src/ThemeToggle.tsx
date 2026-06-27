import { THEME_LABEL, type ThemePreference } from "./theme";

const ICON: Record<ThemePreference, string> = {
  light: "☀",
  dark: "☾",
  system: "⌗",
};

/** A single button that cycles light → dark → system. */
export function ThemeToggle({
  preference,
  onCycle,
}: {
  preference: ThemePreference;
  onCycle: () => void;
}) {
  return (
    <button
      className="pw-btn pw-btn--ghost pw-btn--icon"
      onClick={onCycle}
      title={`Theme: ${THEME_LABEL[preference]}`}
      aria-label={`Theme: ${THEME_LABEL[preference]}`}
    >
      <span aria-hidden>{ICON[preference]}</span>
    </button>
  );
}
