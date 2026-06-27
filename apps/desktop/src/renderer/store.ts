import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecentRepo, ThemePreference } from "@package-workbench/ui";
import { nextThemePreference } from "@package-workbench/ui";

/**
 * Global renderer state (Zustand). The persisted slice — theme, recent repos,
 * and the last selected package — survives restarts via localStorage; the rest
 * (palette open, view mode) is ephemeral. Selectors keep re-renders narrow.
 */
interface UiStore {
  // ---- persisted ----
  theme: ThemePreference;
  recentRepos: RecentRepo[];
  lastPackageId: string | null;
  // ---- ephemeral ----
  paletteOpen: boolean;
  mode: "packages" | "graph" | "history" | "pr" | "refactor" | "fixes" | "chat";

  setTheme(theme: ThemePreference): void;
  cycleTheme(): void;
  addRecent(repo: RecentRepo): void;
  setLastPackage(id: string | null): void;
  setMode(
    mode:
      | "packages"
      | "graph"
      | "history"
      | "pr"
      | "refactor"
      | "fixes"
      | "chat",
  ): void;
  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
}

const MAX_RECENT = 8;

export const useStore = create<UiStore>()(
  persist(
    (set) => ({
      theme: "system",
      recentRepos: [],
      lastPackageId: null,
      paletteOpen: false,
      mode: "packages",

      setTheme: (theme) => set({ theme }),
      cycleTheme: () => set((s) => ({ theme: nextThemePreference(s.theme) })),
      addRecent: (repo) =>
        set((s) => ({
          recentRepos: [
            repo,
            ...s.recentRepos.filter((r) => r.path !== repo.path),
          ].slice(0, MAX_RECENT),
        })),
      setLastPackage: (lastPackageId) => set({ lastPackageId }),
      setMode: (mode) => set({ mode }),
      openPalette: () => set({ paletteOpen: true }),
      closePalette: () => set({ paletteOpen: false }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
    }),
    {
      name: "package-workbench-ui",
      // Persist only the durable preferences.
      partialize: (s) => ({
        theme: s.theme,
        recentRepos: s.recentRepos,
        lastPackageId: s.lastPackageId,
      }),
    },
  ),
);
