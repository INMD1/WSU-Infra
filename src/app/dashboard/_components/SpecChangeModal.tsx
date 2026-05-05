// VM 사양 변경 모달 (vCPU / RAM)
// VM이 정지 상태일 때만 사용 가능합니다.

import type { Vm } from '../types';
import { Modal } from './Modal';

interface SpecChangeModalProps {
  vm: Vm;
  form: { vcpu: number; ram_gb: number };
  error: string | null;
  isSubmitting: boolean;
  onFormChange: (form: { vcpu: number; ram_gb: number }) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function SpecChangeModal({
  vm, form, error, isSubmitting, onFormChange, onSubmit, onClose,
}: SpecChangeModalProps) {
  return (
    <Modal title={`사양 변경 — ${vm.name}`} onClose={onClose}>
      <p className="text-sm text-text-muted mb-4">
        현재: {vm.vcpu} vCPU / {vm.ram_gb} GB RAM
      </p>
      {error && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm mb-1 text-text-muted">vCPU</label>
            <input type="number" min={1} max={64} value={form.vcpu}
              onChange={e => onFormChange({ ...form, vcpu: Number(e.target.value) })}
              className="input" required />
          </div>
          <div>
            <label className="block text-sm mb-1 text-text-muted">RAM (GB)</label>
            <input type="number" min={1} max={256} value={form.ram_gb}
              onChange={e => onFormChange({ ...form, ram_gb: Number(e.target.value) })}
              className="input" required />
          </div>
        </div>
        <div className="flex gap-4">
          <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
            {isSubmitting ? '변경 중...' : '저장'}
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 bg-border border-none rounded-md px-4 py-2 cursor-pointer hover:bg-border/80 transition-colors">
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
