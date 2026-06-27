import type { PackageType } from "@package-workbench/core";
import {
  countActiveFilters,
  type PackageFilter,
  type StatusFilter,
} from "./filter";

export interface FilterBarProps {
  filter: PackageFilter;
  onChange: (filter: PackageFilter) => void;
  total: number;
  shown: number;
}

const STATUSES: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "failing", label: "Failing" },
  { value: "warning", label: "Warnings" },
  { value: "passing", label: "Passing" },
];

const TYPES: Array<"all" | PackageType> = [
  "all",
  "app",
  "library",
  "tool",
  "unknown",
];

/** Sidebar filter + search controls. Fully controlled by the caller. */
export function FilterBar({ filter, onChange, total, shown }: FilterBarProps) {
  const set = (patch: Partial<PackageFilter>): void =>
    onChange({ ...filter, ...patch });
  const active = countActiveFilters(filter);

  return (
    <div className="pw-filterbar">
      <input
        className="pw-filterbar__search"
        placeholder="Search name, dependency, failure…"
        value={filter.query}
        onChange={(e) => set({ query: e.target.value })}
        aria-label="Search packages"
      />
      <div className="pw-filterbar__row">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            className={`pw-chip${filter.status === s.value ? " is-active" : ""}`}
            onClick={() => set({ status: s.value })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="pw-filterbar__row">
        <label
          className={`pw-chip${filter.runtimeFailures ? " is-active" : ""}`}
        >
          <input
            type="checkbox"
            checked={filter.runtimeFailures}
            onChange={(e) => set({ runtimeFailures: e.target.checked })}
          />
          Runtime failures
        </label>
        <select
          className="pw-filterbar__select"
          value={filter.packageType}
          onChange={(e) =>
            set({ packageType: e.target.value as PackageFilter["packageType"] })
          }
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "Any type" : t}
            </option>
          ))}
        </select>
      </div>
      <div className="pw-filterbar__meta pw-muted">
        {shown}/{total} packages
        {active > 0 && (
          <button
            className="pw-filterbar__clear"
            onClick={() =>
              onChange({
                query: "",
                status: "all",
                runtimeFailures: false,
                minScore: 0,
                maxScore: 100,
                packageType: "all",
              })
            }
          >
            clear {active} filter{active > 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  );
}
