import { db } from '../db';
import { quotas, vms } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export const quotaService = {
  async getQuota(tenantId: string) {
    // 1. 쿼터 정보 조회 (없으면 기본값 생성)
    let quotaResult = await db.select().from(quotas).where(eq(quotas.tenant_id, tenantId));
    
    if (quotaResult.length === 0) {
      await db.insert(quotas).values({ tenant_id: tenantId });
      quotaResult = await db.select().from(quotas).where(eq(quotas.tenant_id, tenantId));
    }

    const quota = quotaResult[0];

    // 2. 실시간 사용량 집계
    const usageResult = await db.select({
      vm_count: sql<number>`count(*)`,
      vcpu_total: sql<number>`sum(${vms.vcpu})`,
      ram_gb_total: sql<number>`sum(${vms.ram_gb})`,
      disk_gb_total: sql<number>`sum(${vms.disk_gb})`,
    }).from(vms);

    const usage = {
      vm_count: Number(usageResult[0]?.vm_count || 0),
      vcpu_total: Number(usageResult[0]?.vcpu_total || 0),
      ram_gb_total: Number(usageResult[0]?.ram_gb_total || 0),
      disk_gb_total: Number(usageResult[0]?.disk_gb_total || 0),
      ports_used: 0, // 추후 구현
    };

    return {
      tenant_id: tenantId,
      quota,
      usage,
      remaining: {
        vm_count: quota.max_vm_count - usage.vm_count,
        vcpu_total: quota.max_vcpu_total - usage.vcpu_total,
        ram_gb_total: quota.max_ram_gb_total - usage.ram_gb_total,
        disk_gb_total: quota.max_disk_gb_total - usage.disk_gb_total,
      },
    };
  },

  async updateQuota(tenantId: string, newQuota: any) {
    await db.update(quotas).set(newQuota).where(eq(quotas.tenant_id, tenantId));
    return true;
  },
};
