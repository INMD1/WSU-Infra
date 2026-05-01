import { NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';

/**
 * 1.1 로그인 - JWT 토큰 발급
 * POST /api/auth/login
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // 실제 환경에서는 DB에서 사용자 확인을 해야 합니다.
    // 여기서는 간단한 예시로 처리합니다.
    if (username === 'admin' && password === 'password123') {
      const accessToken = signToken({ username, role: 'admin' }, '1h');
      const refreshToken = signToken({ username }, '7d');

      return NextResponse.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    return NextResponse.json(
      { message: 'Invalid credentials' },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
