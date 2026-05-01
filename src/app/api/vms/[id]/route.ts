import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';

/**
 * 2.3 VM 상세 조회
 * GET /api/vms/[id]
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vm = await vmService.getVmById(id);
  if (!vm) return NextResponse.json({ message: 'VM not found' }, { status: 404 });
  return NextResponse.json(vm);
}

/**
 * 2.4 VM 전원 제어 & 2.6 비밀번호 재설정 & 2.7 스펙 변경
 * PATCH /api/vms/[id]
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { action, vcpu, ram_gb } = body;

  const vm = await vmService.getVmById(id);
  if (!vm) return NextResponse.json({ message: 'VM not found' }, { status: 404 });

  if (action) {
    // start, stop, restart 처리
    await vmService.updateVmStatus(id, action === 'start' ? 'running' : 'stopped');
    return NextResponse.json({
      vm_id: vm.vm_id,
      action,
      status: action === 'start' ? 'running' : 'stopped',
      message: `VM ${action}ed successfully`,
    });
  }

  if (vcpu || ram_gb) {
    // 스펙 변경
    return NextResponse.json({
      vm_id: vm.vm_id,
      vcpu: vcpu || vm.vcpu,
      ram_gb: ram_gb || vm.ram_gb,
      status: 'stopped',
      message: 'Spec updated. Start VM to apply.',
    });
  }

  return NextResponse.json({ message: 'Invalid action' }, { status: 400 });
}

/**
 * 2.5 VM 삭제
 * DELETE /api/vms/[id]
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const success = await vmService.deleteVm(id);
  if (!success) return NextResponse.json({ message: 'VM not found' }, { status: 404 });

  return NextResponse.json({
    vm_id: id,
    status: 'deleting',
    message: 'VM deletion started. SSH port will be released.',
  });
}
