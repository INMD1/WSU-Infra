import { NextResponse } from 'next/server';
import { quotaService } from '@/services/quotaService';

/**
 * 3.1 내 쿼터 및 사용량 조회
 * GET /api/quotas
 */
export async function GET() {
  const data = await quotaService.getQuota('tenant-uuid-1234');
  return NextResponse.json(data);
}

/**
 * 3.2 쿼터 수정 (관리자 전용)
 * PATCH /api/quotas
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    await quotaService.updateQuota('tenant-uuid-1234', body);

    return NextResponse.json({
      tenant_id: 'tenant-uuid-1234',
      message: 'Quota updated successfully',
    });
  } catch (error) {
    return NextResponse.json({ message: 'Error updating quota' }, { status: 500 });
  }
}
