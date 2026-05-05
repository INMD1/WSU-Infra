// VM 목록 테이블 전체를 렌더링합니다.
// 각 행은 VmTableRow 컴포넌트로 분리되어 있습니다.

import type { Vm } from '../types';
import { OSIcon } from '@/components/OSIcon';
import { StatusBadge } from './StatusBadge';
import { PasswordCell } from './PasswordCell';

interface VmTableProps {
  vms: Vm[];
  actingVmId: string | null;
  visiblePasswords: Record<string, boolean>;
  onTogglePassword: (vmId: string) => void;
  onOpenPortForward: (vm: Vm) => void;
  onOpenConsole: (vmId: string) => void;
  onVmAction: (vmId: string, action: 'start' | 'stop' | 'restart') => void;
  onOpenSpecModal: (vm: Vm) => void;
  onDeleteVm: (vmId: string, vmName: string) => void;
}

export function VmTable({
  vms, actingVmId, visiblePasswords,
  onTogglePassword, onOpenPortForward, onOpenConsole,
  onVmAction, onOpenSpecModal, onDeleteVm,
}: VmTableProps) {
  return (
    <section className="w-full px-8 pb-8">
      <div className="card-gcp">
        <div className="p-6 border-b" style={{ borderColor: '#dadce0' }}>
          <h2 className="text-2xl font-medium" style={{ color: '#202124' }}>가상 머신 목록</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-gcp">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>이름</th>
                <th>상태</th>
                <th>사양</th>
                <th>SSH 비밀번호</th>
                <th>포트포워딩</th>
                <th>콘솔</th>
                <th>작업</th>
                <th>생성일</th>
              </tr>
            </thead>
            <tbody>
              {vms.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12" style={{ color: '#5f6368' }}>
                    생성된 VM이 없습니다.
                  </td>
                </tr>
              ) : vms.map(vm => (
                <VmTableRow
                  key={vm.vm_id}
                  vm={vm}
                  isActing={actingVmId === vm.vm_id}
                  passwordVisible={!!visiblePasswords[vm.vm_id]}
                  onTogglePassword={() => onTogglePassword(vm.vm_id)}
                  onOpenPortForward={() => onOpenPortForward(vm)}
                  onOpenConsole={() => onOpenConsole(vm.vm_id)}
                  onVmAction={(action) => onVmAction(vm.vm_id, action)}
                  onOpenSpecModal={() => onOpenSpecModal(vm)}
                  onDeleteVm={() => onDeleteVm(vm.vm_id, vm.name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ── VM 테이블 단일 행 ─────────────────────────
interface VmTableRowProps {
  vm: Vm;
  isActing: boolean;
  passwordVisible: boolean;
  onTogglePassword: () => void;
  onOpenPortForward: () => void;
  onOpenConsole: () => void;
  onVmAction: (action: 'start' | 'stop' | 'restart') => void;
  onOpenSpecModal: () => void;
  onDeleteVm: () => void;
}

function VmTableRow({
  vm, isActing, passwordVisible,
  onTogglePassword, onOpenPortForward, onOpenConsole,
  onVmAction, onOpenSpecModal, onDeleteVm,
}: VmTableRowProps) {
  const isPowered  = vm.status === 'running';
  const isStarting = vm.status === 'starting' || vm.status === 'creating';

  return (
    <tr>
      <td><OSIcon imageName={vm.name} size="sm" /></td>

      <td className="font-medium" style={{ color: '#202124' }}>{vm.name}</td>

      <td><StatusBadge status={vm.status} /></td>

      <td className="text-sm">
        <div className="flex items-center gap-2">
          <SpecLabel label="vCPU" value={String(vm.vcpu)} />
          <Sep />
          <SpecLabel label="RAM"  value={`${vm.ram_gb}GB`} />
          <Sep />
          <SpecLabel label="Disk" value={`${vm.disk_gb}GB`} />
        </div>
      </td>

      <td>
        {vm.vm_password ? (
          <PasswordCell password={vm.vm_password} visible={passwordVisible} onToggle={onTogglePassword} />
        ) : '—'}
      </td>

      <td>
        <button
          onClick={onOpenPortForward}
          className="btn-gcp-secondary"
          disabled={!vm.internal_ip}
          title={!vm.internal_ip ? 'VM IP가 할당된 후 사용 가능합니다' : ''}
        >
          {(vm.port_forwards?.length ?? 0) > 0 ? `${vm.port_forwards.length}개 보기` : '추가'}
        </button>
      </td>

      <td>
        <button
          onClick={onOpenConsole}
          className="btn-gcp-secondary"
          disabled={!isPowered}
          title={!isPowered ? 'VM이 실행 중일 때만 콘솔에 연결할 수 있습니다' : '새 탭에서 콘솔 열기'}
        >
          콘솔 열기
        </button>
      </td>

      <td>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => onVmAction('start')} className="btn-gcp-text"
            disabled={isActing || isPowered || isStarting} title="VM 시작">▶</button>
          <button onClick={() => onVmAction('stop')} className="btn-gcp-text"
            disabled={isActing || !isPowered} title="VM 정지 (강제 종료)">■</button>
          <button onClick={() => onVmAction('restart')} className="btn-gcp-text"
            disabled={isActing || !isPowered} title="VM 재시작 (하드 리셋)">↻</button>
          <button onClick={onOpenSpecModal} className="btn-gcp-text"
            disabled={isActing || isPowered || isStarting}
            title={isPowered || isStarting ? 'VM 정지 후 사양 변경 가능' : 'CPU/RAM 사양 변경'}>
            사양
          </button>
          <button onClick={onDeleteVm}
            className="bg-surface-cream-strong text-ink border-none rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-error/10 hover:text-error transition-colors disabled:opacity-50"
            disabled={isActing} title="VM 삭제 (디스크 포함)">
            ✕
          </button>
        </div>
      </td>

      <td className="text-sm text-muted">{new Date(vm.created_at).toLocaleDateString()}</td>
    </tr>
  );
}

function SpecLabel({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span style={{ color: '#5f6368' }}>{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Sep() {
  return <span style={{ color: '#5f6368' }}>|</span>;
}
