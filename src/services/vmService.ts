import { db } from '../db';
import { vms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { esxiClient } from '../lib/infrastructure';

export const vmService = {
  async getAllVms() {
    return await db.select().from(vms);
  },

  async getVmById(id: string) {
    const result = await db.select().from(vms).where(eq(vms.vm_id, id));
    return result[0] || null;
  },

  async createVm(data: any) {
    // 1. 실제 ESXi 에 VM 생성 명령 (govc 호출)
    const provisioned = await esxiClient.createVmFromTemplate({
      name: data.name,
      template: data.image_id, // image_id 를 템플릿 이름으로 사용
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key, // Cloud-init 을 위한 SSH 공개키
    });

    const newVm = {
      vm_id: provisioned.vm_id,
      name: data.name,
      status: provisioned.status as any,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key, // Cloud-init 을 위한 SSH 공개키
      disk_gb: data.disk_gb,
      image_id: data.image_id,
      ssh_host: '',
      ssh_port: 0,
      internal_ip: '',
      esxi_moref: provisioned.moref,
    };

    // 2. DB 에 기록
    await db.insert(vms).values(newVm);
    return newVm;
  },

  async deleteVm(id: string) {
    await db.delete(vms).where(eq(vms.vm_id, id));
    return true;
  },

  async updateVmStatus(id: string, status: string) {
    await db.update(vms).set({ status, updated_at: new Date() }).where(eq(vms.vm_id, id));
    return true;
  },
};
