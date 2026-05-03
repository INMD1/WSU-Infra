import { NextResponse } from 'next/server';
import { verifyToken } from './auth';

export interface AuthContext {
  userId: string;
  username: string;
  role: string;
}

/**
 * Authorization 헤더에서 JWT를 검증하고 페이로드를 반환.
 * 인증 실패 시 NextResponse(401)를 반환 — 호출자는 instanceof 체크로 분기.
 */
export function requireAuth(request: Request): AuthContext | NextResponse {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload || typeof payload !== 'object' || !('username' in payload)) {
    return NextResponse.json({ message: 'Invalid or expired token' }, { status: 401 });
  }

  return payload as AuthContext;
}
