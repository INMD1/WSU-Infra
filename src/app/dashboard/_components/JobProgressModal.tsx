import type { JobStatus } from '@/types/dashboard';
import { Modal } from './Modal';

interface JobProgressModalProps {
  jobId: string;
  estimatedWait: number;
  jobStatus: JobStatus | null;
  onClose: () => void;
}

export function JobProgressModal({ jobId, estimatedWait, jobStatus, onClose }: JobProgressModalProps) {
  return (
    <Modal title="VM 생성 진행 상황" onClose={onClose}>
      <div className="mb-6">
        <div className="text-sm text-muted mb-1">Job ID</div>
        <code className="block p-2.5 bg-surface-soft rounded-md text-sm font-mono text-ink border border-hairline">{jobId}</code>
      </div>

      {jobStatus ? (
        <>
          <div className={`p-3 rounded-md font-medium mb-4 text-sm ${
            jobStatus.status === 'completed' ? 'alert-success' :
            jobStatus.status === 'failed'    ? 'alert-error'   :
            'alert-warning'
          }`}>
            {jobStatus.status === 'completed' ? '완료 — VM 목록을 확인하세요' :
             jobStatus.status === 'failed'    ? '실패' :
             '처리 중...'}
          </div>
          {jobStatus.status === 'running' && (
            <div className="progress-bar mb-4">
              <div className="progress-fill" style={{ width: '100%', animation: 'pulse 1.5s infinite' }} />
            </div>
          )}
          {jobStatus.error && (
            <div className="alert-error mb-4">
              <strong>오류:</strong> {jobStatus.error}
            </div>
          )}
        </>
      ) : (
        <p className="text-center text-muted">예상 대기: {Math.round(estimatedWait)}초</p>
      )}

      <button className="btn-primary w-full mt-4" onClick={onClose}>닫기</button>
    </Modal>
  );
}
