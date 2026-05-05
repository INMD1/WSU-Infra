'use client';

// SSH 비밀번호를 숨김 / 표시 / 클립보드 복사할 수 있는 셀 컴포넌트

interface PasswordCellProps {
  password: string;
  visible: boolean;
  onToggle: () => void;
}

export function PasswordCell({ password, visible, onToggle }: PasswordCellProps) {
  return (
    <div className="flex items-center gap-1">
      <code className="text-sm" style={{ color: '#202124' }}>
        {visible ? password : '••••••••'}
      </code>
      <button onClick={onToggle} className="btn-gcp-text px-2 py-0.5 text-xs">
        {visible ? '숨기기' : '보기'}
      </button>
      {visible && (
        <button
          onClick={() => navigator.clipboard.writeText(password)}
          className="btn-gcp-text px-2 py-0.5 text-xs"
        >
          복사
        </button>
      )}
    </div>
  );
}
