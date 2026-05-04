import { NextResponse } from 'next/server';
import { portForwardService, ValidationError } from '@/services/portForwardService';
import { requireAuth } from '@/lib/apiAuth';

/**
 * GET /api/port-forwards
 * 포트 포워딩 목록 조회 — internal IP/port, external IP/port 포함
 * ownerId 쿼리 파라미터로 필터링 가능 (없으면 전체 조회 - 관리자)
 */
export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get('ownerId') || undefined;

  try {
    const rules = await portForwardService.list(ownerId);
    return NextResponse.json({
      data: rules.map(r => ({
        id: r.id,
        vm_id: r.vm_id,
        owner_id: r.owner_id,
        protocol: r.protocol,
        internal_ip: r.internal_ip,
        internal_port: r.internal_port,
        external_ip: r.external_ip,
        external_port: r.external_port,
        description: r.description,
        created_at: r.created_at,
      })),
      total: rules.length,
    });
  } catch (error: any) {
    console.error('[Port Forward API] GET error:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch port forward rules' }, { status: 500 });
  }
}

/**
 * POST /api/port-forwards
 * Body: { internal_ip, internal_port, external_port?, protocol?, vm_id?, owner_id?, description? }
 */
export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { internal_ip, internal_port, external_port, protocol, vm_id, owner_id, description } = body;

    if (!internal_ip || internal_port === undefined) {
      return NextResponse.json(
        { success: false, message: 'internal_ip and internal_port are required' },
        { status: 400 }
      );
    }

    const rule = await portForwardService.create({
      ownerId: typeof owner_id === 'string' ? owner_id : undefined,
      vmId: typeof vm_id === 'string' ? vm_id : undefined,
      internalIp: String(internal_ip),
      internalPort: Number(internal_port),
      externalPort: external_port !== undefined ? Number(external_port) : undefined,
      protocol: typeof protocol === 'string' ? protocol : undefined,
      description: typeof description === 'string' ? description : undefined,
    });

    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      const status = error.message.includes('quota') ? 403 : 400;
      return NextResponse.json({ success: false, message: error.message }, { status });
    }
    console.error('[Port Forward API] POST error:', error);
    return NextResponse.json({ success: false, message: 'Failed to create port forward rule' }, { status: 500 });
  }
}
