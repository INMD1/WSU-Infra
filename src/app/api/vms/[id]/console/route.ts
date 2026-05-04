import { NextResponse } from 'next/server';
import { vmService } from '@/services/vmService';
import { esxiClient } from '@/lib/infrastructure';
import { requireAuth } from '@/lib/apiAuth';

/**
 * GET /api/vms/[id]/console
 * vSphere HTML5 웹콘솔 URL 발급. 단명 sessionTicket 포함.
 * 본인 소유 VM만 접근 가능 (admin은 전체).
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

  try {
    const url = await esxiClient.getConsoleUrl(vm.name);
    return NextResponse.json({ url, vm_name: vm.name });
  } catch (error: any) {
    console.error('[Console API] Failed to get console URL:', error);
    return NextResponse.json(
      { message: 'Failed to generate console URL', error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
