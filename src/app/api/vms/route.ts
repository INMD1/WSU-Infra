import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';

/**
 * 2.1 VM 목록 조회
 * GET /api/vms
 */
export async function GET() {
  const data = await vmService.getAllVms();
  return NextResponse.json({
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
    },
  });
}

/**
 * 2.2 VM 생성
 * POST /api/vms
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newVm = await vmService.createVm(body);

    return NextResponse.json({
      vm_id: newVm.vm_id,
      name: newVm.name,
      status: newVm.status,
      message: 'VM provisioning started.',
      estimated_ready_seconds: 180,
    });
  } catch (error) {
    return NextResponse.json({ message: 'Error creating VM' }, { status: 500 });
  }
}
