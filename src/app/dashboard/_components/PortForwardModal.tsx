// 포트포워딩 모달
// 현재 규칙 목록 + 새 규칙 추가 폼을 표시합니다.

import type { Vm, NewPortForwardForm } from '../types';
import { Modal } from './Modal';

interface PortForwardModalProps {
  vm: Vm;
  form: NewPortForwardForm;
  error: string | null;
  isSubmitting: boolean;
  deletingPfId: string | null;
  onFormChange: (form: NewPortForwardForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onDeletePf: (pfId: string) => void;
  onClose: () => void;
}

export function PortForwardModal({
  vm, form, error, isSubmitting, deletingPfId,
  onFormChange, onSubmit, onDeletePf, onClose,
}: PortForwardModalProps) {
  return (
    <Modal title={`포트포워딩 — ${vm.name}`} onClose={onClose}>
      {!vm.internal_ip ? (
        <p className="text-sm text-text-muted">VM이 시작되어 IP가 할당되면 포트포워딩을 추가할 수 있습니다.</p>
      ) : (
        <>
          <p className="text-sm text-text-muted mb-4">
            VM IP: <code className="bg-bg-secondary px-2 py-1 rounded text-sm">{vm.internal_ip}</code>
          </p>

          {/* 현재 포트포워딩 목록 */}
          {(vm.port_forwards?.length ?? 0) > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">현재 포트포워딩</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {vm.port_forwards.map(pf => (
                  <div key={pf.id} className="flex justify-between items-center bg-bg-secondary p-2 rounded">
                    <div>
                      <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">
                        {pf.protocol.toUpperCase()}
                      </span>
                      <span className="ml-2 text-sm">
                        {pf.external_port ? `${pf.external_port} → ` : ''}{pf.internal_port}
                      </span>
                      {pf.description && (
                        <span className="text-text-muted ml-1 text-sm">({pf.description})</span>
                      )}
                    </div>
                    <button
                      onClick={() => onDeletePf(pf.id)}
                      disabled={deletingPfId === pf.id}
                      className="text-error text-sm hover:text-error/80 disabled:opacity-50"
                    >
                      {deletingPfId === pf.id ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 새 규칙 추가 폼 */}
          <h4 className="text-sm font-medium mb-2">새 포트포워딩 추가</h4>
          {error && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm mb-1 text-text-muted">내부 포트</label>
                <input type="number" min={1} max={65535} value={form.internal_port}
                  onChange={e => onFormChange({ ...form, internal_port: Number(e.target.value) })}
                  className="input" required />
              </div>
              <div>
                <label className="block text-sm mb-1 text-text-muted">외부 포트 (빈칸이면 자동 할당)</label>
                <input type="number" min={1} max={65535} value={form.external_port}
                  onChange={e => onFormChange({ ...form, external_port: e.target.value })}
                  className="input" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm mb-1 text-text-muted">프로토콜</label>
                <select value={form.protocol}
                  onChange={e => onFormChange({ ...form, protocol: e.target.value })}
                  className="input">
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-text-muted">설명 (선택)</label>
                <input type="text" value={form.description}
                  onChange={e => onFormChange({ ...form, description: e.target.value })}
                  className="input" />
              </div>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting ? '추가 중...' : '추가하기'}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
