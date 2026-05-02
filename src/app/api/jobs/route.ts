import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';

/**
 * 대기열 상태 조회
 * GET /api/jobs
 */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const detail = searchParams.get('detail');

  if (detail === 'true') {
    // 상세 정보 포함
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

  // 기본 상태만 반환
  const status = vmService.getQueueStatus();
  return NextResponse.json({
    pending: status.pending,
    running: status.running,
    completed: status.completed,
    failed: status.failed,
    total: status.total,
  });
}
