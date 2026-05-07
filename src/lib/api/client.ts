export async function authFetch(url: string, options: RequestInit = {}) {
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

export async function getVMs() {
  const response = await authFetch('/api/vms');
  const data = await response.json();
  return data.data || [];
}

export async function getQuotas(userId?: string) {
  const url = userId
    ? `/api/quotas?userId=${encodeURIComponent(userId)}`
    : '/api/quotas';
  return authFetch(url);
}

export async function getImages(includeAll = false) {
  const url = `/api/images?source=library${includeAll ? '&include=all' : ''}`;
  const response = await authFetch(url);
  const data = await response.json();
  return data.data || [];
}

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

export async function controlVM(vmId: string, action: 'start' | 'stop' | 'restart') {
  return authFetch(`/api/vms/${vmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

export async function updateVMSpec(vmId: string, vcpu: number, ram_gb: number) {
  return authFetch(`/api/vms/${vmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vcpu, ram_gb }),
  });
}

export async function deleteVM(vmId: string) {
  return authFetch(`/api/vms/${vmId}`, { method: 'DELETE' });
}

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

export async function deletePortForward(pfId: string) {
  return authFetch(`/api/port-forwards/${pfId}`, { method: 'DELETE' });
}

export async function getJobStatus(jobId: string) {
  return authFetch(`/api/jobs/${jobId}`);
}

export async function getActiveJobs() {
  return authFetch('/api/jobs?active=true');
}
