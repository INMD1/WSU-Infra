import { NextResponse } from 'next/server';
import { quotaService } from '@/services/quotaService';

/**
 * 3.1 내 쿼터 및 사용량 조회
 * GET /api/quotas?userId=<owner_id>
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
  }

  const data = await quotaService.getQuota(userId);
  return NextResponse.json(data);
}

/**
 * 3.2 쿼터 수정 (관리자 전용)
 * PATCH /api/quotas?userId=<owner_id>
 */
export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
    }

    const body = await request.json();
    await quotaService.updateQuota(userId, body);

    return NextResponse.json({
      owner_id: userId,
      message: 'Quota updated successfully',
    });
  } catch (error) {
    return NextResponse.json({ message: 'Error updating quota' }, { status: 500 });
  }
}
