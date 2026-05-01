import { NextResponse } from 'next/server';
import { signToken, verifyToken } from '@/lib/auth';

/**
 * 1.2 토큰 갱신
 * POST /api/auth/refresh
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { refresh_token } = body;

  const decoded = verifyToken(refresh_token);
  if (!decoded) {
    return NextResponse.json({ message: 'Invalid refresh token' }, { status: 401 });
  }

  const accessToken = signToken({ username: (decoded as any).username }, '1h');
  return NextResponse.json({
    access_token: accessToken,
    expires_in: 3600,
  });
}
