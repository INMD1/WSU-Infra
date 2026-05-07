'use client';

import type { Vm } from '@/types/dashboard';
import { OSIcon } from '@/components/OSIcon';
import { StatusBadge } from './StatusBadge';
import { useRouter } from 'next/navigation';

interface VmTableProps {
  vms: Vm[];
  onOpenDetail?: (vmId: string) => void;
}

export function VmTable({
  vms, onOpenDetail,
}: VmTableProps) {
  const router = useRouter();

  const handleRowClick = (vmId: string) => {
    if (onOpenDetail) {
      onOpenDetail(vmId);
    } else {
      router.push(`/dashboard/vm/${vmId}`);
    }
  };

  return (
    <section className="w-full px-8 pb-8">
      <div className="bg-surface-card rounded-lg border border-hairline overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-hairline">
          <h2 className="title-lg text-ink">가상 머신 목록</h2>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr className="bg-canvas">
                <th className="w-12"></th>
                <th>이름</th>
                <th>상태</th>
                <th>생성일</th>
              </tr>
            </thead>
            <tbody>
              {vms.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-muted">
                    생성된 VM 이 없습니다.
                  </td>
                </tr>
              ) : vms.map(vm => (
                <tr
                  key={vm.vm_id}
                  onClick={() => handleRowClick(vm.vm_id)}
                  className="cursor-pointer hover:bg-surface-soft transition-colors"
                >
                  <td><OSIcon imageName={vm.name} size="sm" /></td>
                  <td className="font-medium text-ink">{vm.name}</td>
                  <td><StatusBadge status={vm.status} /></td>
                  <td className="text-muted">{new Date(vm.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
