'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { OSIcon } from '@/components/OSIcon';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

function authFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────
interface PortForward {
  id: string;
  vm_id: string | null;
  protocol: string;
  internal_ip: string;
  internal_port: number;
  external_ip: string;
  external_port: number;
  description: string | null;
  created_at: string;
}

interface Vm {
  vm_id: string;
  name: string;
  status: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  internal_ip: string | null;
  vm_password: string | null;
  port_forwards: PortForward[];
  created_at: string;
}

// ────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────
export default function DashboardPage() {
  const [quotas, setQuotas] = useState<any>(null);
  const [vms, setVms] = useState<Vm[]>([]);
  const [images, setImages] = useState<{ name: string; size_gb: number; library_path: string; type: string }[]>([]);
  const [includeAllImages, setIncludeAllImages] = useState(false);
  const [loading, setLoading] = useState(true);

  // VM 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVm, setNewVm] = useState({ name: '', vcpu: 2, ram_gb: 4, disk_gb: 40, image_id: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Job 진행 모달
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [createResult, setCreateResult] = useState<{ jobId: string; estimatedWait: number } | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);

  // 비밀번호 표시
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // 포트포워딩 모달
  const [pfVm, setPfVm] = useState<Vm | null>(null);
  const [newPf, setNewPf] = useState({ internal_port: 22, external_port: '', protocol: 'tcp', description: '' });
  const [pfError, setPfError] = useState<string | null>(null);
  const [pfSubmitting, setPfSubmitting] = useState(false);
  const [deletingPfId, setDeletingPfId] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const router = useRouter();

  // ── 데이터 로딩 ──────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ownerId = localStorage.getItem('owner_id');
      const quotaUrl = ownerId ? `/api/quotas?userId=${encodeURIComponent(ownerId)}` : '/api/quotas';
      const [quotaRes, vmsRes] = await Promise.all([
        authFetch(quotaUrl),
        authFetch('/api/vms'),
      ]);
      if (quotaRes.status === 401) { router.push('/login'); return; }
      setQuotas(await quotaRes.json());
      const vmsJson = await vmsRes.json();
      const list: Vm[] = vmsJson.data || [];
      setVms(list);
      // 열려 있는 포트포워딩 모달 VM 데이터도 갱신
      setPfVm(prev => prev ? (list.find(v => v.vm_id === prev.vm_id) ?? null) : null);
    } catch {
      console.error('fetchData failed');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    setUsername(localStorage.getItem('username') || '');
    setRole(localStorage.getItem('role') || '');
    fetchData();

    // 페이지 새로고침 시 진행 중이던 vm-create job 이 있으면 폴링 재개
    authFetch('/api/jobs?active=true')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const active = d?.activeJobs ?? [];
        if (active.length > 0) {
          const job = active[0];
          setCreateResult({ jobId: job.jobId, estimatedWait: 0 });
          startJobPolling(job.jobId);
        }
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, router]);

  // 이미지 목록 — 토글에 반응해서 재조회
  useEffect(() => {
    const url = `/api/images?source=library${includeAllImages ? '&include=all' : ''}`;
    authFetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = d?.data || [];
        setImages(list);
        // 현재 선택값이 새 목록에 없으면 첫 항목으로 재설정
        setNewVm(p => {
          const stillValid = list.some((img: { library_path: string }) => img.library_path === p.image_id);
          if (stillValid) return p;
          return { ...p, image_id: list[0]?.library_path ?? '' };
        });
      })
      .catch(() => { });
  }, [includeAllImages]);

  // ── VM 생성 ───────────────────────────────────
  const handleCreateVm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await authFetch('/api/vms', { method: 'POST', body: JSON.stringify(newVm) });
      const data = await res.json();
      if (res.ok) {
        setCreateResult({ jobId: data.jobId, estimatedWait: data.estimatedWaitSeconds });
        setShowCreateModal(false);
        startJobPolling(data.jobId);
      } else {
        setCreateError(data.message || 'VM 생성 실패');
      }
    } catch {
      setCreateError('네트워크 오류');
    } finally {
      setIsCreating(false);
    }
  };

  const startJobPolling = (jobId: string) => {
    setShowJobsModal(true);
    const poll = async () => {
      try {
        const res = await authFetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        setJobStatus(data);
        // VM 리스트도 함께 갱신 — power-on 직후 등록된 VM 을 IP 대기 중에도 즉시 노출
        fetchData();
        if (data.status === 'completed' || data.status === 'failed') {
          setTimeout(() => { setCreateResult(null); setJobStatus(null); setShowJobsModal(false); }, 3000);
          return;
        }
        setTimeout(poll, 2000);
      } catch { /* ignore */ }
    };
    poll();
  };

  // ── 포트포워딩 생성 ───────────────────────────
  const handleCreatePf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pfVm?.internal_ip) return;
    setPfSubmitting(true);
    setPfError(null);
    try {
      const body: any = {
        vm_id: pfVm.vm_id,
        internal_ip: pfVm.internal_ip,
        internal_port: Number(newPf.internal_port),
        protocol: newPf.protocol,
        description: newPf.description || undefined,
      };
      if (newPf.external_port !== '') body.external_port = Number(newPf.external_port);

      const res = await authFetch('/api/port-forwards', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        setNewPf({ internal_port: 22, external_port: '', protocol: 'tcp', description: '' });
        fetchData();
      } else {
        setPfError(data.message || '생성 실패');
      }
    } catch {
      setPfError('네트워크 오류');
    } finally {
      setPfSubmitting(false);
    }
  };

  // ── VM 전원 제어 (시작/정지/재시작) ─────────
  const [actingVmId, setActingVmId] = useState<string | null>(null);
  const handleVmAction = async (vmId: string, action: 'start' | 'stop' | 'restart') => {
    const labels = { start: '시작', stop: '정지', restart: '재시작' } as const;
    setActingVmId(vmId);
    try {
      const res = await authFetch(`/api/vms/${vmId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`${labels[action]} 실패: ${data.message || data.error || ''}`);
      }
      fetchData();
    } catch {
      alert('네트워크 오류');
    } finally {
      setActingVmId(null);
    }
  };

  // ── VM 사양 변경 ──────────────────────────────
  const [specVm, setSpecVm] = useState<Vm | null>(null);
  const [specForm, setSpecForm] = useState({ vcpu: 2, ram_gb: 4 });
  const [specError, setSpecError] = useState<string | null>(null);
  const [specSubmitting, setSpecSubmitting] = useState(false);
  const openSpecModal = (vm: Vm) => {
    setSpecVm(vm);
    setSpecForm({ vcpu: vm.vcpu, ram_gb: vm.ram_gb });
    setSpecError(null);
  };
  const handleSpecSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!specVm) return;
    setSpecSubmitting(true);
    setSpecError(null);
    try {
      const res = await authFetch(`/api/vms/${specVm.vm_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ vcpu: specForm.vcpu, ram_gb: specForm.ram_gb }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSpecError(data.message || data.error || '변경 실패');
        return;
      }
      setSpecVm(null);
      fetchData();
    } catch {
      setSpecError('네트워크 오류');
    } finally {
      setSpecSubmitting(false);
    }
  };

  // ── VM 삭제 ───────────────────────────────────
  const handleDeleteVm = async (vmId: string, vmName: string) => {
    if (!confirm(`정말 "${vmName}"을 (를) 삭제하시겠습니까? 디스크와 포트포워딩까지 모두 제거됩니다.`)) return;
    setActingVmId(vmId);
    try {
      const res = await authFetch(`/api/vms/${vmId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        alert(`삭제 실패: ${data.message || data.error || ''}`);
      }
      fetchData();
    } catch {
      alert('네트워크 오류');
    } finally {
      setActingVmId(null);
    }
  };

  // ── 웹콘솔 열기 (자체 호스팅 wmks.js → ESXi WebMKS 직접 연결) ──
  const handleOpenConsole = (vmId: string) => {
    window.open(`/console/${vmId}`, '_blank', 'noopener,noreferrer');
  };

  // ── 포트포워딩 삭제 ───────────────────────────
  const handleDeletePf = async (pfId: string) => {
    if (!confirm('이 포트포워딩 규칙을 삭제하시겠습니까?')) return;
    setDeletingPfId(pfId);
    try {
      const res = await authFetch(`/api/port-forwards/${pfId}`, { method: 'DELETE' });
      if (res.ok) fetchData();
      else {
        const d = await res.json();
        alert(d.message || '삭제 실패');
      }
    } catch {
      alert('네트워크 오류');
    } finally {
      setDeletingPfId(null);
    }
  };

  const handleLogout = () => { localStorage.clear(); router.push('/login'); };

  if (loading && !quotas) return <div className="container">로딩 중...</div>;

  return (
    <div className="min-h-screen w-full gcp-bg">
      <SidebarProvider>
        <AppSidebar />
        <main className="w-full">
          <SidebarTrigger className="ml-4 mt-4" />
          {/* ── Header ── */}
          <header className="w-full px-8 py-8">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-6">
              <div>
                <h1 className="text-4xl font-medium mb-1" style={{ color: '#202124' }}>클라우드 대시보드</h1>
                <p className="text-xs uppercase tracking-wider" style={{ color: '#5f6368' }}>학번: {username}</p>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                {createResult && (
                  <button className="btn-gcp-secondary" onClick={() => setShowJobsModal(true)}>대기열 보기</button>
                )}
                {role === 'admin' && (
                  <button className="btn-gcp-secondary" onClick={() => router.push('/admin')}>관리자 패널</button>
                )}
                <button className="btn-gcp-primary" onClick={() => setShowCreateModal(true)}>새 VM 생성</button>
                <button
                  onClick={handleLogout}
                  className="btn-gcp-text"
                >
                  로그아웃
                </button>
              </div>
            </div>
          </header>

          {/* ── Quota ── */}
          {quotas && (
            <section className="w-full px-8 pb-8">
              <div className="card-gcp p-6">
                <h2 className="text-2xl font-medium mb-6" style={{ color: '#202124' }}>내 쿼터 사용량</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
                  <QuotaItem label="VM 개수" used={quotas.usage?.vm_count ?? 0} total={quotas.quota?.max_vm_count ?? 5} unit="개" />
                  <QuotaItem label="vCPU" used={quotas.usage?.vcpu_total ?? 0} total={quotas.quota?.max_vcpu_total ?? 3} unit="Core" />
                  <QuotaItem label="RAM" used={quotas.usage?.ram_gb_total ?? 0} total={quotas.quota?.max_ram_gb_total ?? 8} unit="GB" />
                  <QuotaItem label="디스크" used={quotas.usage?.disk_gb_total ?? 0} total={quotas.quota?.max_disk_gb_total ?? 100} unit="GB" />
                  <QuotaItem label="포트" used={quotas.usage?.ports_used ?? 0} total={quotas.quota?.max_public_ports ?? 10} unit="개" />
                </div>
              </div>
            </section>
          )}

          {/* ── VM 목록 ── */}
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
                      <tr><td colSpan={9} className="text-center py-12" style={{ color: '#5f6368' }}>생성된 VM 이 없습니다.</td></tr>
                    ) : vms.map(vm => (
                      <tr key={vm.vm_id}>
                        <td className="flex items-center">
                          <OSIcon imageName={vm.name} size="sm" />
                        </td>
                        <td className="font-medium" style={{ color: '#202124' }}>{vm.name}</td>
                        <td><StatusBadge status={vm.status} /></td>
                        <td className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1">
                              <span style={{ color: '#5f6368' }}>vCPU</span>
                              <span className="font-medium">{vm.vcpu}</span>
                            </span>
                            <span style={{ color: '#5f6368' }}>|</span>
                            <span className="inline-flex items-center gap-1">
                              <span style={{ color: '#5f6368' }}>RAM</span>
                              <span className="font-medium">{vm.ram_gb}GB</span>
                            </span>
                            <span style={{ color: '#5f6368' }}>|</span>
                            <span className="inline-flex items-center gap-1">
                              <span style={{ color: '#5f6368' }}>Disk</span>
                              <span className="font-medium">{vm.disk_gb}GB</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          {vm.vm_password ? (
                            <PasswordCell password={vm.vm_password}
                              visible={!!visiblePasswords[vm.vm_id]}
                              onToggle={() => setVisiblePasswords(p => ({ ...p, [vm.vm_id]: !p[vm.vm_id] }))}
                            />
                          ) : '—'}
                        </td>
                        <td>
                          <button
                            onClick={() => { setPfVm(vm); setPfError(null); }}
                            className="btn-gcp-secondary"
                            disabled={!vm.internal_ip}
                            title={!vm.internal_ip ? 'VM IP 가 할당된 후 사용 가능합니다' : ''}
                          >
                            {vm.port_forwards?.length > 0 ? `${vm.port_forwards.length}개 보기` : '추가'}
                          </button>
                        </td>
                        <td>
                          <button
                            onClick={() => handleOpenConsole(vm.vm_id)}
                            className="btn-gcp-secondary"
                            disabled={vm.status !== 'running'}
                            title={vm.status !== 'running' ? 'VM 이 실행 중일 때만 콘솔에 연결할 수 있습니다' : '새 탭에서 vSphere HTML5 콘솔 열기'}
                          >
                            콘솔 열기
                          </button>
                        </td>
                        <td>
                          <div className="flex gap-1 flex-wrap">
                            <button
                              onClick={() => handleVmAction(vm.vm_id, 'start')}
                              className="btn-gcp-text"
                              disabled={actingVmId === vm.vm_id || vm.status === 'running' || vm.status === 'starting'}
                              title="VM 시작"
                            >
                              ▶
                            </button>
                            <button
                              onClick={() => handleVmAction(vm.vm_id, 'stop')}
                              className="btn-gcp-text"
                              disabled={actingVmId === vm.vm_id || vm.status !== 'running'}
                              title="VM 정지 (강제 종료)"
                            >
                              ■
                            </button>
                            <button
                              onClick={() => handleVmAction(vm.vm_id, 'restart')}
                              className="btn-gcp-text"
                              disabled={actingVmId === vm.vm_id || vm.status !== 'running'}
                              title="VM 재시작 (하드 리셋)"
                            >
                              ↻
                            </button>
                            <button
                              onClick={() => openSpecModal(vm)}
                              className="btn-gcp-text"
                              disabled={actingVmId === vm.vm_id || vm.status === 'running' || vm.status === 'starting'}
                              title={vm.status === 'running' || vm.status === 'starting' ? 'VM 정지 후 사양 변경 가능' : 'CPU/RAM 사양 변경'}
                            >
                              사양
                            </button>
                            <button
                              onClick={() => handleDeleteVm(vm.vm_id, vm.name)}
                              className="bg-surface-cream-strong text-ink border-none rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-error/10 hover:text-error transition-colors disabled:opacity-50"
                              disabled={actingVmId === vm.vm_id}
                              title="VM 삭제 (디스크 포함)"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                        <td className="text-sm text-muted">{new Date(vm.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── 포트포워딩 모달 ── */}
          {pfVm && (
            <Modal onClose={() => setPfVm(null)} title={`포트포워딩 — ${pfVm.name}`}>
              {!pfVm.internal_ip ? (
                <p className="text-sm text-text-muted">VM 이 시작되어 IP 가 할당되면 포트포워딩을 추가할 수 있습니다.</p>
              ) : (
                <>
                  <p className="text-sm text-text-muted mb-4">
                    VM IP: <code className="bg-bg-secondary px-2 py-1 rounded text-sm">{pfVm.internal_ip}</code>
                  </p>
                  {pfVm.port_forwards?.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium mb-2">현재 포트포워딩</h4>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {pfVm.port_forwards.map(pf => (
                          <div key={pf.id} className="flex justify-between items-center bg-bg-secondary p-2 rounded">
                            <div>
                              <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">{pf.protocol.toUpperCase()}</span>
                              <span className="ml-2 text-sm">
                                {pf.external_port ? `${pf.external_port} → ` : ''}{pf.internal_port}
                              </span>
                              {pf.description && <span className="text-text-muted ml-1 text-sm">({pf.description})</span>}
                            </div>
                            <button
                              onClick={() => handleDeletePf(pf.id)}
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
                  <h4 className="text-sm font-medium mb-2">새 포트포워딩 추가</h4>
                  {pfError && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{pfError}</div>}
                  <form onSubmit={handleCreatePf}>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm mb-1 text-text-muted">내부 포트</label>
                        <input type="number" min={1} max={65535} value={newPf.internal_port}
                          onChange={e => setNewPf(p => ({ ...p, internal_port: Number(e.target.value) }))}
                          className="input" required />
                      </div>
                      <div>
                        <label className="block text-sm mb-1 text-text-muted">외부 포트 (선택, 공백이면 자동 할당)</label>
                        <input type="number" min={1} max={65535} value={newPf.external_port}
                          onChange={e => setNewPf(p => ({ ...p, external_port: e.target.value }))}
                          className="input" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm mb-1 text-text-muted">프로토콜</label>
                        <select value={newPf.protocol} onChange={e => setNewPf(p => ({ ...p, protocol: e.target.value }))} className="input">
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm mb-1 text-text-muted">설명 (선택)</label>
                        <input type="text" value={newPf.description}
                          onChange={e => setNewPf(p => ({ ...p, description: e.target.value }))}
                          className="input" />
                      </div>
                    </div>
                    <button type="submit" className="btn-primary w-full" disabled={pfSubmitting}>
                      {pfSubmitting ? '추가 중...' : '추가하기'}
                    </button>
                  </form>
                </>
              )}
            </Modal>
          )}

          {/* ── VM 사양 변경 모달 ── */}
          {specVm && (
            <Modal onClose={() => setSpecVm(null)} title={`사양 변경 — ${specVm.name}`}>
              <p className="text-sm text-text-muted mb-4">
                현재: {specVm.vcpu} vCPU / {specVm.ram_gb} GB RAM
              </p>
              {specError && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{specError}</div>}
              <form onSubmit={handleSpecSubmit}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm mb-1 text-text-muted">vCPU</label>
                    <input type="number" min={1} max={64} value={specForm.vcpu}
                      onChange={e => setSpecForm(p => ({ ...p, vcpu: Number(e.target.value) }))}
                      className="input" required />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-text-muted">RAM (GB)</label>
                    <input type="number" min={1} max={256} value={specForm.ram_gb}
                      onChange={e => setSpecForm(p => ({ ...p, ram_gb: Number(e.target.value) }))}
                      className="input" required />
                  </div>
                </div>
                <div className="flex gap-4">
                  <button type="submit" className="btn-primary flex-1" disabled={specSubmitting}>
                    {specSubmitting ? '변경 중...' : '저장'}
                  </button>
                  <button type="button" onClick={() => setSpecVm(null)}
                    className="flex-1 bg-border border-none rounded-md px-4 py-2 cursor-pointer hover:bg-border/80 transition-colors">
                    취소
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* ── VM 생성 모달 ── */}
          {showCreateModal && (
            <Modal onClose={() => { setShowCreateModal(false); setCreateError(null); }} title="새 가상 머신 생성">
              <p className="text-sm text-text-muted mb-4">
                SSH 비밀번호는 자동 생성되어 생성 후 목록에서 확인할 수 있습니다.
              </p>
              {createError && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">{createError}</div>}
              <form onSubmit={handleCreateVm}>
                <label className="block text-sm mb-1 text-text-muted">VM 이름</label>
                <input className="input mb-4" type="text" value={newVm.name}
                  onChange={e => setNewVm(p => ({ ...p, name: e.target.value }))}
                  placeholder={username ? `자동으로 user-${username}- 접두사가 붙습니다` : '영문/숫자/-/_ 만 허용'}
                  pattern="[a-zA-Z0-9_-]+"
                  title="영문, 숫자, 하이픈 (-), 언더스코어 (_) 만 사용 가능"
                  required />

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm mb-1 text-text-muted">vCPU</label>
                    <input className="input" type="number" min={1} value={newVm.vcpu}
                      onChange={e => setNewVm(p => ({ ...p, vcpu: Number(e.target.value) }))} required />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-text-muted">RAM (GB)</label>
                    <input className="input" type="number" min={1} value={newVm.ram_gb}
                      onChange={e => setNewVm(p => ({ ...p, ram_gb: Number(e.target.value) }))} required />
                  </div>
                </div>

                <label className="block text-sm mb-1 text-text-muted">Disk (GB)</label>
                <input className="input mb-4" type="number" min={10} value={newVm.disk_gb}
                  onChange={e => setNewVm(p => ({ ...p, disk_gb: Number(e.target.value) }))} required />

                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm mb-1 text-text-muted">이미지 선택 (Content Library)</label>
                  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                    <input type="checkbox" checked={includeAllImages}
                      onChange={e => setIncludeAllImages(e.target.checked)} />
                    ISO 등 모든 항목 표시
                  </label>
                </div>

                {images.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-2 border border-hairline rounded-md mb-4 bg-surface-soft">
                    {images.map(img => {
                      const isSelected = newVm.image_id === img.library_path;
                      const isDeployable = img.type === 'ova' || img.type === 'ovf';
                      return (
                        <div
                          key={img.library_path}
                          onClick={() => setNewVm(p => ({ ...p, image_id: img.library_path }))}
                          className={`relative p-3 rounded-md border-2 cursor-pointer transition-all flex flex-col justify-between min-h-[80px] ${isSelected
                              ? 'border-primary bg-canvas shadow-sm'
                              : 'border-hairline/50 hover:border-primary/50 bg-white'
                            } ${isDeployable || isSelected ? 'opacity-100' : 'opacity-70'}`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <OSIcon imageName={img.name} size="sm" className="flex-shrink-0" />
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${img.type === 'ova' ? 'bg-accent-teal/10 text-accent-teal' :
                                img.type === 'iso' ? 'bg-accent-amber/10 text-accent-amber' : 'bg-muted/20 text-muted'
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
                            <div className="absolute -top-1.5 -right-1.5 bg-primary text-white w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm">✓</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md mb-4 text-sm">
                    {includeAllImages
                      ? 'Content Library 에 이미지가 없습니다. 관리자에게 문의하세요.'
                      : 'OVA/OVF 항목이 없습니다. ISO 도 표시하려면 위 체크박스를 켜세요.'}
                  </div>
                )}

                {newVm.image_id && (() => {
                  const sel = images.find(i => i.library_path === newVm.image_id);
                  if (sel && sel.type !== 'ova' && sel.type !== 'ovf') {
                    return (
                      <div className="text-[10px] text-yellow-800 bg-yellow-50 p-1.5 rounded mb-4">
                        ⚠ {sel.type.toUpperCase()} 항목은 자동 배포가 지원되지 않습니다 — VM 생성 시 실패할 수 있습니다.
                      </div>
                    );
                  }
                  return <div className="mb-2" />;
                })()}

                <div className="flex gap-4">
                  <button type="submit" className="btn-primary flex-1" disabled={isCreating}>
                    {isCreating ? '요청 중...' : '생성하기'}
                  </button>
                  <button type="button" onClick={() => { setShowCreateModal(false); setCreateError(null); }}
                    className="flex-1 bg-border border-none rounded-md px-4 py-2 cursor-pointer hover:bg-border/80 transition-colors">
                    취소
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* ── Job 진행 모달 ── */}
          {showJobsModal && createResult && (
            <Modal onClose={() => setShowJobsModal(false)} title="VM 생성 진행 상황">
              <div className="mb-6">
                <div className="text-sm text-text-muted mb-1">Job ID</div>
                <code className="block p-2 bg-bg-secondary rounded text-sm">
                  {createResult.jobId}
                </code>
              </div>
              {jobStatus ? (
                <>
                  <div className={`p-2.5 rounded-md font-medium mb-4 ${jobStatus.status === 'completed' ? 'bg-green-100 text-green-800' :
                      jobStatus.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                    {jobStatus.status === 'completed' ? '완료 — VM 목록을 확인하세요' :
                      jobStatus.status === 'failed' ? '실패' : '처리 중...'}
                  </div>
                  {jobStatus.status === 'running' && (
                    <div className="progress-bar mb-4">
                      <div className="progress-fill" style={{ width: '100%', animation: 'pulse 1.5s infinite' }} />
                    </div>
                  )}
                  {jobStatus.error && <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm"><strong>오류:</strong> {jobStatus.error}</div>}
                </>
              ) : (
                <p className="text-center text-text-muted">
                  예상 대기: {Math.round(createResult.estimatedWait)}초
                </p>
              )}
              <button className="btn-primary w-full mt-4"
                onClick={() => setShowJobsModal(false)}>닫기</button>
            </Modal>
          )}
        </main>
      </SidebarProvider>

    </div>
  );
}

// ────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────
function Modal({ children, onClose, title, width = 520 }: {
  children: React.ReactNode; onClose: () => void; title: string; width?: number;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto mb-0" style={{ maxWidth: width }}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl text-text-muted cursor-pointer leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  let badgeClass = '';
  if (status === 'running') {
    badgeClass = 'status-running-gcp';
  } else if (status === 'creating' || status === 'starting') {
    badgeClass = 'status-pending-gcp';
  } else {
    badgeClass = 'status-error-gcp';
  }
  return (
    <span className={`badge-gcp ${badgeClass}`}>
      {status}
    </span>
  );
}

function PasswordCell({ password, visible, onToggle }: {
  password: string; visible: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <code className="text-sm" style={{ color: '#202124' }}>{visible ? password : '••••••••'}</code>
      <button onClick={onToggle} className="btn-gcp-text px-2 py-0.5 text-xs">
        {visible ? '숨기기' : '보기'}
      </button>
      {visible && (
        <button onClick={() => navigator.clipboard.writeText(password)} className="btn-gcp-text px-2 py-0.5 text-xs">
          복사
        </button>
      )}
    </div>
  );
}

function QuotaItem({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const percent = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0;
  const isWarning = percent > 90;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm" style={{ color: '#5f6368' }}>{label}</span>
        <span className="text-sm font-medium" style={{ color: '#202124' }}>{used} / {total} {unit}</span>
      </div>
      <div className="progress-gcp">
        <div
          className="progress-gcp-fill"
          style={{
            width: `${percent}%`,
            background: isWarning ? '#d93025' : '#1a73e8'
          }}
        />
      </div>
    </div>
  );
}
