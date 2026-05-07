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
 * Body: { vm_id, internal_port, external_port?, protocol?, description? }
 * vm_id 가 있으면 자동으로 VM 의 internal_ip 를 조회
 */
export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { vm_id, internal_port, external_port, protocol, description } = body;

    if (!vm_id || internal_port === undefined) {
      return NextResponse.json(
        { success: false, message: 'vm_id and internal_port are required' },
        { status: 400 }
      );
    }

    // VM 의 internal_ip 조회
    const { db } = await import('@/db');
    const { vms } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const vm = await db.select({ internal_ip: vms.internal_ip }).from(vms).where(eq(vms.vm_id, vm_id)).get();

    if (!vm?.internal_ip) {
      return NextResponse.json(
        { success: false, message: 'VM not found or no internal_ip assigned' },
        { status: 404 }
      );
    }

    const rule = await portForwardService.create({
      vmId: vm_id,
      internalIp: vm.internal_ip,
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
