// 쿼터 사용량 섹션 전체를 렌더링합니다.
// VM 수, vCPU, RAM, 디스크, 포트 5가지 항목을 그리드로 표시합니다.

import type { Quota } from '../types';
import { QuotaItem } from './QuotaItem';

interface QuotaSectionProps {
  quotas: Quota;
}

export function QuotaSection({ quotas }: QuotaSectionProps) {
  const { quota, usage } = quotas;
  return (
    <section className="w-full px-8 pb-8">
      <div className="card-gcp p-6">
        <h2 className="text-2xl font-medium mb-6" style={{ color: '#202124' }}>내 쿼터 사용량</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          <QuotaItem label="VM 개수"  used={usage?.vm_count ?? 0}      total={quota?.max_vm_count ?? 5}       unit="개"  />
          <QuotaItem label="vCPU"     used={usage?.vcpu_total ?? 0}     total={quota?.max_vcpu_total ?? 3}     unit="Core"/>
          <QuotaItem label="RAM"      used={usage?.ram_gb_total ?? 0}   total={quota?.max_ram_gb_total ?? 8}   unit="GB"  />
          <QuotaItem label="디스크"   used={usage?.disk_gb_total ?? 0}  total={quota?.max_disk_gb_total ?? 100} unit="GB" />
          <QuotaItem label="포트"     used={usage?.ports_used ?? 0}     total={quota?.max_public_ports ?? 10}  unit="개"  />
        </div>
      </div>
    </section>
  );
}
