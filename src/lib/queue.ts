import { v4 as uuidv4 } from 'uuid';

/**
 * Job 상태
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Job 인터페이스
 */
export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number; // 낮을수록 우선순위 높음
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
  retryCount: number;
  maxRetries: number;
  timeout?: number; // ms 단위
}

/**
 * Job 생성 시 필요한 데이터
 */
export interface JobData<T = any> {
  type: string;
  payload: T;
  priority?: number;
  timeout?: number;
  maxRetries?: number;
}

/**
 * 대기열 상태
 */
export interface QueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * 고급 대기열 시스템
 * - 우선순위 기반 처리
 * - 동시성 제어
 * - 자동 재시도
 * - 시간 제한
 */
export class JobQueue {
  private queue: Map<string, Job> = new Map();
  private processingQueue: Job[] = [];
  private maxConcurrent: number;
  private activeJobs: number = 0;
  private processing: boolean = false;

  constructor(maxConcurrent: number = 2) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Job 생성 및 대기열에 추가
   */
  add<T>(data: JobData<T>): Job<T> {
    const job: Job<T> = {
      id: uuidv4(),
      type: data.type,
      payload: data.payload,
      status: 'pending',
      priority: data.priority || 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: data.maxRetries || 3,
      timeout: data.timeout || 300000, // 5 분 기본
    };

    this.queue.set(job.id, job);
    this.processingQueue.push(job);

    // 우선순위로 정렬 (낮을수록 우선)
    this.processingQueue.sort((a, b) => a.priority - b.priority);

    // 대기열 처리 시작
    if (!this.processing) {
      this.process();
    }

    return job;
  }

  /**
   * 대기열 처리
   */
  private async process() {
    this.processing = true;

    while (this.activeJobs < this.maxConcurrent && this.processingQueue.length > 0) {
      const job = this.processingQueue.shift();
      if (!job) break;

      if (job.status === 'completed' || job.status === 'failed') {
        continue;
      }

      this.activeJobs++;
      job.status = 'running';
      job.startedAt = new Date();

      try {
        const startTime = Date.now();

        // 시간 제한 적용
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Job ${job.id} timed out`)), job.timeout!);
        });

        // Job 실행 (외부에서 처리)
        const result = await Promise.race([
          this.executeJob(job),
          timeoutPromise
        ]);

        job.result = result;
        job.status = 'completed';
        job.completedAt = new Date();

        console.log(`[Queue] Job ${job.id} (${job.type}) completed in ${Date.now() - startTime}ms`);
      } catch (error: any) {
        console.error(`[Queue] Job ${job.id} (${job.type}) failed:`, error.message);

        if (job.retryCount < job.maxRetries) {
          job.retryCount++;
          job.status = 'pending';
          this.processingQueue.unshift(job);
          console.log(`[Queue] Job ${job.id} retry ${job.retryCount}/${job.maxRetries}`);
        } else {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
        }
      } finally {
        this.activeJobs--;
      }
    }

    this.processing = false;
  }

  /**
   * Job 실행 (외부에서 override)
   */
  protected async executeJob(job: Job): Promise<any> {
    // 기본 구현은 외부에서 처리되도록 설계
    // 실제 구현은 VM 생성 서비스 등에서 호출
    throw new Error('Job executor not implemented');
  }

  /**
   * Job 상태 조회
   */
  getJob(id: string): Job | undefined {
    return this.queue.get(id);
  }

  /**
   * 대기열 상태 조회
   */
  getStatus(): QueueStatus {
    const status: QueueStatus = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };

    this.queue.forEach(job => {
      status.total++;
      if (job.status === 'pending') status.pending++;
      else if (job.status === 'running') status.running++;
      else if (job.status === 'completed') status.completed++;
      else if (job.status === 'failed') status.failed++;
    });

    return status;
  }

  /**
   * 대기 중인 Job 목록 조회
   */
  getPendingJobs(): Job[] {
    return Array.from(this.queue.values()).filter(job => job.status === 'pending');
  }

  /**
   * 진행 중인 Job 목록 조회
   */
  getRunningJobs(): Job[] {
    return Array.from(this.queue.values()).filter(job => job.status === 'running');
  }

  /**
   * 대기열 비우기
   */
  clear() {
    this.queue.clear();
    this.processingQueue = [];
    this.activeJobs = 0;
    this.processing = false;
  }

  /**
   * Job 취소
   */
  cancel(id: string): boolean {
    const job = this.queue.get(id);
    if (!job) return false;

    if (job.status === 'pending') {
      this.queue.delete(id);
      this.processingQueue = this.processingQueue.filter(j => j.id !== id);
      return true;
    }

    return false;
  }
}

/**
 * 글로벌 대기열 인스턴스
 */
export const jobQueue = new JobQueue(2); // 최대 2 개 동시 처리
