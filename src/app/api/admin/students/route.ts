import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

function adminOnly(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return { error: auth };
  if (auth.role !== 'admin') {
    return { error: NextResponse.json({ message: 'Forbidden' }, { status: 403 }) };
  }
  return { auth };
}

/**
 * GET /api/admin/students
 * 등록된 학생 목록 조회 (관리자 전용)
 */
export async function GET(request: Request) {
  const { error } = adminOnly(request);
  if (error) return error;

  const result = await db
    .select({ id: users.id, username: users.username, created_at: users.created_at })
    .from(users)
    .where(eq(users.role, 'user'));

  return NextResponse.json({ data: result });
}

/**
 * POST /api/admin/students
 * Body: { student_id: '20240001' }
 * 학번 등록 (관리자 전용)
 */
export async function POST(request: Request) {
  const { error } = adminOnly(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { student_id } = body;

    if (!student_id || typeof student_id !== 'string' || student_id.trim() === '') {
      return NextResponse.json({ message: '학번을 입력해주세요.' }, { status: 400 });
    }

    const sid = student_id.trim();

    const existing = await db.select().from(users).where(eq(users.username, sid));
    if (existing.length > 0) {
      return NextResponse.json({ message: '이미 등록된 학번입니다.' }, { status: 409 });
    }

    const id = uuidv4();
    await db.insert(users).values({
      id,
      username: sid,
      password: '',
      role: 'user',
    });

    return NextResponse.json({ success: true, id, student_id: sid }, { status: 201 });
  } catch (error) {
    console.error('[Admin] Add student error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
