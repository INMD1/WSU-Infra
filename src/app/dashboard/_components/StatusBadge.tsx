// VM 상태를 색상 배지로 표시합니다.
// running=초록, creating/starting=노랑, 나머지=빨강

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let badgeClass = 'status-error-gcp';
  if (status === 'running') badgeClass = 'status-running-gcp';
  else if (status === 'creating' || status === 'starting') badgeClass = 'status-pending-gcp';

  return <span className={`badge-gcp ${badgeClass}`}>{status}</span>;
}
