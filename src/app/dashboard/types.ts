/**
 * Dashboard 관련 타입 정의
 * 이 파일에서 모든 타입을 관리합니다.
 */

// 포트포워딩 정보
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

// 가상 머신 정보
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

// 이미지 정보 (Content Library)
export interface Image {
  name: string;
  size_gb: number;
  library_path: string;
  type: string;
}

// 쿼터 정보
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

// VM 생성 폼 데이터
export interface NewVmForm {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  image_id: string;
}

// 포트포워딩 생성 폼 데이터
export interface NewPortForwardForm {
  internal_port: number;
  external_port: string;
  protocol: string;
  description: string;
}

// Job 상태
export interface JobStatus {
  status: string;
  error?: string;
}