// VM 생성 모달
// 이름·vCPU·RAM·디스크 입력과 이미지 선택 그리드를 포함합니다.

import type { Image, NewVmForm } from '../types';
import { Modal } from './Modal';
import { OSIcon } from '@/components/OSIcon';

interface CreateVmModalProps {
  username: string;
  images: Image[];
  includeAllImages: boolean;
  form: NewVmForm;
  error: string | null;
  isCreating: boolean;
  onFormChange: (form: NewVmForm) => void;
  onToggleAllImages: (val: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function CreateVmModal({
  username, images, includeAllImages, form, error, isCreating,
  onFormChange, onToggleAllImages, onSubmit, onClose,
}: CreateVmModalProps) {
  return (
    <Modal title="새 가상 머신 생성" onClose={onClose}>
      <p className="text-sm text-text-muted mb-4">
        SSH 비밀번호는 자동 생성되어 생성 후 목록에서 확인할 수 있습니다.
      </p>
      {error && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{error}</div>}

      <form onSubmit={onSubmit}>
        {/* VM 이름 */}
        <label className="block text-sm mb-1 text-text-muted">VM 이름</label>
        <input
          className="input mb-4" type="text"
          value={form.name}
          onChange={e => onFormChange({ ...form, name: e.target.value })}
          placeholder={username ? `자동으로 user-${username}- 접두사가 붙습니다` : '영문/숫자/-/_ 만 허용'}
          pattern="[a-zA-Z0-9_-]+"
          title="영문, 숫자, 하이픈(-), 언더스코어(_) 만 사용 가능"
          required
        />

        {/* vCPU / RAM */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm mb-1 text-text-muted">vCPU</label>
            <input className="input" type="number" min={1} value={form.vcpu}
              onChange={e => onFormChange({ ...form, vcpu: Number(e.target.value) })} required />
          </div>
          <div>
            <label className="block text-sm mb-1 text-text-muted">RAM (GB)</label>
            <input className="input" type="number" min={1} value={form.ram_gb}
              onChange={e => onFormChange({ ...form, ram_gb: Number(e.target.value) })} required />
          </div>
        </div>

        {/* 디스크 */}
        <label className="block text-sm mb-1 text-text-muted">Disk (GB)</label>
        <input className="input mb-4" type="number" min={10} value={form.disk_gb}
          onChange={e => onFormChange({ ...form, disk_gb: Number(e.target.value) })} required />

        {/* 이미지 선택 헤더 */}
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm text-text-muted">이미지 선택 (Content Library)</label>
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
            <input type="checkbox" checked={includeAllImages}
              onChange={e => onToggleAllImages(e.target.checked)} />
            ISO 등 모든 항목 표시
          </label>
        </div>

        {/* 이미지 그리드 */}
        <ImageSelector
          images={images}
          selectedPath={form.image_id}
          includeAllImages={includeAllImages}
          onSelect={(path) => onFormChange({ ...form, image_id: path })}
        />

        {/* 버튼 */}
        <div className="flex gap-4 mt-2">
          <button type="submit" className="btn-primary flex-1" disabled={isCreating}>
            {isCreating ? '요청 중...' : '생성하기'}
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

// ── 이미지 선택 그리드 ────────────────────────
interface ImageSelectorProps {
  images: Image[];
  selectedPath: string;
  includeAllImages: boolean;
  onSelect: (path: string) => void;
}

function ImageSelector({ images, selectedPath, includeAllImages, onSelect }: ImageSelectorProps) {
  if (images.length === 0) {
    return (
      <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md mb-4 text-sm">
        {includeAllImages
          ? 'Content Library에 이미지가 없습니다. 관리자에게 문의하세요.'
          : 'OVA/OVF 항목이 없습니다. ISO도 표시하려면 위 체크박스를 켜세요.'}
      </div>
    );
  }

  const selected = images.find(i => i.library_path === selectedPath);
  const isNotDeployable = selected && selected.type !== 'ova' && selected.type !== 'ovf';

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-2 border border-hairline rounded-md mb-4 bg-surface-soft">
        {images.map(img => (
          <ImageCard
            key={img.library_path}
            img={img}
            isSelected={selectedPath === img.library_path}
            onSelect={() => onSelect(img.library_path)}
          />
        ))}
      </div>
      {isNotDeployable && (
        <div className="text-[10px] text-yellow-800 bg-yellow-50 p-1.5 rounded mb-4">
          ⚠ {selected!.type.toUpperCase()} 항목은 자동 배포가 지원되지 않습니다 — VM 생성 시 실패할 수 있습니다.
        </div>
      )}
    </>
  );
}

// ── 이미지 단일 카드 ──────────────────────────
function ImageCard({ img, isSelected, onSelect }: { img: Image; isSelected: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className={`relative p-3 rounded-md border-2 cursor-pointer transition-all flex flex-col justify-between min-h-[80px] ${
        isSelected ? 'border-primary bg-canvas shadow-sm' : 'border-hairline/50 hover:border-primary/50 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <OSIcon imageName={img.name} size="sm" className="flex-shrink-0" />
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
          img.type === 'ova' ? 'bg-accent-teal/10 text-accent-teal' :
          img.type === 'iso' ? 'bg-accent-amber/10 text-accent-amber' :
          'bg-muted/20 text-muted'
        }`}>
          {img.type}
        </span>
        {img.size_gb > 0 && (
          <span className="text-[10px] text-muted ml-auto">{img.size_gb.toFixed(1)} GB</span>
        )}
      </div>
      <div className={`text-sm word-break-break-all leading-tight ${isSelected ? 'font-semibold text-primary' : 'text-ink'}`}>
        {img.name}
      </div>
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 bg-primary text-white w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm">
          ✓
        </div>
      )}
    </div>
  );
}
