import type { Quota } from '@/types/dashboard';
import { QuotaItem } from './QuotaItem';

interface QuotaSectionProps {
  quotas: Quota;
}

export function QuotaSection({ quotas }: QuotaSectionProps) {
  const { quota, usage } = quotas;
  return (
    <section className="w-full px-8 pb-8">
      <div className="bg-surface-card rounded-lg border border-hairline p-6 mb-6">
        <h2 className="title-lg text-ink mb-6">내 쿼터 사용량</h2>
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
