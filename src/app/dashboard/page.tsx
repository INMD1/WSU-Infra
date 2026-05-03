'use client';

import { useEffect, useState } from 'react';
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

export default function DashboardPage() {
  const [quotas, setQuotas] = useState<any>(null);
  const [vms, setVms] = useState<any[]>([]);
  const [images, setImages] = useState<{ name: string; path: string; size_gb: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [newVm, setNewVm] = useState({ name: '', vcpu: 2, ram_gb: 4, disk_gb: 40, image_id: '' });
  const [createResult, setCreateResult] = useState<{ jobId: string; estimatedWait: number } | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    setUsername(localStorage.getItem('username') || '');
    setRole(localStorage.getItem('role') || '');
    fetchData();
    fetchImages();
  }, [router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [quotaRes, vmsRes] = await Promise.all([
        authFetch('/api/quotas'),
        authFetch('/api/vms'),
      ]);
      if (quotaRes.status === 401) { router.push('/login'); return; }
      setQuotas(await quotaRes.json());
      setVms((await vmsRes.json()).data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchImages = async () => {
    try {
      const res = await authFetch('/api/images?source=datastore');
      if (!res.ok) return;
      const data = await res.json();
      const list = data.data || [];
      setImages(list);
      if (list.length > 0) {
        setNewVm(prev => ({ ...prev, image_id: list[0].name }));
      }
    } catch {
      // 이미지 목록 실패 시 수동 입력으로 대체
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    router.push('/login');
  };

  const handleCreateVm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    setCreateResult(null);
    setJobStatus(null);

    try {
      const res = await authFetch('/api/vms', {
        method: 'POST',
        body: JSON.stringify(newVm),
      });

      const data = await res.json();

      if (res.ok) {
        setCreateResult({ jobId: data.jobId, estimatedWait: data.estimatedWaitSeconds });
        setShowCreateModal(false);
        startJobPolling(data.jobId);
      } else {
        setCreateError(data.message || 'VM 생성에 실패했습니다.');
      }
    } catch {
      setCreateError('네트워크 오류가 발생했습니다.');
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

        if (data.status === 'completed' || data.status === 'failed') {
          fetchData();
          setTimeout(() => { setCreateResult(null); setJobStatus(null); setShowJobsModal(false); }, 3000);
          return;
        }
        setTimeout(poll, 2000);
      } catch {
        console.error('Error polling job');
      }
    };
    poll();
  };

  const togglePassword = (vmId: string) => {
    setVisiblePasswords(prev => ({ ...prev, [vmId]: !prev[vmId] }));
  };

  if (loading && !quotas) return <div className="container">로딩 중...</div>;

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1>클라우드 대시보드</h1>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>학번: {username}</span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {createResult && (
            <button className="btn-secondary" onClick={() => setShowJobsModal(true)}>
              대기열 보기
            </button>
          )}
          {role === 'admin' && (
            <button className="btn-secondary" onClick={() => router.push('/admin')}>
              관리자 패널
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>새 VM 생성</button>
          <button
            onClick={handleLogout}
            style={{ background: 'none', border: '1px solid var(--border)', padding: '0.5rem 1rem', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}
          >
            로그아웃
          </button>
        </div>
      </header>

      {quotas && (
        <section className="card">
          <h2 style={{ marginBottom: '1rem' }}>내 쿼터 사용량</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
            <QuotaItem label="VM 개수" used={quotas.usage?.vm_count ?? 0} total={quotas.quota?.max_vm_count ?? 5} unit="개" />
            <QuotaItem label="vCPU" used={quotas.usage?.vcpu_total ?? 0} total={quotas.quota?.max_vcpu_total ?? 20} unit="Core" />
            <QuotaItem label="RAM" used={quotas.usage?.ram_gb_total ?? 0} total={quotas.quota?.max_ram_gb_total ?? 64} unit="GB" />
            <QuotaItem label="Disk" used={quotas.usage?.disk_gb_total ?? 0} total={quotas.quota?.max_disk_gb_total ?? 1000} unit="GB" />
          </div>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginBottom: '1rem' }}>가상 머신 목록</h2>
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>상태</th>
              <th>사양 (vCPU/RAM/Disk)</th>
              <th>IP 주소</th>
              <th>SSH 비밀번호</th>
              <th>생성일</th>
            </tr>
          </thead>
          <tbody>
            {vms.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>생성된 VM이 없습니다.</td>
              </tr>
            ) : (
              vms.map((vm: any) => (
                <tr key={vm.vm_id}>
                  <td style={{ fontWeight: 500 }}>{vm.name}</td>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.85rem',
                      background: vm.status === 'running' ? '#dcfce7' : '#fee2e2',
                      color: vm.status === 'running' ? '#166534' : '#991b1b',
                    }}>
                      {vm.status}
                    </span>
                  </td>
                  <td>{vm.vcpu} Core / {vm.ram_gb} GB / {vm.disk_gb} GB</td>
                  <td style={{ fontFamily: 'monospace' }}>{vm.internal_ip || '-'}</td>
                  <td>
                    {vm.vm_password ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                          {visiblePasswords[vm.vm_id] ? vm.vm_password : '••••••••'}
                        </span>
                        <button
                          onClick={() => togglePassword(vm.vm_id)}
                          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          {visiblePasswords[vm.vm_id] ? '숨기기' : '보기'}
                        </button>
                        {visiblePasswords[vm.vm_id] && (
                          <button
                            onClick={() => navigator.clipboard.writeText(vm.vm_password)}
                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}
                          >
                            복사
                          </button>
                        )}
                      </div>
                    ) : '-'}
                  </td>
                  <td>{new Date(vm.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '500px', marginBottom: 0 }}>
            <h2 style={{ marginBottom: '0.5rem' }}>새 가상 머신 생성</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              SSH 비밀번호는 자동 생성되어 생성 후 목록에서 확인할 수 있습니다.
            </p>
            {createError && (
              <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateVm}>
              <label>VM 이름</label>
              <input type="text" value={newVm.name} onChange={e => setNewVm({ ...newVm, name: e.target.value })} required />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label>vCPU (Cores)</label>
                  <input type="number" min={1} value={newVm.vcpu} onChange={e => setNewVm({ ...newVm, vcpu: parseInt(e.target.value) })} required />
                </div>
                <div>
                  <label>RAM (GB)</label>
                  <input type="number" min={1} value={newVm.ram_gb} onChange={e => setNewVm({ ...newVm, ram_gb: parseInt(e.target.value) })} required />
                </div>
              </div>

              <label>Disk (GB)</label>
              <input type="number" min={10} value={newVm.disk_gb} onChange={e => setNewVm({ ...newVm, disk_gb: parseInt(e.target.value) })} required />

              <label>이미지 (OVA)</label>
              {images.length > 0 ? (
                <select
                  value={newVm.image_id}
                  onChange={e => setNewVm({ ...newVm, image_id: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border)', background: 'var(--bg-secondary)', marginBottom: '1rem' }}
                >
                  {images.map(img => (
                    <option key={img.name} value={img.name}>
                      {img.name} {img.size_gb > 0 ? `(${img.size_gb} GB)` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={newVm.image_id}
                  onChange={e => setNewVm({ ...newVm, image_id: e.target.value })}
                  placeholder="OVA 파일명 또는 템플릿 VM 이름"
                  required
                />
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isCreating}>
                  {isCreating ? '요청 중...' : '생성하기'}
                </button>
                <button type="button" onClick={() => { setShowCreateModal(false); setCreateError(null); }} style={{ flex: 1, background: 'var(--border)' }}>
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showJobsModal && createResult && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '500px', marginBottom: 0 }}>
            <h2 style={{ marginBottom: '1.5rem' }}>VM 생성 진행 상황</h2>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Job ID</div>
              <div style={{ fontFamily: 'monospace', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem' }}>
                {createResult.jobId}
              </div>
            </div>

            {jobStatus ? (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>상태</div>
                  <div style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    background: jobStatus.status === 'completed' ? '#dcfce7' : jobStatus.status === 'failed' ? '#fee2e2' : '#fef3c7',
                    color: jobStatus.status === 'completed' ? '#166534' : jobStatus.status === 'failed' ? '#991b1b' : '#92400e',
                    fontWeight: 500,
                  }}>
                    {jobStatus.status === 'completed' ? '완료됨 — 목록을 확인하세요' : jobStatus.status === 'failed' ? '실패' : '진행 중...'}
                  </div>
                </div>

                {jobStatus.status === 'running' && (
                  <div className="progress-bar" style={{ marginBottom: '1rem' }}>
                    <div className="progress-fill" style={{ width: '100%', background: 'var(--primary)', animation: 'pulse 1.5s infinite' }}></div>
                  </div>
                )}

                {jobStatus.error && (
                  <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    <strong>오류:</strong> {jobStatus.error}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                예상 대기 시간: {Math.round(createResult.estimatedWait)}초
              </div>
            )}

            <button onClick={() => { setShowJobsModal(false); }} className="btn-primary" style={{ width: '100%' }}>
              닫기
            </button>
          </div>
        </div>
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
        <div className="progress-fill" style={{ width: `${percent}%`, background: percent > 90 ? 'var(--error)' : 'var(--primary)' }}></div>
      </div>
    </div>
  );
}
