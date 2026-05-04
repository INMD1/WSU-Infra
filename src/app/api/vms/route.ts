import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { vmService } from '@/services/vmService';
import { requireAuth } from '@/lib/apiAuth';
import { db } from '@/db';
import { vms } from '@/db/schema';

const VM_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_VCENTER_NAME = 80;

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
 *
 * VM 이름 충돌 방지를 위해 서버가 `user-{username}-` 접두사를 강제로 붙임.
 * 클라이언트는 short name (예: "myvm")만 입력.
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

    const trimmedName = String(name).trim();
    if (!VM_NAME_RE.test(trimmedName)) {
      return NextResponse.json(
        { success: false, message: 'name은 영문/숫자/하이픈(-)/언더스코어(_)만 사용할 수 있습니다.' },
        { status: 400 }
      );
    }

    const fullName = `user-${auth.username}-${trimmedName}`;
    if (fullName.length > MAX_VCENTER_NAME) {
      return NextResponse.json(
        { success: false, message: `VM 이름이 너무 깁니다 (최대 ${MAX_VCENTER_NAME}자). 더 짧은 이름을 사용하세요.` },
        { status: 400 }
      );
    }

    const existing = await db.select().from(vms).where(eq(vms.name, fullName));
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: `이미 같은 이름의 VM이 존재합니다: ${fullName}` },
        { status: 409 }
      );
    }

    const jobData = {
      name: fullName,
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
      vm_name: fullName,
      message: 'VM provisioning queued',
      estimatedWaitSeconds: estimatedWait,
      status: 'queued',
    }, { status: 202 });
  } catch (error) {
    console.error('[VM API] Error creating VM:', error);
    return NextResponse.json({ success: false, message: 'Error queuing VM creation' }, { status: 500 });
  }
}
