interface QuotaItemProps {
  label: string;
  used: number;
  total: number;
  unit: string;
}

export function QuotaItem({ label, used, total, unit }: QuotaItemProps) {
  const percent = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0;
  const isWarning = percent > 90;

  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-medium text-ink">
          {used} / {total} {unit}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className={isWarning ? 'progress-fill-error' : 'progress-fill'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
