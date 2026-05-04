import { NextResponse } from 'next/server';
import { portForwardService } from '@/services/portForwardService';
import { requireAuth } from '@/lib/apiAuth';

/**
 * DELETE /api/port-forwards/[id]
 * 포트 포워딩 규칙 삭제 — pfSense에서도 제거
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const deleted = await portForwardService.delete(id);

    if (!deleted) {
      return NextResponse.json({ success: false, message: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Port forward rule deleted' });
  } catch (error: any) {
    console.error('[Port Forward API] DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete port forward rule' }, { status: 500 });
  }
}
