import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';
import { esxiClient } from '@/lib/infrastructure';
import { requireAuth } from '@/lib/apiAuth';

/**
 * 2.3 VM 상세 조회
 * GET /api/vms/[id]
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const vm = await vmService.getVmById(id);
  if (!vm) return NextResponse.json({ message: 'VM not found' }, { status: 404 });
  if (auth.role !== 'admin' && vm.owner_id !== auth.userId) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(vm);
}

/**
 * VM 전원 제어 & 스펙 변경
 * PATCH /api/vms/[id]
 * Body: { action: 'start' | 'stop' | 'restart' } | { vcpu?, ram_gb? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();
  const { action, vcpu, ram_gb } = body;

  const vm = await vmService.getVmById(id);
  if (!vm) return NextResponse.json({ message: 'VM not found' }, { status: 404 });
  if (auth.role !== 'admin' && vm.owner_id !== auth.userId) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  if (action) {
    try {
      if (action === 'start') {
        await esxiClient.powerOn(vm.name);
        await vmService.updateVmStatus(id, 'running');
      } else if (action === 'stop') {
        await esxiClient.powerOff(vm.name, true);
        await vmService.updateVmStatus(id, 'stopped');
      } else if (action === 'restart') {
        await esxiClient.resetVm(vm.name);
        await vmService.updateVmStatus(id, 'running');
      } else {
        return NextResponse.json({ message: `Unknown action: ${action}` }, { status: 400 });
      }
      return NextResponse.json({
        vm_id: vm.vm_id,
        action,
        status: action === 'stop' ? 'stopped' : 'running',
        message: `VM ${action} succeeded`,
      });
    } catch (error: any) {
      console.error(`[VM API] ${action} failed for ${vm.name}:`, error);
      return NextResponse.json(
        { message: `VM ${action} failed`, error: error?.message ?? String(error) },
        { status: 500 }
      );
    }
  }

  if (vcpu || ram_gb) {
    // 사양 변경 — vCenter 는 일반적으로 VM 이 power-off 상태일 때만 안전하게 허용
    if (vm.status === 'running' || vm.status === 'starting') {
      return NextResponse.json(
        { message: 'VM 이 실행 중입니다. 사양 변경 전에 정지하세요.' },
        { status: 409 }
      );
    }

    const newVcpu = Number(vcpu) || vm.vcpu;
    const newRamGb = Number(ram_gb) || vm.ram_gb;

    if (!Number.isInteger(newVcpu) || newVcpu < 1 || newVcpu > 64) {
      return NextResponse.json({ message: 'vcpu 는 1~64 정수' }, { status: 400 });
    }
    if (!Number.isInteger(newRamGb) || newRamGb < 1 || newRamGb > 256) {
      return NextResponse.json({ message: 'ram_gb 는 1~256 정수' }, { status: 400 });
    }

    try {
      await esxiClient.changeVmSpec(vm.name, { vcpu: newVcpu, ram_gb: newRamGb });
      await vmService.updateVmSpec(id, { vcpu: newVcpu, ram_gb: newRamGb });
      return NextResponse.json({
        vm_id: vm.vm_id,
        vcpu: newVcpu,
        ram_gb: newRamGb,
        status: vm.status,
        message: '사양이 변경되었습니다. 시작 시 적용됩니다.',
      });
    } catch (error: any) {
      console.error(`[VM API] spec change failed for ${vm.name}:`, error);
      return NextResponse.json(
        { message: '사양 변경 실패', error: error?.message ?? String(error) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ message: 'Invalid request: provide action or vcpu/ram_gb' }, { status: 400 });
}

/**
 * 2.5 VM 삭제
 * DELETE /api/vms/[id]
 *
 * ESXi VM 과 그 디스크, 연관 포트포워딩까지 함께 정리.
 * ESXi 호출 실패 시 500 — DB row 는 유지하여 재시도 가능.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const vm = await vmService.getVmById(id);
  if (!vm) return NextResponse.json({ message: 'VM not found' }, { status: 404 });
  if (auth.role !== 'admin' && vm.owner_id !== auth.userId) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  try {
    const success = await vmService.deleteVm(id);
    if (!success) return NextResponse.json({ message: 'VM not found' }, { status: 404 });

    return NextResponse.json({
      vm_id: id,
      status: 'deleted',
      message: 'VM, disks, and related port-forwards removed.',
    });
  } catch (error: any) {
    console.error('[VM API] DELETE error:', error);
    return NextResponse.json(
      { message: 'Failed to delete VM', error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
