'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const [quotas, setQuotas] = useState<any>(null);
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVm, setNewVm] = useState({ name: '', vcpu: 2, ram_gb: 4, disk_gb: 40, image_id: 'ubuntu-22.04' });
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
    try {
      const res = await fetch('/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newVm),
      });
      if (res.ok) {
        setShowCreateModal(false);
        fetchData();
      }
    } catch (err) {
      console.error('Error creating VM:', err);
    }
  };

  if (loading && !quotas) return <div className="container">로딩 중...</div>;

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>클라우드 대시보드</h1>
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>새 VM 생성</button>
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
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>생성하기</button>
                <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, background: 'var(--border)' }}>취소</button>
              </div>
            </form>
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
