export interface PortForward {
  id: string;
  vm_id: string | null;
  protocol: string;
  internal_ip: string;
  internal_port: number;
  external_ip: string;
  external_port: number;
  description: string | null;
  created_at: string;
}

export interface Vm {
  vm_id: string;
  name: string;
  status: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  internal_ip: string | null;
  vm_password: string | null;
  port_forwards: PortForward[];
  created_at: string;
}

export interface Image {
  name: string;
  size_gb: number;
  library_path: string;
  type: string;
}

export interface Quota {
  quota: {
    max_vm_count: number;
    max_vcpu_total: number;
    max_ram_gb_total: number;
    max_disk_gb_total: number;
    max_public_ports: number;
  };
  usage: {
    vm_count: number;
    vcpu_total: number;
    ram_gb_total: number;
    disk_gb_total: number;
    ports_used: number;
  };
}

export interface NewVmForm {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  image_id: string;
}

export interface NewPortForwardForm {
  internal_port: number;
  external_port: string;
  protocol: string;
  description: string;
}

export interface JobStatus {
  status: string;
  error?: string;
}
