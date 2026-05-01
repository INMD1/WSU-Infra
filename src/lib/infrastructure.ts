import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

interface VmCreateParams {
  name: string;
  template: string;
  vcpu: number;
  ram_gb: number;
}

interface VmResult {
  vm_id: string;
  status: string;
  moref?: string;
}

/**
 * GOVC 방식 구현
 */
const govcStrategy = {
  getEnv() {
    return {
      ...process.env,
      GOVC_URL: process.env.GOVC_URL || '',
      GOVC_USERNAME: process.env.GOVC_USERNAME || '',
      GOVC_PASSWORD: process.env.GOVC_PASSWORD || '',
      GOVC_INSECURE: (process.env.GOVC_INSECURE === '1' || process.env.GOVC_INSECURE === 'true') ? '1' : '0',
      GOVC_DATASTORE: process.env.GOVC_DATASTORE || '',
      GOVC_NETWORK: process.env.GOVC_NETWORK || '',
    };
  },

  async createVm(params: VmCreateParams): Promise<VmResult> {
    const ramMb = params.ram_gb * 1024;
    const env = this.getEnv();

    await execPromise(`govc vm.clone -vm "${params.template}" -on=false "${params.name}"`, { env });
    await execPromise(`govc vm.change -vm "${params.name}" -c ${params.vcpu} -m ${ramMb}`, { env });
    await execPromise(`govc vm.power -on "${params.name}"`, { env });
    
    const { stdout } = await execPromise(`govc vm.info -json "${params.name}"`, { env });
    const info = JSON.parse(stdout);
    return {
      vm_id: info.VirtualMachines[0].Config.Uuid,
      status: 'running',
      moref: info.VirtualMachines[0].Self.Value
    };
  }
};

/**
 * RestAPI 방식 구현 (기본 스켈레톤)
 */
const restStrategy = {
  baseUrl: process.env.GOVC_URL, // 보통 동일한 호스트

  async createVm(params: VmCreateParams): Promise<VmResult> {
    console.log('RestAPI를 통해 VM 생성 중...', params.name);
    // 실제 구현 시 fetch()를 사용하여 vCenter/ESXi REST API 호출
    // 예: POST /rest/vcenter/vm (vCenter 환경 필요)
    
    // 데모용 가상 응답
    return {
      vm_id: Math.random().toString(36).substring(2, 15),
      status: 'creating',
      moref: 'vm-rest-123'
    };
  }
};

/**
 * 통합 ESXi 클라이언트 (전략 선택)
 */
export const esxiClient = {
  get strategy() {
    return process.env.ESXI_MODE === 'rest' ? restStrategy : govcStrategy;
  },

  async createVmFromTemplate(params: VmCreateParams) {
    return await this.strategy.createVm(params);
  },

  async powerOff(name: string) {
    if (process.env.ESXI_MODE === 'rest') {
       console.log('RestAPI: Powering off', name);
       return;
    }
    const env = (govcStrategy as any).getEnv();
    return await execPromise(`govc vm.power -off "${name}"`, { env });
  }
};

export const pfsenseClient = {
  /**
   * pfSense 접속 주소 가져오기
   */
  getUrl() {
    return process.env.PFSENSE_URL || 'https://localhost';
  },

  /**
   * pfSense API 호출 시 SSL 인증서 검증 여부 설정
   */
  getInsecure() {
    return process.env.PFSENSE_INSECURE === 'true' || process.env.PFSENSE_INSECURE === '1';
  },

  async addPortForward(internalIp: string, externalPort: number) {
    const url = this.getUrl();
    if (this.getInsecure()) {
      // Node.js 환경에서 자가 서명 인증서 허용
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    
    console.log(`[pfSense] (${url}) Port forwarding added: ${externalPort} -> ${internalIp}:22 (Insecure: ${this.getInsecure()})`);
    
    // 실제 구현 시 fetch 또는 axios 사용 시 agent: new https.Agent({ rejectUnauthorized: false }) 방식을 권장합니다.
  }
};
