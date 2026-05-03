import { db } from '../db';
import { vms, portForwards } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { esxiClient } from '../lib/infrastructure';
import { jobQueue, JobData } from '../lib/queue';

/**
 * VM 생성 Job 처리
 */
async function processVmCreateJob(jobData: any): Promise<any> {
  const { data } = jobData;

  try {
    // createVmFromTemplate handles datastore selection and Cloud-init internally
    const provisioned = await esxiClient.createVmFromTemplate({
      name: data.name,
      template: data.image_id,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key,
    });

    console.log(`[VM Service] VM provisioned: ${provisioned.vm_id}`);

    await db.insert(vms).values({
      vm_id: provisioned.vm_id,
      name: data.name,
      status: provisioned.status as any,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key,
      disk_gb: data.disk_gb,
      image_id: data.image_id,
      ssh_host: provisioned.ip_address || '',
      ssh_port: 22,
      internal_ip: provisioned.ip_address || '',
      esxi_moref: provisioned.moref,
    });

    return {
      success: true,
      vm_id: provisioned.vm_id,
      name: data.name,
      message: 'VM created successfully',
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
  async getAllVms() {
    const allVms = await db.select().from(vms);
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

  /**
   * VM 생성 (대기열 사용)
   * @returns Job ID
   */
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

    return {
      jobId: job.id,
      estimatedWait,
    };
  },

  /**
   * Job 상태 조회
   */
  async getJobStatus(jobId: string) {
    const job = jobQueue.getJob(jobId);
    if (!job) {
      return null;
    }

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

  async deleteVm(id: string) {
    await db.delete(vms).where(eq(vms.vm_id, id));
    return true;
  },

  async updateVmStatus(id: string, status: string) {
    await db.update(vms).set({ status, updated_at: new Date() }).where(eq(vms.vm_id, id));
    return true;
  },

  /**
   * 대기열 상태 조회
   */
  getQueueStatus() {
    return jobQueue.getStatus();
  },

  /**
   * 대기 중인 Job 목록 조회
   */
  getPendingJobs() {
    return jobQueue.getPendingJobs().map(job => ({
      jobId: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      priority: job.priority,
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
