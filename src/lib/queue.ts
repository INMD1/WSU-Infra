import { v4 as uuidv4 } from 'uuid';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
  retryCount: number;
  maxRetries: number;
  timeout?: number;
}

export interface JobData<T = any> {
  type: string;
  payload: T;
  priority?: number;
  timeout?: number;
  maxRetries?: number;
}

export interface QueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export class JobQueue {
  private queue: Map<string, Job> = new Map();
  private processingQueue: Job[] = [];
  private maxConcurrent: number;
  private activeJobs: number = 0;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

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
      timeout: data.timeout || 300000,
    };

    this.queue.set(job.id, job);
    this.processingQueue.push(job);
    this.processingQueue.sort((a, b) => a.priority - b.priority);

    this.process();
    return job;
  }

  // Synchronous: fills all available slots immediately (true concurrency)
  private process() {
    while (this.activeJobs < this.maxConcurrent && this.processingQueue.length > 0) {
      const job = this.processingQueue.shift();
      if (!job || job.status === 'completed' || job.status === 'failed') continue;

      this.activeJobs++;
      job.status = 'running';
      job.startedAt = new Date();
      this.runJob(job);
    }
  }

  private async runJob(job: Job): Promise<void> {
    const startTime = Date.now();
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job ${job.id} timed out`)), job.timeout!);
      });

      job.result = await Promise.race([this.executeJob(job), timeoutPromise]);
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
      this.process();
    }
  }

  protected async executeJob(job: Job): Promise<any> {
    throw new Error('Job executor not implemented');
  }

  getJob(id: string): Job | undefined {
    return this.queue.get(id);
  }

  getStatus(): QueueStatus {
    const status: QueueStatus = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
    this.queue.forEach(job => {
      status.total++;
      if (job.status === 'pending') status.pending++;
      else if (job.status === 'running') status.running++;
      else if (job.status === 'completed') status.completed++;
      else if (job.status === 'failed') status.failed++;
    });
    return status;
  }

  getPendingJobs(): Job[] {
    return Array.from(this.queue.values()).filter(job => job.status === 'pending');
  }

  getRunningJobs(): Job[] {
    return Array.from(this.queue.values()).filter(job => job.status === 'running');
  }

  clear() {
    this.queue.clear();
    this.processingQueue = [];
    this.activeJobs = 0;
  }

  cancel(id: string): boolean {
    const job = this.queue.get(id);
    if (!job || job.status !== 'pending') return false;
    this.queue.delete(id);
    this.processingQueue = this.processingQueue.filter(j => j.id !== id);
    return true;
  }
}

export const jobQueue = new JobQueue(3);
