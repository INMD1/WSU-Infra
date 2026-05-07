interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let variant = 'status-error';
  if (status === 'running')                              variant = 'status-running';
  else if (status === 'stopped')                         variant = 'status-stopped';
  else if (status === 'creating' || status === 'starting') variant = 'status-pending';

  return <span className={`status-badge ${variant}`}>{status}</span>;
}
