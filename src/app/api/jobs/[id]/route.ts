import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';

/**
 * 개별 Job 상태 조회
 * GET /api/jobs/[id]
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobStatus = await vmService.getJobStatus(id);

  if (!jobStatus) {
    return NextResponse.json({
      success: false,
      message: 'Job not found',
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...jobStatus,
  });
}
