import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';
import { requireAuth } from '@/lib/apiAuth';

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.role === 'admin' ? undefined : auth.userId;
  const data = await vmService.getAllVms(ownerId);
  return NextResponse.json({
    data,
    pagination: { page: 1, limit: 20, total: data.length },
  });
}

/**
 * POST /api/vms
 * Body: { name, image_id, vcpu, ram_gb, disk_gb, ssh_public_key?, priority? }
 * 비밀번호는 서버에서 자동 생성됨 (클라이언트에서 받지 않음)
 */
export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, image_id, vcpu, ram_gb, disk_gb, ssh_public_key, priority } = body;

    if (!name || !image_id || !vcpu || !ram_gb || !disk_gb) {
      return NextResponse.json(
        { success: false, message: 'name, image_id, vcpu, ram_gb, disk_gb are required' },
        { status: 400 }
      );
    }

    const jobData = {
      name,
      image_id,
      vcpu,
      ram_gb,
      disk_gb,
      ssh_public_key,
      owner_id: auth.role === 'admin' ? undefined : auth.userId,
    };

    const { jobId, estimatedWait } = await vmService.createVm(jobData, priority || 0);

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
