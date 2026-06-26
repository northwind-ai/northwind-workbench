import type { PackageHealthReport } from '@package-workbench/core';
import { STATUS_COLOR } from './HealthScore';

export interface PackageListProps {
  reports: PackageHealthReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Sidebar: one row per package, color-coded by status, sorted worst-first. */
export function PackageList({ reports, selectedId, onSelect }: PackageListProps) {
  const sorted = [...reports].sort((a, b) => a.score - b.score);
  return (
    <nav className="pw-list" aria-label="Packages">
      {sorted.map((r) => (
        <button
          key={r.package.id}
          className={'pw-list__row' + (r.package.id === selectedId ? ' is-selected' : '')}
          onClick={() => onSelect(r.package.id)}
        >
          <span className="pw-list__dot" style={{ background: STATUS_COLOR[r.status] }} />
          <span className="pw-list__name">
            {r.package.name}
            <small>
              {r.package.packageType} · {r.confidence} conf.
            </small>
          </span>
          <span className="pw-list__score" style={{ color: STATUS_COLOR[r.status] }}>
            {r.score}
          </span>
        </button>
      ))}
    </nav>
  );
}
