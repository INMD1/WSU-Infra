import { db } from '../db';
import { vms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { esxiClient } from '../lib/infrastructure';
import { jobQueue, JobData } from '../lib/queue';

/**
 * VM 생성 Job 처리
 */
async function processVmCreateJob(jobData: any): Promise<any> {
  const { data, jobId } = jobData;

  try {
    console.log(`[VM Service] Starting VM creation job ${jobId}`);

    // 1. 데이터스토어 자동 선택
    const datastore = await esxiClient.selectBestDatastore('ds-', 20);
    console.log(`[VM Service] Selected datastore: ${datastore}`);

    // 2. Cloud-init ISO 생성 (SSH 키 제공된 경우)
    let isoPath: string | undefined;
    if (data.ssh_public_key) {
      isoPath = await esxiClient.createCloudInitIso(data.name, data.ssh_public_key);
      console.log(`[VM Service] Created Cloud-init ISO: ${isoPath}`);
    }

    // 3. VM 프로비저닝
    const provisioned = await esxiClient.createVmFromTemplate({
      name: data.name,
      template: data.image_id,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key,
      iso_path: isoPath,
      datastore,
    });

    console.log(`[VM Service] VM provisioned: ${provisioned.vm_id}`);

    // 4. DB 에 기록
    const newVm = {
      vm_id: provisioned.vm_id,
      name: data.name,
      status: provisioned.status as any,
      vcpu: data.vcpu,
      ram_gb: data.ram_gb,
      ssh_public_key: data.ssh_public_key,
      disk_gb: data.disk_gb,
      image_id: data.image_id,
      ssh_host: '',
      ssh_port: 0,
      internal_ip: '',
      esxi_moref: provisioned.moref,
      job_id: jobId,
    };

    await db.insert(vms).values(newVm);

    // 5. 임시 ISO 파일 정리
    if (isoPath) {
      try {
        const fs = require('fs');
        fs.unlinkSync(isoPath);
      } catch (e) {
        console.warn(`[VM Service] Failed to remove ISO: ${isoPath}`);
      }
    }

    return {
      success: true,
      vm_id: provisioned.vm_id,
      name: data.name,
      message: 'VM created successfully',
    };
  } catch (error: any) {
    console.error(`[VM Service] VM creation failed:`, error.message);

    // 롤백: 생성된 VM 파괴
    if (error.provisionedVm) {
      try {
        await esxiClient.powerOff(error.provisionedVm);
        console.log(`[VM Service] Rolled back VM: ${error.provisionedVm}`);
      } catch (rollbackError) {
        console.error(`[VM Service] Rollback failed:`, rollbackError);
      }
    }

    throw error;
  }
}

/**
 * VM 서비스
 */
export const vmService = {
  async getAllVms() {
    return await db.select().from(vms);
  },

  async getVmById(id: string) {
    const result = await db.select().from(vms).where(eq(vms.vm_id, id));
    return result[0] || null;
  },

  /**
   * VM 생성 (대기열 사용)
   * @returns Job ID
   */
  async createVm(data: any, priority: number = 0): Promise<{ jobId: string; estimatedWait: number }> {
    const jobId = `vm-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 대기 중인 Job 수 확인
    const pendingCount = jobQueue.getPendingJobs().length;
    const estimatedWait = pendingCount * 120; // 평균 2 분씩 예상

    // Job 추가
    const jobData: JobData = {
      type: 'vm-create',
      payload: { data, jobId },
      priority,
      timeout: 600000, // 10 분
      maxRetries: 1,
    };

    jobQueue.add(jobData);

    return {
      jobId,
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
