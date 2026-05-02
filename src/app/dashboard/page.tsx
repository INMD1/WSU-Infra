'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const [quotas, setQuotas] = useState<any>(null);
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [newVm, setNewVm] = useState({ name: '', vcpu: 2, ram_gb: 4, disk_gb: 40, image_id: 'ubuntu-22.04' });
  const [createResult, setCreateResult] = useState<{ jobId: string; estimatedWait: number } | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [quotaRes, vmsRes] = await Promise.all([
        fetch('/api/quotas'),
        fetch('/api/vms')
      ]);
      const quotaData = await quotaRes.json();
      const vmsData = await vmsRes.json();
      setQuotas(quotaData);
      setVms(vmsData.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateVm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    setCreateResult(null);
    setJobStatus(null);

    try {
      const res = await fetch('/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } catch (err) {
      console.error('Error creating VM:', err);
      setCreateError('네트워크 오류가 발생했습니다.');
    } finally {
      setIsCreating(false);
    }
  };

  const startJobPolling = (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        if (data.status === 'completed' || data.status === 'failed') {
          setJobStatus(data);
          fetchData(); // VM 목록 새로고침
          setTimeout(() => {
            setCreateResult(null);
            setJobStatus(null);
            setShowJobsModal(false);
          }, 2000);
          return;
        }

        setJobStatus(data);
        setTimeout(poll, 2000);
      } catch (err) {
        console.error('Error polling job:', err);
      }
    };

    poll();
    setShowJobsModal(true);
  };

  if (loading && !quotas) return <div className="container">로딩 중...</div>;

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>클라우드 대시보드</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {createResult && (
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              대기열에 등록됨 (Job ID: {createResult.jobId})
            </span>
          )}
          <button
            className="btn-secondary"
            onClick={() => setShowJobsModal(true)}
            style={{ display: createResult ? 'inline-block' : 'none' }}
          >
            대기열 보기
          </button>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>새 VM 생성</button>
        </div>
      </header>

      {quotas && (
        <section className="card">
          <h2 style={{ marginBottom: '1rem' }}>내 쿼터 사용량</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
            <QuotaItem label="VM 개수" used={quotas.usage.vm_count} total={quotas.quota.max_vm_count} unit="개" />
            <QuotaItem label="vCPU" used={quotas.usage.vcpu_total} total={quotas.quota.max_vcpu_total} unit="Core" />
            <QuotaItem label="RAM" used={quotas.usage.ram_gb_total} total={quotas.quota.max_ram_gb_total} unit="GB" />
            <QuotaItem label="Disk" used={quotas.usage.disk_gb_total} total={quotas.quota.max_disk_gb_total} unit="GB" />
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
              <th>생성일</th>
            </tr>
          </thead>
          <tbody>
            {vms.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>생성된 VM이 없습니다.</td>
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
                      color: vm.status === 'running' ? '#166534' : '#991b1b'
                    }}>
                      {vm.status}
                    </span>
                  </td>
                  <td>{vm.vcpu} Core / {vm.ram_gb} GB / {vm.disk_gb} GB</td>
                  <td>{vm.internal_ip || '-'}</td>
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
            <h2 style={{ marginBottom: '1.5rem' }}>새 가상 머신 생성</h2>
            {createError && (
              <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateVm}>
              <label>VM 이름</label>
              <input type="text" value={newVm.name} onChange={e => setNewVm({...newVm, name: e.target.value})} required />
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label>vCPU (Cores)</label>
                  <input type="number" value={newVm.vcpu} onChange={e => setNewVm({...newVm, vcpu: parseInt(e.target.value)})} required />
                </div>
                <div>
                  <label>RAM (GB)</label>
                  <input type="number" value={newVm.ram_gb} onChange={e => setNewVm({...newVm, ram_gb: parseInt(e.target.value)})} required />
                </div>
              </div>
              
              <label>Disk (GB)</label>
              <input type="number" value={newVm.disk_gb} onChange={e => setNewVm({...newVm, disk_gb: parseInt(e.target.value)})} required />
              
              <label>Image ID</label>
              <input type="text" value={newVm.image_id} onChange={e => setNewVm({...newVm, image_id: e.target.value})} required />

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isCreating}>
                  {isCreating ? '생성 중...' : '생성하기'}
                </button>
                <button type="button" onClick={() => { setShowCreateModal(false); setCreateError(null); }} style={{ flex: 1, background: 'var(--border)' }}>취소</button>
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
                    fontWeight: 500
                  }}>
                    {jobStatus.status}
                  </div>
                </div>

                {jobStatus.status === 'running' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div className="progress-bar" style={{ marginBottom: 0 }}>
                      <div className="progress-fill" style={{ width: '100%', background: 'var(--primary)', animation: 'pulse 1.5s infinite' }}></div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
                      VM 생성 중...
                    </div>
                  </div>
                )}

                {jobStatus.error && (
                  <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    <strong>오류:</strong> {jobStatus.error}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  예상 대기 시간: {Math.round(createResult.estimatedWait)} 초
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  대기열에서 차례를 기다리고 있습니다...
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.5rem' }}>
              <button
                onClick={() => { setShowJobsModal(false); setCreateResult(null); setJobStatus(null); }}
                className="btn-primary"
                style={{ width: '100%' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuotaItem({ label, used, total, unit }: any) {
  const percent = Math.min(Math.round((used / total) * 100), 100);
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
