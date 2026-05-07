interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ title, onClose, children, width = 520 }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        className="bg-canvas rounded-xl border border-hairline w-full max-h-[90vh] overflow-y-auto"
        style={{ maxWidth: width }}
      >
        <div className="flex justify-between items-center px-8 py-5 border-b border-hairline">
          <h2 className="title-md text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="text-2xl text-muted hover:text-ink cursor-pointer leading-none transition-colors"
          >
            ×
          </button>
        </div>
        <div className="px-8 py-6">{children}</div>
      </div>
    </div>
  );
}
