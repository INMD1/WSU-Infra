import crypto from 'crypto';
import { db } from '../db';
import { vms, portForwards } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { esxiClient, pfsenseClient } from '../lib/infrastructure';
import { jobQueue, JobData } from '../lib/queue';
import { portForwardService } from './portForwardService';

const DEFAULT_TENANT_ID = 'tenant-uuid-1234';

function generateVmPassword(): string {
  // 12자 URL-safe base64 (쉘 특수문자 없음)
  return crypto.randomBytes(9).toString('base64url');
}

/**
 * VM 생성 Job 처리
 */
async function processVmCreateJob(jobData: any): Promise<any> {
  const { data } = jobData;
  const vmPassword = data.password || generateVmPassword();

  try {
    let earlyInserted = false;
    const provisioned = await esxiClient.createVmFromTemplate({
      name: data.name,
      template: data.image_id,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key,
      password: vmPassword,
      // Power-on 직후 호출 — IP 받기 전에 row 를 만들어 대시보드에 즉시 노출
      onPowerOn: async (info) => {
        await db.insert(vms).values({
          vm_id: info.vm_id,
          name: data.name,
          status: 'starting',
          vcpu: data.vcpu,
          ram_gb: data.ram_gb,
          disk_gb: data.disk_gb,
          image_id: data.image_id,
          ssh_host: '',
          ssh_port: 22,
          internal_ip: '',
          esxi_moref: info.moref,
          ssh_public_key: data.ssh_public_key,
          vm_password: vmPassword,
          owner_id: data.owner_id || null,
        });
        earlyInserted = true;
        console.log(`[VM Service] VM ${info.vm_id} 등록(starting) — IP 대기 중`);
      },
    });

    console.log(`[VM Service] VM provisioned: ${provisioned.vm_id} → ${provisioned.ip_address}`);

    if (earlyInserted) {
      await db.update(vms).set({
        status: provisioned.status as any,
        ssh_host: provisioned.ip_address || '',
        internal_ip: provisioned.ip_address || '',
      }).where(eq(vms.vm_id, provisioned.vm_id));
    } else {
      // 콜백 실패한 경우의 폴백 insert
      await db.insert(vms).values({
        vm_id: provisioned.vm_id,
        name: data.name,
        status: provisioned.status as any,
        vcpu: data.vcpu,
        ram_gb: data.ram_gb,
        disk_gb: data.disk_gb,
        image_id: data.image_id,
        ssh_host: provisioned.ip_address || '',
        ssh_port: 22,
        internal_ip: provisioned.ip_address || '',
        esxi_moref: provisioned.moref,
        ssh_public_key: data.ssh_public_key,
        vm_password: vmPassword,
        owner_id: data.owner_id || null,
      });
    }

    // 자동 SSH 포트포워딩 (실패해도 VM 생성 자체는 성공)
    let autoSshPort: number | null = null;
    let autoSshIp: string | null = null;
    if (provisioned.ip_address) {
      try {
        const pf = await portForwardService.create({
          tenantId: DEFAULT_TENANT_ID,
          ownerId: data.owner_id || undefined,
          vmId: provisioned.vm_id,
          internalIp: provisioned.ip_address,
          internalPort: 22,
          protocol: 'tcp',
          description: `auto-ssh:${data.name}`,
        });
        autoSshPort = pf.external_port;
        autoSshIp = pf.external_ip;
        console.log(`[VM Service] Auto SSH PF: ${pf.external_ip}:${pf.external_port} → ${provisioned.ip_address}:22`);
      } catch (pfError: any) {
        console.warn(`[VM Service] Auto SSH PF 실패 (${data.name}): ${pfError?.message ?? pfError}`);
      }
    }

    return {
      success: true,
      vm_id: provisioned.vm_id,
      name: data.name,
      message: 'VM created successfully',
      auto_ssh: autoSshPort ? { external_ip: autoSshIp, external_port: autoSshPort } : null,
    };
  } catch (error: any) {
    console.error(`[VM Service] VM creation failed:`, error.message);
    throw error;
  }
}

/**
 * VM 서비스
 */
export const vmService = {
  /**
   * VM 목록 조회
   * ownerId가 있으면 해당 사용자 VM만, 없으면 전체 (관리자용)
   */
  async getAllVms(ownerId?: string) {
    const allVms = ownerId
      ? await db.select().from(vms).where(eq(vms.owner_id, ownerId))
      : await db.select().from(vms);

    if (allVms.length === 0) return [];

    const vmIds = allVms.map(v => v.vm_id);
    const allPortForwards = await db
      .select()
      .from(portForwards)
      .where(inArray(portForwards.vm_id, vmIds));

    return allVms.map(vm => ({
      ...vm,
      port_forwards: allPortForwards.filter(pf => pf.vm_id === vm.vm_id),
    }));
  },

  async getVmById(id: string) {
    const result = await db.select().from(vms).where(eq(vms.vm_id, id));
    if (result.length === 0) return null;

    const vm = result[0];
    const vmPortForwards = await db
      .select()
      .from(portForwards)
      .where(eq(portForwards.vm_id, id));

    return {
      ...vm,
      port_forwards: vmPortForwards,
    };
  },

  async createVm(data: any, priority: number = 0): Promise<{ jobId: string; estimatedWait: number }> {
    const pendingCount = jobQueue.getPendingJobs().length;
    const runningCount = jobQueue.getRunningJobs().length;
    const slotsAvailable = Math.max(0, 3 - runningCount);
    const queuePosition = Math.max(0, pendingCount - slotsAvailable + 1);
    const estimatedWait = queuePosition * 120;

    const job = jobQueue.add({
      type: 'vm-create',
      payload: { data },
      priority,
      timeout: 600000,
      maxRetries: 1,
    });

    return { jobId: job.id, estimatedWait };
  },

  async getJobStatus(jobId: string) {
    const job = jobQueue.getJob(jobId);
    if (!job) return null;

    return {
      jobId: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result,
    };
  },

  async deleteVm(id: string): Promise<boolean> {
    const rows = await db.select().from(vms).where(eq(vms.vm_id, id));
    if (rows.length === 0) return false;
    const vm = rows[0];

    // 1) 연관 포트포워딩 정리 (pfSense + DB)
    const pfs = await db.select().from(portForwards).where(eq(portForwards.vm_id, id));
    for (const pf of pfs) {
      if (pf.pfsense_tracker) {
        await pfsenseClient.deletePortForward(pf.pfsense_tracker).catch(err =>
          console.warn(`[vmService] pfSense rule ${pf.pfsense_tracker} 삭제 실패:`, err?.message ?? err)
        );
      }
    }
    await db.delete(portForwards).where(eq(portForwards.vm_id, id));

    // 2) ESXi VM 파괴 (vmdk 함께 정리). 실패 시 throw 하여 DB row 는 유지(재시도 가능).
    if (vm.name) {
      await esxiClient.destroyVm(vm.name);
    }

    // 3) DB row 삭제
    await db.delete(vms).where(eq(vms.vm_id, id));
    return true;
  },

  async updateVmStatus(id: string, status: string) {
    await db.update(vms).set({ status, updated_at: new Date() }).where(eq(vms.vm_id, id));
    return true;
  },

  getQueueStatus() {
    return jobQueue.getStatus();
  },

  getPendingJobs() {
    return jobQueue.getPendingJobs().map(job => ({
      jobId: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      priority: job.priority,
    }));
  },

  /**
   * 진행 중(pending + running)인 모든 vm-create job 반환.
   * ownerId 가 주어지면 해당 사용자의 job 만 필터.
   */
  getActiveVmCreateJobs(ownerId?: string) {
    const all = [
      ...jobQueue.getRunningJobs(),
      ...jobQueue.getPendingJobs(),
    ];
    return all
      .filter(job => job.type === 'vm-create')
      .filter(job => {
        if (!ownerId) return true;
        const jobOwner = (job.payload as any)?.data?.owner_id;
        // admin 모드(owner_id 없이 생성된) job 은 owner 필터에서 제외
        return jobOwner === ownerId;
      })
      .map(job => ({
        jobId: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        vmName: (job.payload as any)?.data?.name ?? null,
      }));
  },
};

/**
 * Job Queue 의 executeJob 오버라이드
 */
(jobQueue as any).executeJob = async function (job: any) {
  if (job.type === 'vm-create') {
    return await processVmCreateJob(job.payload);
  }
  throw new Error(`Unknown job type: ${job.type}`);
};
