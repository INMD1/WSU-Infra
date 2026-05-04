import { NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { db } from '@/db';
import { users, quotas } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/auth/login
 *
 * 학생: { student_id }           → DB에서 학번 확인 후 JWT 발급
 * 관리자: { student_id, password } → 환경변수(ADMIN_USERNAME/ADMIN_PASSWORD) 대조
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { student_id, password } = body;

    if (!student_id || typeof student_id !== 'string' || student_id.trim() === '') {
      return NextResponse.json({ message: '학번을 입력해주세요.' }, { status: 400 });
    }

    const sid = student_id.trim();

    // 관리자 로그인 (password 필드가 있을 때)
    if (password !== undefined) {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminPassword) {
        return NextResponse.json(
          { message: '서버에 ADMIN_PASSWORD가 설정되지 않았습니다.' },
          { status: 500 }
        );
      }

      if (sid === adminUsername && password === adminPassword) {
        const token = signToken({ userId: 'admin', username: sid, role: 'admin' }, '8h');
        return NextResponse.json({ access_token: token, role: 'admin', username: sid });
      }

      return NextResponse.json({ message: '관리자 정보가 올바르지 않습니다.' }, { status: 401 });
    }

    // 학생 로그인 (학번만)
    const result = await db.select().from(users).where(eq(users.username, sid));
    if (result.length === 0 || result[0].role !== 'user') {
      return NextResponse.json({ message: '등록되지 않은 학번입니다.' }, { status: 401 });
    }

    const user = result[0];

    // 유저 쿼터가 없으면 자동으로 생성 (DB default 값 사용)
    const existingQuota = await db.select().from(quotas).where(eq(quotas.owner_id, user.id));
    if (existingQuota.length === 0) {
      await db.insert(quotas).values({ owner_id: user.id });
    }

    const token = signToken({ userId: user.id, username: sid, role: 'user' }, '8h');
    return NextResponse.json({ access_token: token, role: 'user', username: sid, owner_id: user.id });

  } catch (error) {
    console.error('[Auth] Login error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
