/** Shimmer placeholders shown while a scan is in flight, to keep the UI responsive. */

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="pw-skel-list" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="pw-skel-row">
          <span className="pw-skel pw-skel--dot" />
          <span
            className="pw-skel pw-skel--line"
            style={{ width: `${50 + ((i * 7) % 40)}%` }}
          />
          <span className="pw-skel pw-skel--num" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetails() {
  return (
    <div className="pw-skel-details" aria-hidden>
      <div className="pw-skel pw-skel--score" />
      <div className="pw-skel pw-skel--title" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="pw-skel pw-skel--card" />
      ))}
    </div>
  );
}
