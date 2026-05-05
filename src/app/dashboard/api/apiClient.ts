/**
 * API 호출을 위한 헬퍼 함수
 * 모든 API 요청은 이 파일을 통해 처리됩니다.
 */

/**
 * 인증 토큰을 포함하여 API 요청을 보냅니다.
 * @param url - 요청할 URL
 * @param options - Fetch 옵션
 * @returns Fetch 응답
 */
export async function authFetch(url: string, options: RequestInit = {}) {
  // 브라우저 환경에서만 localStorage 접근
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * VM 목록을 가져옵니다.
 */
export async function getVMs() {
  const response = await authFetch('/api/vms');
  const data = await response.json();
  return data.data || [];
}

/**
 * 쿼터 정보를 가져옵니다.
 * @param userId - 사용자 ID (있을 경우)
 */
export async function getQuotas(userId?: string) {
  const url = userId
    ? `/api/quotas?userId=${encodeURIComponent(userId)}`
    : '/api/quotas';
  return authFetch(url);
}

/**
 * Content Library 의 이미지 목록을 가져옵니다.
 * @param includeAll - ISO 등 모든 항목 포함 여부
 */
export async function getImages(includeAll = false) {
  const url = `/api/images?source=library${includeAll ? '&include=all' : ''}`;
  const response = await authFetch(url);
  const data = await response.json();
  return data.data || [];
}

/**
 * 새로운 VM 을 생성합니다.
 * @param vmData - VM 생성 데이터
 */
export async function createVM(vmData: {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  image_id: string;
}) {
  return authFetch('/api/vms', {
    method: 'POST',
    body: JSON.stringify(vmData),
  });
}

/**
 * VM 의 전원 상태를 변경합니다.
 * @param vmId - VM ID
 * @param action - 작업 (start, stop, restart)
 */
export async function controlVM(vmId: string, action: 'start' | 'stop' | 'restart') {
  return authFetch(`/api/vms/${vmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

/**
 * VM 의 사양을 변경합니다.
 * @param vmId - VM ID
 * @param vcpu - vCPU 개수
 * @param ram_gb - RAM 크기 (GB)
 */
export async function updateVMSpec(vmId: string, vcpu: number, ram_gb: number) {
  return authFetch(`/api/vms/${vmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vcpu, ram_gb }),
  });
}

/**
 * VM 을 삭제합니다.
 * @param vmId - VM ID
 */
export async function deleteVM(vmId: string) {
  return authFetch(`/api/vms/${vmId}`, { method: 'DELETE' });
}

/**
 * 포트포워딩을 생성합니다.
 * @param data - 포트포워딩 데이터
 */
export async function createPortForward(data: {
  vm_id: string;
  internal_ip: string;
  internal_port: number;
  protocol: string;
  external_port?: number;
  description?: string;
}) {
  return authFetch('/api/port-forwards', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * 포트포워딩을 삭제합니다.
 * @param pfId - 포트포워딩 ID
 */
export async function deletePortForward(pfId: string) {
  return authFetch(`/api/port-forwards/${pfId}`, { method: 'DELETE' });
}

/**
 * Job 상태를 확인합니다.
 * @param jobId - Job ID
 */
export async function getJobStatus(jobId: string) {
  return authFetch(`/api/jobs/${jobId}`);
}

/**
 * 활성 Job 목록을 가져옵니다.
 */
export async function getActiveJobs() {
  return authFetch('/api/jobs?active=true');
}