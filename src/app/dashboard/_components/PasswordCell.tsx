'use client';

interface PasswordCellProps {
  password: string;
  visible: boolean;
  onToggle: () => void;
}

export function PasswordCell({ password, visible, onToggle }: PasswordCellProps) {
  return (
    <div className="flex items-center gap-1">
      <code className="text-sm font-mono text-ink">
        {visible ? password : '••••••••'}
      </code>
      <button onClick={onToggle} className="btn-ghost px-2 py-0.5 text-xs">
        {visible ? '숨기기' : '보기'}
      </button>
      {visible && (
        <button
          onClick={() => navigator.clipboard.writeText(password)}
          className="btn-ghost px-2 py-0.5 text-xs"
        >
          복사
        </button>
      )}
    </div>
  );
}
