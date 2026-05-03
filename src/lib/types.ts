export interface VM {
  vm_id: string;
  name: string;
  status: 'running' | 'stopped' | 'creating' | 'deleting';
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  image_id: string;
  ssh_host: string;
  ssh_port: number;
  internal_ip: string;
  esxi_moref?: string;
  port_forwards?: PortForward[];
  created_at: string;
  updated_at?: string;
}

export interface Quota {
  max_vm_count: number;
  max_vcpu_total: number;
  max_ram_gb_total: number;
  max_disk_gb_total: number;
  max_public_ports: number;
  max_snapshots_per_vm: number;
}

export interface Usage {
  vm_count: number;
  vcpu_total: number;
  ram_gb_total: number;
  disk_gb_total: number;
  ports_used: number;
}

export interface PortForward {
  id: string;
  vm_id?: string;
  protocol: string;
  internal_ip: string;
  internal_port: number;
  external_ip: string;
  external_port: number;
  description?: string;
  created_at: string;
}
