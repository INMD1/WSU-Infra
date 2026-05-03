import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';
import { requireAuth } from '@/lib/apiAuth';

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const data = await vmService.getAllVms();
  return NextResponse.json({
    data,
    pagination: { page: 1, limit: 20, total: data.length },
  });
}

/**
 * POST /api/vms
 * Body: { name, image_id, vcpu, ram_gb, disk_gb, ssh_public_key?, password?, priority? }
 */
export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, image_id, vcpu, ram_gb, disk_gb, ssh_public_key, password, priority } = body;

    // 필수 필드 검증
    if (!name || !image_id || !vcpu || !ram_gb || !disk_gb) {
      return NextResponse.json(
        { success: false, message: 'name, image_id, vcpu, ram_gb, disk_gb are required' },
        { status: 400 }
      );
    }

    // 비밀번호 검증 (제공된 경우)
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return NextResponse.json(
          { success: false, message: 'password must be 8–72 characters' },
          { status: 400 }
        );
      }
    }

    const { jobId, estimatedWait } = await vmService.createVm(body, priority || 0);

    return NextResponse.json({
      success: true,
      jobId,
      message: 'VM provisioning queued',
      estimatedWaitSeconds: estimatedWait,
      status: 'queued',
    }, { status: 202 });
  } catch (error) {
    console.error('[VM API] Error creating VM:', error);
    return NextResponse.json({ success: false, message: 'Error queuing VM creation' }, { status: 500 });
  }
}
