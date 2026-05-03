import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * DELETE /api/admin/students/[id]
 * 학번 삭제 (관리자 전용)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.select().from(users).where(eq(users.id, id));
  if (existing.length === 0 || existing[0].role !== 'user') {
    return NextResponse.json({ message: '해당 학번을 찾을 수 없습니다.' }, { status: 404 });
  }

  await db.delete(users).where(eq(users.id, id));
  return NextResponse.json({ success: true });
}
