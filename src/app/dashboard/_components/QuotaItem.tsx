// 쿼터 단일 항목 — 라벨, 사용량/최대값, 진행 바를 표시
// 90% 초과 시 빨간색으로 경고 표시

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
      <div className="flex justify-between mb-1">
        <span className="text-sm" style={{ color: '#5f6368' }}>{label}</span>
        <span className="text-sm font-medium" style={{ color: '#202124' }}>
          {used} / {total} {unit}
        </span>
      </div>
      <div className="progress-gcp">
        <div
          className="progress-gcp-fill"
          style={{ width: `${percent}%`, background: isWarning ? '#d93025' : '#1a73e8' }}
        />
      </div>
    </div>
  );
}
