export { Workbench, type WorkbenchProps } from "./Workbench";
export { PackageList, type PackageListProps } from "./PackageList";
export { PackageDetails, type PackageDetailsProps } from "./PackageDetails";
export { HealthScore, STATUS_COLOR } from "./HealthScore";
export {
  ConfidenceBadge,
  StatusBadge,
  RuntimeStatusBadge,
  RUNTIME_STATUS_COLOR,
  Tag,
} from "./badges";
export { FailureLog } from "./FailureLog";
export { RuntimeMatrix, type RuntimeMatrixProps } from "./RuntimeMatrix";
export {
  ScenarioRunner,
  type ScenarioRunnerProps,
  type ScenarioMeta,
} from "./ScenarioRunner";
export {
  DependencyGraphView,
  type DependencyGraphViewProps,
} from "./DependencyGraphView";
export {
  HistoricalRunsView,
  type HistoricalRunsViewProps,
} from "./HistoricalRunsView";
export { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
export {
  Onboarding,
  ScanProgress,
  type OnboardingProps,
  type RecentRepo,
  type ScanStep,
} from "./Onboarding";
export { FilterBar, type FilterBarProps } from "./FilterBar";
export { FailureExplain, type FailureExplainProps } from "./FailureExplain";
export {
  AiAssistantPanel,
  type AiAssistantPanelProps,
} from "./AiAssistantPanel";
export { PrReviewView, type PrReviewViewProps } from "./PrReviewView";
export {
  WorkspaceStackBadge,
  type WorkspaceStackBadgeProps,
} from "./WorkspaceStackBadge";
export { ApiSurfacePanel, type ApiSurfacePanelProps } from "./ApiSurfacePanel";
export { RefactorPanel, type RefactorPanelProps } from "./RefactorPanel";
export { FixesPanel, type FixesPanelProps } from "./FixesPanel";
export { ChatPanel, type ChatPanelProps, type ChatMessage } from "./ChatPanel";
export { ThemeToggle } from "./ThemeToggle";
export { SkeletonList, SkeletonDetails } from "./Skeleton";

// Pure UX cores (framework-agnostic, reusable + tested).
export {
  fuzzyMatch,
  fuzzyRank,
  type FuzzyMatch,
  type RankedItem,
} from "./fuzzy";
export { explainFailure, type FailureExplanation } from "./errors";
export {
  applyFilters,
  matchesQuery,
  countActiveFilters,
  emptyFilter,
  type PackageFilter,
  type StatusFilter,
} from "./filter";
export {
  appReducer,
  canTransition,
  isBusyStatus,
  initialAppState,
  type AppStatus,
  type AppEvent,
  type AppMachineState,
} from "./appState";
export {
  filterCommands,
  groupCommands,
  type Command,
  type CommandGroup,
} from "./commands";
export {
  resolveTheme,
  nextThemePreference,
  THEME_LABEL,
  type ThemePreference,
  type ResolvedTheme,
} from "./theme";
