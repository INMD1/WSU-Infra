'use client';

// ──────────────────────────────────────────────────────────
// 대시보드 메인 페이지
//
// 이 파일은 레이아웃(HTML 구조)만 담당합니다.
// 모든 상태·API 호출은 useDashboard 훅에 있습니다.
// 각 모달·섹션은 _components/ 폴더의 파일을 확인하세요.
// ──────────────────────────────────────────────────────────

import { useRouter } from 'next/navigation';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { useDashboard } from './_hooks/useDashboard';
import { QuotaSection } from './_components/QuotaSection';
import { VmTable } from './_components/VmTable';
import { CreateVmModal } from './_components/CreateVmModal';
import { PortForwardModal } from './_components/PortForwardModal';
import { SpecChangeModal } from './_components/SpecChangeModal';
import { JobProgressModal } from './_components/JobProgressModal';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const router = useRouter();
  const dash = useDashboard();
  const [userdata, setuserdata] = useState<any>({});

  // ──────────────────────────────────────────────────────────
  // Userdata 상태 관리 (Sidebar로 가져오기 위한 변수)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    setuserdata(dash);
  }, [dash.username]);

  if (dash.loading && !dash.quotas) return <div className="container text-muted">로딩 중...</div>;

  return (
    <div className="min-h-screen w-full bg-canvas">
      <SidebarProvider>
        <AppSidebar userdata={userdata} />
        <main className="w-full object-center">
          <SidebarTrigger className="ml-4 mt-4" />
          {/* ── 헤더 ── */}
          <div className='px-2 sm:px-24'>
            <div className="flex mb-12 flex-col md:flex-row md:justify-between md:items-start gap-6 px-10 ">
              <div>
                <h1 className="display-md text-ink mb-1">클라우드 대시보드</h1>
                <p className="caption-uppercase text-muted">학번: {dash.username}</p>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                {dash.createResult && (
                  <button className="btn-secondary" onClick={() => dash.setShowJobsModal(true)}>대기열 보기</button>
                )}
                {dash.role === 'admin' && (
                  <button className="btn-secondary" onClick={() => router.push('/admin')}>관리자 패널</button>
                )}
                <button className="btn-primary" onClick={() => dash.setShowCreateModal(true)}>새 VM 생성</button>
              </div>
            </div>

            {/* ── 쿼터 사용량 ── */}
            {dash.quotas && <QuotaSection quotas={dash.quotas} />}

            {/* ── VM 목록 ── */}
            <VmTable vms={dash.vms} />

            {/* ── 모달: VM 생성 ── */}
            {dash.showCreateModal && (
              <CreateVmModal
                username={dash.username}
                images={dash.images}
                includeAllImages={dash.includeAllImages}
                form={dash.newVm}
                error={dash.createError}
                isCreating={dash.isCreating}
                onFormChange={dash.setNewVm}
                onToggleAllImages={dash.setIncludeAllImages}
                onSubmit={dash.handleCreateVm}
                onClose={dash.closeCreateModal}
              />
            )}

            {/* ── 모달: Job 진행 상황 ── */}
            {dash.showJobsModal && dash.createResult && (
              <JobProgressModal
                jobId={dash.createResult.jobId}
                estimatedWait={dash.createResult.estimatedWait}
                jobStatus={dash.jobStatus}
                onClose={() => dash.setShowJobsModal(false)}
              />
            )}

            {/* ── 모달: 포트포워딩 ── */}
            {dash.pfVm && (
              <PortForwardModal
                vm={dash.pfVm}
                form={dash.newPf}
                error={dash.pfError}
                isSubmitting={dash.pfSubmitting}
                deletingPfId={dash.deletingPfId}
                onFormChange={dash.setNewPf}
                onSubmit={dash.handleCreatePf}
                onDeletePf={dash.handleDeletePf}
                onClose={() => dash.setPfVm(null)}
              />
            )}

            {/* ── 모달: 사양 변경 ── */}
            {dash.specVm && (
              <SpecChangeModal
                vm={dash.specVm}
                form={dash.specForm}
                error={dash.specError}
                isSubmitting={dash.specSubmitting}
                onFormChange={dash.setSpecForm}
                onSubmit={dash.handleSpecSubmit}
                onClose={() => dash.setSpecVm(null)}
              />
            )}

          </div>
        </main>
      </SidebarProvider>
    </div>
  );
}
