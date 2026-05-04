'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

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
      const [quotaRes, vmsRes] = await Promise.all([
        authFetch('/api/quotas'),
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
      .catch(() => {});
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
      .catch(() => {});
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
    if (!confirm(`정말 "${vmName}"을(를) 삭제하시겠습니까? 디스크와 포트포워딩까지 모두 제거됩니다.`)) return;
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
    <div className="container">
      {/* ── Header ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1>클라우드 대시보드</h1>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>학번: {username}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {createResult && (
            <button className="btn-secondary" onClick={() => setShowJobsModal(true)}>대기열 보기</button>
          )}
          {role === 'admin' && (
            <button className="btn-secondary" onClick={() => router.push('/admin')}>관리자 패널</button>
          )}
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>새 VM 생성</button>
          <button onClick={handleLogout} style={logoutBtnStyle}>로그아웃</button>
        </div>
      </header>

      {/* ── Quota ── */}
      {quotas && (
        <section className="card">
          <h2 style={{ marginBottom: '1rem' }}>내 쿼터 사용량</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
            <QuotaItem label="VM 개수" used={quotas.usage?.vm_count ?? 0} total={quotas.quota?.max_vm_count ?? 5} unit="개" />
            <QuotaItem label="vCPU" used={quotas.usage?.vcpu_total ?? 0} total={quotas.quota?.max_vcpu_total ?? 20} unit="Core" />
            <QuotaItem label="RAM" used={quotas.usage?.ram_gb_total ?? 0} total={quotas.quota?.max_ram_gb_total ?? 64} unit="GB" />
            <QuotaItem label="포트" used={quotas.usage?.ports_used ?? 0} total={quotas.quota?.max_public_ports ?? 10} unit="개" />
          </div>
        </section>
      )}

      {/* ── VM 목록 ── */}
      <section className="card">
        <h2 style={{ marginBottom: '1rem' }}>가상 머신 목록</h2>
        <table>
          <thead>
            <tr>
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
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>생성된 VM이 없습니다.</td></tr>
            ) : vms.map(vm => (
              <tr key={vm.vm_id}>
                <td style={{ fontWeight: 500 }}>{vm.name}</td>
                <td><StatusBadge status={vm.status} /></td>
                <td style={{ fontSize: '0.85rem' }}>{vm.vcpu}C / {vm.ram_gb}GB / {vm.disk_gb}GB</td>
                <td>
                  {vm.vm_password ? (
                    <PasswordCell vmId={vm.vm_id} password={vm.vm_password}
                      visible={!!visiblePasswords[vm.vm_id]}
                      onToggle={() => setVisiblePasswords(p => ({ ...p, [vm.vm_id]: !p[vm.vm_id] }))}
                    />
                  ) : '—'}
                </td>
                <td>
                  <button
                    onClick={() => { setPfVm(vm); setPfError(null); }}
                    style={pfBtnStyle}
                    disabled={!vm.internal_ip}
                    title={!vm.internal_ip ? 'VM IP가 할당된 후 사용 가능합니다' : ''}
                  >
                    {vm.port_forwards?.length > 0 ? `${vm.port_forwards.length}개 보기` : '추가'}
                  </button>
                </td>
                <td>
                  <button
                    onClick={() => handleOpenConsole(vm.vm_id)}
                    style={pfBtnStyle}
                    disabled={vm.status !== 'running'}
                    title={vm.status !== 'running' ? 'VM이 실행 중일 때만 콘솔에 연결할 수 있습니다' : '새 탭에서 vSphere HTML5 콘솔 열기'}
                  >
                    콘솔 열기
                  </button>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handleVmAction(vm.vm_id, 'start')}
                      style={pfBtnStyle}
                      disabled={actingVmId === vm.vm_id || vm.status === 'running' || vm.status === 'starting'}
                      title="VM 시작"
                    >
                      ▶
                    </button>
                    <button
                      onClick={() => handleVmAction(vm.vm_id, 'stop')}
                      style={pfBtnStyle}
                      disabled={actingVmId === vm.vm_id || vm.status !== 'running'}
                      title="VM 정지 (강제 종료)"
                    >
                      ■
                    </button>
                    <button
                      onClick={() => handleVmAction(vm.vm_id, 'restart')}
                      style={pfBtnStyle}
                      disabled={actingVmId === vm.vm_id || vm.status !== 'running'}
                      title="VM 재시작 (하드 리셋)"
                    >
                      ↻
                    </button>
                    <button
                      onClick={() => openSpecModal(vm)}
                      style={pfBtnStyle}
                      disabled={actingVmId === vm.vm_id || vm.status === 'running' || vm.status === 'starting'}
                      title={vm.status === 'running' || vm.status === 'starting' ? 'VM 정지 후 사양 변경 가능' : 'CPU/RAM 사양 변경'}
                    >
                      사양
                    </button>
                    <button
                      onClick={() => handleDeleteVm(vm.vm_id, vm.name)}
                      style={deleteBtnStyle}
                      disabled={actingVmId === vm.vm_id}
                      title="VM 삭제 (디스크 포함)"
                    >
                      ✕
                    </button>
                  </div>
                </td>
                <td style={{ fontSize: '0.85rem' }}>{new Date(vm.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── 포트포워딩 모달 ── */}
      {pfVm && (
        <Modal onClose={() => setPfVm(null)} title={`포트포워딩 — ${pfVm.name}`} width={640}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            내부 IP: <code style={{ background: 'var(--bg-secondary)', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{pfVm.internal_ip}</code>
          </p>

          {/* 현재 규칙 목록 */}
          {pfVm.port_forwards?.length > 0 ? (
            <table style={{ marginBottom: '1.5rem' }}>
              <thead>
                <tr>
                  <th>프로토콜</th>
                  <th>내부 포트</th>
                  <th>외부 접속</th>
                  <th>설명</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pfVm.port_forwards.map(pf => (
                  <tr key={pf.id}>
                    <td><span style={protocolBadgeStyle}>{pf.protocol.toUpperCase()}</span></td>
                    <td style={{ fontFamily: 'monospace' }}>{pf.internal_port}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {pf.external_ip}:{pf.external_port}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{pf.description || '—'}</td>
                    <td>
                      <button
                        onClick={() => handleDeletePf(pf.id)}
                        disabled={deletingPfId === pf.id}
                        style={deleteBtnStyle}
                      >
                        {deletingPfId === pf.id ? '...' : '삭제'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              등록된 포트포워딩 규칙이 없습니다.
            </p>
          )}

          {/* 새 규칙 추가 폼 */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>새 규칙 추가</h3>
            <form onSubmit={handleCreatePf}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>프로토콜</label>
                  <select value={newPf.protocol} onChange={e => setNewPf(p => ({ ...p, protocol: e.target.value }))}
                    style={selectStyle}>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>내부 포트</label>
                  <input type="number" min={1} max={65535} value={newPf.internal_port}
                    onChange={e => setNewPf(p => ({ ...p, internal_port: Number(e.target.value) }))}
                    style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>외부 포트 <span style={{ color: 'var(--text-muted)' }}>(자동)</span></label>
                  <input type="number" min={10000} max={20000} value={newPf.external_port}
                    onChange={e => setNewPf(p => ({ ...p, external_port: e.target.value }))}
                    placeholder="자동 배정"
                    style={inputStyle} />
                </div>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>설명 (선택)</label>
                <input type="text" value={newPf.description}
                  onChange={e => setNewPf(p => ({ ...p, description: e.target.value }))}
                  placeholder="예: SSH, Web, DB"
                  style={inputStyle} />
              </div>
              {pfError && (
                <div style={errorBoxStyle}>{pfError}</div>
              )}
              <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={pfSubmitting}>
                {pfSubmitting ? '생성 중...' : '포트포워딩 추가'}
              </button>
            </form>
          </div>
        </Modal>
      )}

      {/* ── 사양 변경 모달 ── */}
      {specVm && (
        <Modal onClose={() => setSpecVm(null)} title={`사양 변경 — ${specVm.name}`} width={420}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            현재: {specVm.vcpu} vCPU / {specVm.ram_gb} GB RAM
          </p>
          {specError && <div style={errorBoxStyle}>{specError}</div>}
          <form onSubmit={handleSpecSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>vCPU</label>
                <input type="number" min={1} max={64} value={specForm.vcpu}
                  onChange={e => setSpecForm(p => ({ ...p, vcpu: Number(e.target.value) }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>RAM (GB)</label>
                <input type="number" min={1} max={256} value={specForm.ram_gb}
                  onChange={e => setSpecForm(p => ({ ...p, ram_gb: Number(e.target.value) }))}
                  style={inputStyle} required />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={specSubmitting}>
                {specSubmitting ? '변경 중...' : '저장'}
              </button>
              <button type="button" onClick={() => setSpecVm(null)}
                style={{ flex: 1, background: 'var(--border)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
                취소
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── VM 생성 모달 ── */}
      {showCreateModal && (
        <Modal onClose={() => { setShowCreateModal(false); setCreateError(null); }} title="새 가상 머신 생성">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            SSH 비밀번호는 자동 생성되어 생성 후 목록에서 확인할 수 있습니다.
          </p>
          {createError && <div style={errorBoxStyle}>{createError}</div>}
          <form onSubmit={handleCreateVm}>
            <label style={labelStyle}>VM 이름</label>
            <input style={inputStyle} type="text" value={newVm.name}
              onChange={e => setNewVm(p => ({ ...p, name: e.target.value }))}
              placeholder={username ? `자동으로 user-${username}- 접두사가 붙습니다` : '영문/숫자/-/_ 만 허용'}
              pattern="[a-zA-Z0-9_-]+"
              title="영문, 숫자, 하이픈(-), 언더스코어(_)만 사용 가능"
              required />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>vCPU</label>
                <input style={inputStyle} type="number" min={1} value={newVm.vcpu}
                  onChange={e => setNewVm(p => ({ ...p, vcpu: Number(e.target.value) }))} required />
              </div>
              <div>
                <label style={labelStyle}>RAM (GB)</label>
                <input style={inputStyle} type="number" min={1} value={newVm.ram_gb}
                  onChange={e => setNewVm(p => ({ ...p, ram_gb: Number(e.target.value) }))} required />
              </div>
            </div>

            <label style={labelStyle}>Disk (GB)</label>
            <input style={inputStyle} type="number" min={10} value={newVm.disk_gb}
              onChange={e => setNewVm(p => ({ ...p, disk_gb: Number(e.target.value) }))} required />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={labelStyle}>이미지 (Content Library)</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeAllImages}
                  onChange={e => setIncludeAllImages(e.target.checked)} />
                ISO 등 모든 항목 표시
              </label>
            </div>
            {images.length > 0 ? (
              <select value={newVm.image_id}
                onChange={e => setNewVm(p => ({ ...p, image_id: e.target.value }))}
                style={{ ...selectStyle, marginBottom: '0.5rem' }} required>
                {images.map(img => (
                  <option key={img.library_path} value={img.library_path}>
                    [{img.type.toUpperCase()}] {img.name}{img.size_gb > 0 ? ` (${img.size_gb} GB)` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ ...errorBoxStyle, background: '#fef3c7', color: '#92400e' }}>
                {includeAllImages
                  ? 'Content Library에 이미지가 없습니다. 관리자에게 문의하세요.'
                  : 'OVA/OVF 항목이 없습니다. ISO도 표시하려면 위 체크박스를 켜세요.'}
              </div>
            )}
            {newVm.image_id && (() => {
              const sel = images.find(i => i.library_path === newVm.image_id);
              if (sel && sel.type !== 'ova' && sel.type !== 'ovf') {
                return (
                  <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fef3c7', padding: '0.4rem 0.6rem', borderRadius: '0.25rem', marginBottom: '1.25rem' }}>
                    ⚠ {sel.type.toUpperCase()} 항목은 자동 배포가 지원되지 않습니다 — VM 생성 시 실패할 수 있습니다.
                  </div>
                );
              }
              return <div style={{ marginBottom: '0.75rem' }} />;
            })()}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isCreating}>
                {isCreating ? '요청 중...' : '생성하기'}
              </button>
              <button type="button" onClick={() => { setShowCreateModal(false); setCreateError(null); }}
                style={{ flex: 1, background: 'var(--border)', border: 'none', borderRadius: '0.375rem', cursor: 'pointer' }}>
                취소
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Job 진행 모달 ── */}
      {showJobsModal && createResult && (
        <Modal onClose={() => setShowJobsModal(false)} title="VM 생성 진행 상황">
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Job ID</div>
            <code style={{ display: 'block', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem', fontSize: '0.85rem' }}>
              {createResult.jobId}
            </code>
          </div>
          {jobStatus ? (
            <>
              <div style={{
                padding: '0.6rem 1rem', borderRadius: '0.5rem', fontWeight: 500, marginBottom: '1rem',
                background: jobStatus.status === 'completed' ? '#dcfce7' : jobStatus.status === 'failed' ? '#fee2e2' : '#fef3c7',
                color: jobStatus.status === 'completed' ? '#166534' : jobStatus.status === 'failed' ? '#991b1b' : '#92400e',
              }}>
                {jobStatus.status === 'completed' ? '완료 — VM 목록을 확인하세요' : jobStatus.status === 'failed' ? '실패' : '처리 중...'}
              </div>
              {jobStatus.status === 'running' && (
                <div className="progress-bar" style={{ marginBottom: '1rem' }}>
                  <div className="progress-fill" style={{ width: '100%', background: 'var(--primary)', animation: 'pulse 1.5s infinite' }} />
                </div>
              )}
              {jobStatus.error && <div style={errorBoxStyle}><strong>오류:</strong> {jobStatus.error}</div>}
            </>
          ) : (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              예상 대기: {Math.round(createResult.estimatedWait)}초
            </p>
          )}
          <button className="btn-primary" style={{ width: '100%', marginTop: '1rem' }}
            onClick={() => setShowJobsModal(false)}>닫기</button>
        </Modal>
      )}
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'running' ? { bg: '#dcfce7', text: '#166534' }
    : status === 'creating' || status === 'starting' ? { bg: '#fef3c7', text: '#92400e' }
    : { bg: '#fee2e2', text: '#991b1b' };
  return (
    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '0.25rem', fontSize: '0.82rem', background: color.bg, color: color.text, fontWeight: 500 }}>
      {status}
    </span>
  );
}

function PasswordCell({ vmId, password, visible, onToggle }: {
  vmId: string; password: string; visible: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <code style={{ fontSize: '0.88rem' }}>{visible ? password : '••••••••'}</code>
      <button onClick={onToggle} style={smallBtnStyle}>{visible ? '숨기기' : '보기'}</button>
      {visible && (
        <button onClick={() => navigator.clipboard.writeText(password)} style={smallBtnStyle}>복사</button>
      )}
    </div>
  );
}

function QuotaItem({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const percent = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{used} / {total} {unit}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${percent}%`, background: percent > 90 ? 'var(--error)' : 'var(--primary)' }} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Shared styles
// ────────────────────────────────────────────────
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--text-muted)' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', marginBottom: '1rem' };
const selectStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border)', background: 'var(--bg-secondary)' };
const errorBoxStyle: React.CSSProperties = { padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' };
const smallBtnStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', borderRadius: '0.25rem', padding: '0.15rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' };
const deleteBtnStyle: React.CSSProperties = { background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.82rem' };
const pfBtnStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' };
const protocolBadgeStyle: React.CSSProperties = { background: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.78rem', fontWeight: 600 };
const logoutBtnStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', padding: '0.45rem 1rem', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' };
