import type { PackageStatus } from "@package-workbench/core";

export const STATUS_COLOR: Record<PackageStatus, string> = {
  pass: "#1f9d55",
  warn: "#d97706",
  fail: "#dc2626",
};

export function HealthScore({
  score,
  status,
  size = 64,
}: {
  score: number;
  status: PackageStatus;
  size?: number;
}) {
  const color = STATUS_COLOR[status];
  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  return (
    <div
      className="pw-score"
      style={{ width: size, height: size }}
      title={`${status} — ${score}/100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="pw-score__value" style={{ color }}>
        {score}
      </span>
    </div>
  );
}
