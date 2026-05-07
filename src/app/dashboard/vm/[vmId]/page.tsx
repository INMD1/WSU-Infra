'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { OSIcon } from '@/components/OSIcon';
import { StatusBadge } from '../../_components/StatusBadge';
import type { Vm, PortForward } from '@/types/dashboard';

export default function VmDetailPage() {
  const params = useParams();
  const router = useRouter();
  const vmId = typeof params.vmId === 'string' ? params.vmId : '';

  const [vm, setVm] = useState<Vm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPortForwardModal, setShowPortForwardModal] = useState(false);
  const [newPf, setNewPf] = useState({ internal_port: '', external_port: '', protocol: 'tcp', description: '' });
  const [pfError, setPfError] = useState('');
  const [pfSubmitting, setPfSubmitting] = useState(false);

  // VM 정보 조회
  useEffect(() => {
    async function fetchVm() {
      try {
        const res = await fetch(`/api/vms/${vmId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } });
        if (!res.ok) throw new Error('VM 정보를 불러오지 못했습니다.');
        const data = await res.json();
        setVm(data);
      } catch (e: any) {
        setError(e.message || '오류 발생');
      } finally {
        setLoading(false);
      }
    }
    if (vmId) fetchVm();
  }, [vmId]);

  // VM 액션 핸들러
  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setActing(true);
    try {
      const res = await fetch(`/api/vms/${vmId}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
      });
      if (!res.ok) throw new Error('작업 실패');
      // 상태 업데이트
      const updated = await fetch(`/api/vms/${vmId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } }).then(r => r.json());
      setVm(updated);
    } catch (e: any) {
      alert(e.message || '작업 중 오류 발생');
    } finally {
      setActing(false);
    }
  };

  // 사양 변경
  const handleSpecChange = async () => {
    const vcpu = prompt('vCPU 변경 (현재: ' + vm?.vcpu + ')');
    if (!vcpu) return;
    const ram_gb = prompt('RAM 변경 GB (현재: ' + vm?.ram_gb + ')');
    if (!ram_gb) return;

    setActing(true);
    try {
      const res = await fetch(`/api/vms/${vmId}/spec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({ vcpu: parseInt(vcpu), ram_gb: parseInt(ram_gb) })
      });
      if (!res.ok) throw new Error('사양 변경 실패');
      const updated = await fetch(`/api/vms/${vmId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } }).then(r => r.json());
      setVm(updated);
    } catch (e: any) {
      alert(e.message || '사양 변경 중 오류 발생');
    } finally {
      setActing(false);
    }
  };

  // VM 삭제
  const handleDelete = async () => {
    if (!confirm('VM 과 디스크를 완전히 삭제하시겠습니까?')) return;
    setActing(true);
    try {
      const res = await fetch(`/api/vms/${vmId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
      });
      if (!res.ok) throw new Error('삭제 실패');
      router.push('/dashboard');
    } catch (e: any) {
      alert(e.message || '삭제 중 오류 발생');
    } finally {
      setActing(false);
    }
  };

  // 포트포워딩 생성
  const handleCreatePf = async (e: React.FormEvent) => {
    e.preventDefault();
    setPfSubmitting(true);
    setPfError('');
    try {
      const res = await fetch('/api/port-forwards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          vm_id: vmId,
          internal_port: parseInt(newPf.internal_port),
          external_port: newPf.external_port ? parseInt(newPf.external_port) : undefined,
          protocol: newPf.protocol,
          description: newPf.description
        })
      });
      if (!res.ok) throw new Error('포트포워딩 생성 실패');
      // VM 정보 다시 조회 (포트포워딩 목록 업데이트)
      const updated = await fetch(`/api/vms/${vmId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } }).then(r => r.json());
      setVm(updated);
      setShowPortForwardModal(false);
      setNewPf({ internal_port: '', external_port: '', protocol: 'tcp', description: '' });
    } catch (e: any) {
      setPfError(e.message || '오류 발생');
    } finally {
      setPfSubmitting(false);
    }
  };

  // 포트포워딩 삭제
  const handleDeletePf = async (pfId: string) => {
    if (!confirm('이 포트포워딩 규칙을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/port-forwards/${pfId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
      });
      if (!res.ok) throw new Error('삭제 실패');
      const updated = await fetch(`/api/vms/${vmId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } }).then(r => r.json());
      setVm(updated);
    } catch (e: any) {
      alert(e.message || '삭제 중 오류 발생');
    }
  };

  if (loading) return <div className="container min-h-[60vh] flex items-center justify-center text-muted">로딩 중...</div>;
  if (error || !vm) return <div className="container min-h-[60vh] flex items-center justify-center text-error">{error || 'VM 을 찾을 수 없습니다.'}</div>;

  const isPowered = vm.status === 'running';
  const isStarting = vm.status === 'starting' || vm.status === 'creating';

  return (
    <div className="min-h-screen bg-canvas">
      {/* 헤더 */}
      <div className="bg-surface-card border-b border-hairline">
        <div className="container px-8 py-6">
          <button onClick={() => router.back()} className="btn-ghost mb-4 hover:bg-surface-soft">← 목록으로</button>
          <div className="flex items-center gap-4">
            <OSIcon imageName={vm.name} size="md" />
            <div>
              <h1 className="display-sm text-ink">{vm.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <StatusBadge status={vm.status} />
                <span className="text-sm text-muted">ID: {vm.vm_id.slice(0, 8)}...</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 기본 정보 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 사양 */}
            <div className="bg-surface-card rounded-lg border border-hairline p-6">
              <h2 className="title-md text-ink mb-4">사양</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted mb-1">vCPU</div>
                  <div className="text-lg font-semibold text-ink">{vm.vcpu} 코어</div>
                </div>
                <div>
                  <div className="text-sm text-muted mb-1">RAM</div>
                  <div className="text-lg font-semibold text-ink">{vm.ram_gb} GB</div>
                </div>
                <div>
                  <div className="text-sm text-muted mb-1">디스크</div>
                  <div className="text-lg font-semibold text-ink">{vm.disk_gb} GB</div>
                </div>
              </div>
            </div>


            {/* 포트포워딩 */}
            <div className="bg-surface-card rounded-lg border border-hairline p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="title-md text-ink">포트포워딩</h2>
                {vm.internal_ip && (
                  <button onClick={() => setShowPortForwardModal(true)} className="btn-secondary text-sm">
                    + 추가
                  </button>
                )}
              </div>
              {vm.port_forwards && vm.port_forwards.length > 0 ? (
                <div className="space-y-2">
                  {vm.port_forwards.map(pf => (
                    <div key={pf.id} className="flex items-center justify-between py-2 px-3 bg-surface-soft rounded">
                      <div className="text-sm">
                        <span className="font-medium text-ink">{pf.protocol.toUpperCase()}</span>
                        <span className="text-muted mx-2">{pf.external_port ? `${pf.external_port}` : '자동'} → {pf.internal_ip}:{pf.internal_port}</span>
                        {pf.description && <span className="text-muted ml-2">({pf.description})</span>}
                      </div>
                      <button onClick={() => handleDeletePf(pf.id)} className="text-error hover:text-error-strong text-sm">삭제</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted py-4 text-center">포트포워딩 규칙이 없습니다.</div>
              )}
            </div>
          </div>

          {/* 사이드바 */}
          <div className="space-y-6">
            {/* 정보 카드 */}
            <div className="bg-surface-card rounded-lg border border-hairline p-6">
              <h3 className="title-sm text-ink mb-4">정보</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-muted">생성일</span>
                  <span className="text-ink">{new Date(vm.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted">상태</span>
                  <span className="text-ink capitalize">{vm.status}</span>
                </div>

                <h2 className="title-md text-ink mb-4">네트워크 및 SSH 비빌번호</h2>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-hairline">
                    <span className="text-muted">내부 IP</span>
                    <span className="font-medium text-ink">{vm.internal_ip || '할당되지 않음'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-hairline">
                    <span className="text-muted">SSH 비밀번호</span>
                    <div className="flex items-center gap-2">
                      {vm.vm_password && (
                        <>
                          <span className="font-mono text-ink">
                            {showPassword ? vm.vm_password : '••••••••••••'}
                          </span>
                          <button onClick={() => setShowPassword(!showPassword)} className="btn-ghost text-xs">
                            {showPassword ? '숨기기' : '보기'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {/* 작업 */}
                <div className="bg-surface-card rounded-lg border border-hairline p-6">
                  <h2 className="title-md text-ink mb-4">작업</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleAction('start')} className="btn-secondary" disabled={acting || isPowered || isStarting}>▶ 시작</button>
                    <button onClick={() => handleAction('stop')} className="btn-secondary" disabled={acting || !isPowered}>■ 정지</button>
                    <button onClick={() => handleAction('restart')} className="btn-secondary" disabled={acting || !isPowered}>↻ 재시작</button>
                    <button onClick={handleSpecChange} className="btn-secondary" disabled={acting || isPowered || isStarting}>⚙ 사양 변경</button>
                    <button onClick={() => window.open(`/console/${vm.vm_id}`, '_blank')} className="btn-secondary" disabled={!isPowered}>🖥 콘솔</button>
                    <button onClick={handleDelete} className="btn-ghost hover:bg-error/10 hover:text-error" disabled={acting}>✕ 삭제</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 포트포워딩 추가 모달 */}
      {showPortForwardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-canvas rounded-xl border border-hairline ">
            <div className="flex justify-between items-center px-6 py-4 border-b border-hairline">
              <h3 className="title-md text-ink">포트포워딩 추가</h3>
              <button onClick={() => setShowPortForwardModal(false)} className="text-2xl text-muted hover:text-ink cursor-pointer">×</button>
            </div>
            <form onSubmit={handleCreatePf} className="px-6 py-5">
              <div className="mb-4">
                <label className="block text-sm font-medium text-body-strong mb-1">내부 포트</label>
                <input type="number" className="input" value={newPf.internal_port} onChange={e => setNewPf({ ...newPf, internal_port: e.target.value })} required min={1} max={65535} />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-body-strong mb-1">외부 포트 (비우면 자동 할당)</label>
                <input type="number" className="input" value={newPf.external_port} onChange={e => setNewPf({ ...newPf, external_port: e.target.value })} min={1} max={65535} />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-body-strong mb-1">프로토콜</label>
                <select className="input" value={newPf.protocol} onChange={e => setNewPf({ ...newPf, protocol: e.target.value })}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-body-strong mb-1">설명</label>
                <input type="text" className="input" value={newPf.description} onChange={e => setNewPf({ ...newPf, description: e.target.value })} />
              </div>
              {pfError && <div className="alert-error mb-4">{pfError}</div>}
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1" disabled={pfSubmitting}>추가</button>
                <button type="button" onClick={() => setShowPortForwardModal(false)} className="btn-secondary flex-1">취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
