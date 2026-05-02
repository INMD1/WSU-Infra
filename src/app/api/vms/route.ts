import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';

/**
 * 2.1 VM 목록 조회
 * GET /api/vms
 */
export async function GET() {
  const data = await vmService.getAllVms();
  return NextResponse.json({
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
    },
  });
}

/**
 * 2.2 VM 생성 (대기열 사용)
 * POST /api/vms
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 우선순위 확인 (옵션)
    const priority = body.priority || 0;

    // Job 추가 및 예상 대기 시간 계산
    const { jobId, estimatedWait } = await vmService.createVm(body, priority);

    return NextResponse.json({
      success: true,
      jobId,
      message: 'VM provisioning queued',
      estimatedWaitSeconds: estimatedWait,
      status: 'queued',
    }, { status: 202 }); // 202 Accepted
  } catch (error) {
    console.error('[VM API] Error creating VM:', error);
    return NextResponse.json({
      success: false,
      message: 'Error queuing VM creation',
    }, { status: 500 });
  }
}
