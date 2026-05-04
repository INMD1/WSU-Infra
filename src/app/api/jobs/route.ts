import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';
import { requireAuth } from '@/lib/apiAuth';

/**
 * 대기열 상태 조회
 * GET /api/jobs
 *
 * ?detail=true   → 큐 상태 + 대기 job 목록
 * ?active=true   → 현재 사용자의 진행 중(pending+running) vm-create job 목록
 *                  (페이지 새로고침 시 폴링 재개용)
 */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;

  if (searchParams.get('active') === 'true') {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const ownerId = auth.role === 'admin' ? undefined : auth.userId;
    return NextResponse.json({
      activeJobs: vmService.getActiveVmCreateJobs(ownerId),
    });
  }

  if (searchParams.get('detail') === 'true') {
    const status = vmService.getQueueStatus();
    const pendingJobs = vmService.getPendingJobs();
    return NextResponse.json({
      status: {
        pending: status.pending,
        running: status.running,
        completed: status.completed,
        failed: status.failed,
        total: status.total,
      },
      pendingJobs,
    });
  }

  const status = vmService.getQueueStatus();
  return NextResponse.json({
    pending: status.pending,
    running: status.running,
    completed: status.completed,
    failed: status.failed,
    total: status.total,
  });
}
