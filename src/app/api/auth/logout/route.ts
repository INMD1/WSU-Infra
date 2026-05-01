import { NextResponse } from 'next/server';

/**
 * 1.3 로그아웃
 * POST /api/auth/logout
 */
export async function POST() {
  // 실제 환경에서는 Redis 등에서 토큰을 블랙리스트 처리할 수 있습니다.
  return NextResponse.json({ message: 'Logged out successfully' });
}
