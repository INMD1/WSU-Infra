// 재사용 가능한 모달 컴포넌트
// 어두운 오버레이 배경 + 흰색 카드를 제공합니다.
// 새로운 모달을 만들 때 이 컴포넌트를 감싸서 사용하세요.

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ title, onClose, children, width = 520 }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-h-[90vh] overflow-y-auto mb-0" style={{ maxWidth: width }}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl text-text-muted cursor-pointer leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
