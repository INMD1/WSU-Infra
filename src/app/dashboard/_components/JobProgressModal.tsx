// VM 생성 Job 진행 상황 모달
// 완료/실패 후 3초 뒤 자동으로 닫힙니다 (useDashboard 훅에서 처리).

import type { JobStatus } from '../types';
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
        <div className="text-sm text-text-muted mb-1">Job ID</div>
        <code className="block p-2 bg-bg-secondary rounded text-sm">{jobId}</code>
      </div>

      {jobStatus ? (
        <>
          <div className={`p-2.5 rounded-md font-medium mb-4 ${
            jobStatus.status === 'completed' ? 'bg-green-100 text-green-800' :
            jobStatus.status === 'failed'    ? 'bg-red-100 text-red-800' :
            'bg-yellow-100 text-yellow-800'
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
            <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 text-sm">
              <strong>오류:</strong> {jobStatus.error}
            </div>
          )}
        </>
      ) : (
        <p className="text-center text-text-muted">예상 대기: {Math.round(estimatedWait)}초</p>
      )}

      <button className="btn-primary w-full mt-4" onClick={onClose}>닫기</button>
    </Modal>
  );
}
