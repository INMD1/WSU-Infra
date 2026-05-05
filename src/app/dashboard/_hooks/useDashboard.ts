'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  authFetch,
  getQuotas,
  getImages,
  getJobStatus,
  getActiveJobs,
  createVM,
  controlVM,
  deleteVM,
  updateVMSpec,
  createPortForward,
  deletePortForward,
} from '../api/apiClient';
import type { Vm, Quota, Image, NewVmForm, NewPortForwardForm, JobStatus } from '../types';

// 대시보드 페이지에서 사용하는 모든 상태와 액션을 담은 훅
// page.tsx 는 이 훅을 사용해서 렌더링만 담당합니다.
export function useDashboard() {
  const router = useRouter();

  // ── 기본 데이터 ──────────────────────────────
  const [quotas, setQuotas] = useState<Quota | null>(null);
  const [vms, setVms] = useState<Vm[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [includeAllImages, setIncludeAllImages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');

  // ── VM 생성 모달 ─────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVm, setNewVm] = useState<NewVmForm>({ name: '', vcpu: 2, ram_gb: 4, disk_gb: 40, image_id: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // ── Job 진행 모달 ────────────────────────────
  const [showJobsModal, setShowJobsModal] = useState(false);
  const [createResult, setCreateResult] = useState<{ jobId: string; estimatedWait: number } | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  // ── VM 전원 제어 ─────────────────────────────
  const [actingVmId, setActingVmId] = useState<string | null>(null);

  // ── 비밀번호 표시 ────────────────────────────
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // ── 포트포워딩 모달 ──────────────────────────
  const [pfVm, setPfVm] = useState<Vm | null>(null);
  const [newPf, setNewPf] = useState<NewPortForwardForm>({ internal_port: 22, external_port: '', protocol: 'tcp', description: '' });
  const [pfError, setPfError] = useState<string | null>(null);
  const [pfSubmitting, setPfSubmitting] = useState(false);
  const [deletingPfId, setDeletingPfId] = useState<string | null>(null);

  // ── VM 사양 변경 모달 ────────────────────────
  const [specVm, setSpecVm] = useState<Vm | null>(null);
  const [specForm, setSpecForm] = useState({ vcpu: 2, ram_gb: 4 });
  const [specError, setSpecError] = useState<string | null>(null);
  const [specSubmitting, setSpecSubmitting] = useState(false);

  // ── 데이터 불러오기 ───────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ownerId = localStorage.getItem('owner_id');
      const [quotaRes, vmsRes] = await Promise.all([
        getQuotas(ownerId || undefined),
        authFetch('/api/vms'),
      ]);
      if (quotaRes.status === 401) { router.push('/login'); return; }
      setQuotas(await quotaRes.json());
      const vmsJson = await vmsRes.json();
      const list: Vm[] = vmsJson.data || [];
      setVms(list);
      // 포트포워딩 모달이 열려 있으면 해당 VM 데이터도 함께 갱신
      setPfVm(prev => prev ? (list.find(v => v.vm_id === prev.vm_id) ?? null) : null);
    } catch {
      console.error('fetchData failed');
    } finally {
      setLoading(false);
    }
  }, [router]);

  // ── 초기 로딩 + 진행 중인 Job 복구 ──────────
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    setUsername(localStorage.getItem('username') || '');
    setRole(localStorage.getItem('role') || '');
    fetchData();

    // 페이지 새로고침 시 진행 중이던 Job 이 있으면 폴링 재개
    getActiveJobs()
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

  // ── 이미지 목록 (includeAllImages 변경 시 재조회) ──
  useEffect(() => {
    getImages(includeAllImages)
      .then((list: Image[]) => {
        setImages(list);
        // 선택된 이미지가 새 목록에 없으면 첫 번째 항목으로 재설정
        setNewVm(p => {
          const stillValid = list.some(img => img.library_path === p.image_id);
          return stillValid ? p : { ...p, image_id: list[0]?.library_path ?? '' };
        });
      })
      .catch(() => {});
  }, [includeAllImages]);

  // ── Job 폴링 시작 ─────────────────────────────
  const startJobPolling = (jobId: string) => {
    setShowJobsModal(true);
    const poll = async () => {
      try {
        const res = await getJobStatus(jobId);
        const data = await res.json();
        setJobStatus(data);
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

  // ── VM 생성 ───────────────────────────────────
  const handleCreateVm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createVM(newVm);
      const data = await res.json();
      if (res.ok) {
        setCreateResult({ jobId: data.jobId, estimatedWait: data.estimatedWaitSeconds });
        closeCreateModal();
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

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateError(null);
  };

  // ── VM 전원 제어 (시작 / 정지 / 재시작) ──────
  const handleVmAction = async (vmId: string, action: 'start' | 'stop' | 'restart') => {
    const labels = { start: '시작', stop: '정지', restart: '재시작' } as const;
    setActingVmId(vmId);
    try {
      const res = await controlVM(vmId, action);
      const data = await res.json();
      if (!res.ok) alert(`${labels[action]} 실패: ${data.message || data.error || ''}`);
      fetchData();
    } catch {
      alert('네트워크 오류');
    } finally {
      setActingVmId(null);
    }
  };

  // ── VM 삭제 ───────────────────────────────────
  const handleDeleteVm = async (vmId: string, vmName: string) => {
    if (!confirm(`정말 "${vmName}"을(를) 삭제하시겠습니까? 디스크와 포트포워딩까지 모두 제거됩니다.`)) return;
    setActingVmId(vmId);
    try {
      const res = await deleteVM(vmId);
      const data = await res.json();
      if (!res.ok) alert(`삭제 실패: ${data.message || data.error || ''}`);
      fetchData();
    } catch {
      alert('네트워크 오류');
    } finally {
      setActingVmId(null);
    }
  };

  // ── 웹 콘솔 열기 ─────────────────────────────
  const handleOpenConsole = (vmId: string) => {
    window.open(`/console/${vmId}`, '_blank', 'noopener,noreferrer');
  };

  // ── VM 사양 변경 ──────────────────────────────
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
      const res = await updateVMSpec(specVm.vm_id, specForm.vcpu, specForm.ram_gb);
      const data = await res.json();
      if (!res.ok) { setSpecError(data.message || data.error || '변경 실패'); return; }
      setSpecVm(null);
      fetchData();
    } catch {
      setSpecError('네트워크 오류');
    } finally {
      setSpecSubmitting(false);
    }
  };

  // ── 포트포워딩 생성 ───────────────────────────
  const handleCreatePf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pfVm?.internal_ip) return;
    setPfSubmitting(true);
    setPfError(null);
    try {
      const body: Parameters<typeof createPortForward>[0] = {
        vm_id: pfVm.vm_id,
        internal_ip: pfVm.internal_ip,
        internal_port: Number(newPf.internal_port),
        protocol: newPf.protocol,
        description: newPf.description || undefined,
        ...(newPf.external_port !== '' ? { external_port: Number(newPf.external_port) } : {}),
      };
      const res = await createPortForward(body);
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

  // ── 포트포워딩 삭제 ───────────────────────────
  const handleDeletePf = async (pfId: string) => {
    if (!confirm('이 포트포워딩 규칙을 삭제하시겠습니까?')) return;
    setDeletingPfId(pfId);
    try {
      const res = await deletePortForward(pfId);
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

  const handleLogout = () => {
    localStorage.clear();
    router.push('/login');
  };

  return {
    // 기본 데이터
    quotas, vms, images, loading, username, role,
    includeAllImages, setIncludeAllImages,
    // VM 생성 모달
    showCreateModal, setShowCreateModal,
    newVm, setNewVm,
    createError, isCreating,
    handleCreateVm, closeCreateModal,
    // Job 진행 모달
    showJobsModal, setShowJobsModal,
    createResult, jobStatus,
    // 전원 제어
    actingVmId,
    handleVmAction, handleDeleteVm, handleOpenConsole,
    // 비밀번호 표시
    visiblePasswords, setVisiblePasswords,
    // 포트포워딩 모달
    pfVm, setPfVm,
    newPf, setNewPf,
    pfError, pfSubmitting,
    deletingPfId,
    handleCreatePf, handleDeletePf,
    // 사양 변경 모달
    specVm, setSpecVm,
    specForm, setSpecForm,
    specError, specSubmitting,
    openSpecModal, handleSpecSubmit,
    // 기타
    handleLogout,
  };
}
