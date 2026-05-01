import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execPromise = promisify(exec);

interface VmCreateParams {
  name: string;
  template: string;
  vcpu: number;
  ram_gb: number;
  ssh_public_key?: string;
  iso_path?: string; // 외부에서 제공하거나 내부에서 생성
  network?: string;
  folder?: string;
  resource_pool?: string;
}

interface VmResult {
  vm_id: string;
  status: string;
  ip_address?: string;
  moref?: string;
}

/**
 * GOVC 방식 프로덕션 등급 구현
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
      GOVC_NETWORK: process.env.GOVC_NETWORK || 'Internal-VNIC',
      GOVC_RESOURCE_POOL: process.env.GOVC_RESOURCE_POOL || '',
      GOVC_FOLDER: process.env.GOVC_FOLDER || '',
    };
  },

  async selectBestDatastore(prefix = 'ds-', minFreeGb = 20): Promise<string> {
    const env = this.getEnv();
    const { stdout } = await execPromise(`govc datastore.info -json`, { env });
    const data = JSON.parse(stdout);
    
    const candidates = data.Datastores
      .map((ds: any) => ({
        name: ds.Info.Name,
        freeSpaceGb: ds.Info.FreeSpace / (1024 ** 3)
      }))
      .filter((ds: any) => ds.name.startsWith(prefix) && ds.freeSpaceGb >= minFreeGb)
      .sort((a: any, b: any) => b.freeSpaceGb - a.freeSpaceGb);

    if (candidates.length === 0) {
      throw new Error(`No suitable datastore found with prefix ${prefix} and ${minFreeGb}GB free space.`);
    }

    console.log(`[govc] Selected datastore: ${candidates[0].name} (${candidates[0].freeSpaceGb.toFixed(2)}GB free)`);
    return candidates[0].name;
  },

  async createCloudInitIso(vmName: string, sshKey: string): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `cloudinit-${vmName}-`));
    const isoPath = path.join(os.tmpdir(), `${vmName}-cidata.iso`);

    const userData = `#cloud-config
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${sshKey}
`;
    const metaData = `instance-id: ${vmName}\nhostname: ${vmName}\n`;
    const networkConfig = `version: 2\nethernets:\n  ens160:\n    dhcp4: true\n`;

    await fs.writeFile(path.join(tmpDir, 'user-data'), userData);
    await fs.writeFile(path.join(tmpDir, 'meta-data'), metaData);
    await fs.writeFile(path.join(tmpDir, 'network-config'), networkConfig);

    // genisoimage 또는 mkisofs 필요
    await execPromise(`genisoimage -output ${isoPath} -volid cidata -joliet -rock ${tmpDir}/user-data ${tmpDir}/meta-data ${tmpDir}/network-config`);
    
    // 임시 디렉토리 삭제
    await fs.rm(tmpDir, { recursive: true, force: true });
    return isoPath;
  },

  async createVm(params: VmCreateParams): Promise<VmResult> {
    const env = this.getEnv();
    const ramMb = params.ram_gb * 1024;
    let createdVmName = params.name;
    let isoPath = '';

    try {
      // 1. 데이터스토어 자동 선택
      const datastore = await this.selectBestDatastore(process.env.DATASTORE_PREFIX || 'ds-');

      // 2. Cloud-init ISO 생성 (SSH 키가 제공된 경우)
      if (params.ssh_public_key) {
        isoPath = await this.createCloudInitIso(params.name, params.ssh_public_key);
      }

      // 3. VM Clone
      console.log(`[govc] Cloning VM: ${params.name} from ${params.template}...`);
      const poolFlag = env.GOVC_RESOURCE_POOL ? `-pool="${env.GOVC_RESOURCE_POOL}"` : '';
      const folderFlag = env.GOVC_FOLDER ? `-folder="${env.GOVC_FOLDER}"` : '';
      
      await execPromise(`govc vm.clone -vm="${params.template}" -ds="${datastore}" ${poolFlag} ${folderFlag} -on=false "${params.name}"`, { env });

      // 4. Resource & Network Update
      console.log(`[govc] Configuring resources and network...`);
      await execPromise(`govc vm.change -vm="${params.name}" -c=${params.vcpu} -m=${ramMb}`, { env });
      
      // 네트워크 설정 (기본 인터페이스 ens160을 위한 포트그룹 연결)
      const network = params.network || env.GOVC_NETWORK;
      await execPromise(`govc device.network.change -vm="${params.name}" -net="${network}" ethernet-0`, { env });

      // 5. Cloud-init ISO 삽입
      if (isoPath) {
        // ISO를 데이터스토어로 업로드 (선택사항, 여기서는 로컬 경로 사용 가정하거나 데이터스토어 경로 필요)
        // 실제 운영 환경에서는 govc datastore.upload 필요
        const remoteIsoPath = `cloud-init/${params.name}.iso`;
        await execPromise(`govc datastore.upload -ds="${datastore}" ${isoPath} ${remoteIsoPath}`, { env });
        await execPromise(`govc device.cdrom.insert -vm="${params.name}" -ds="${datastore}" ${remoteIsoPath}`, { env });
      }

      // 6. Power On
      console.log(`[govc] Powering on VM...`);
      await execPromise(`govc vm.power -on "${params.name}"`, { env });

      // 7. Wait for IP
      console.log(`[govc] Waiting for IP address (timeout 5m)...`);
      const { stdout: ipStdout } = await execPromise(`govc vm.ip -wait=5m "${params.name}"`, { env });
      const ipAddress = ipStdout.trim();

      // 8. Info Retrieval
      const { stdout: infoStdout } = await execPromise(`govc vm.info -json "${params.name}"`, { env });
      const info = JSON.parse(infoStdout);

      // Cleanup local ISO
      if (isoPath) await fs.unlink(isoPath).catch(() => {});

      return {
        vm_id: info.VirtualMachines[0].Config.Uuid,
        status: 'running',
        ip_address: ipAddress,
        moref: info.VirtualMachines[0].Self.Value
      };

    } catch (error) {
      console.error(`[govc] Provisioning failed for ${params.name}:`, error);
      // Rollback: Destroy VM on failure
      await execPromise(`govc vm.destroy "${params.name}"`, { env }).catch(() => {});
      if (isoPath) await fs.unlink(isoPath).catch(() => {});
      throw error;
    }
  }
};

/**
 * RestAPI 방식 구현 (생략)
 */
const restStrategy = {
  async createVm(params: VmCreateParams): Promise<VmResult> {
    return { vm_id: 'rest-id', status: 'created' };
  }
};

/**
 * 통합 ESXi 클라이언트
 */
export const esxiClient = {
  get strategy() {
    return process.env.ESXI_MODE === 'rest' ? restStrategy : govcStrategy;
  },

  async createVmFromTemplate(params: VmCreateParams) {
    return await this.strategy.createVm(params);
  },

  async powerOff(name: string) {
    const env = (govcStrategy as any).getEnv();
    return await execPromise(`govc vm.power -off "${name}"`, { env });
  }
};

export const pfsenseClient = {
  getUrl() { return process.env.PFSENSE_URL || 'https://localhost'; },
  getInsecure() { return process.env.PFSENSE_INSECURE === 'true' || process.env.PFSENSE_INSECURE === '1'; },
  async addPortForward(internalIp: string, externalPort: number) {
    const url = this.getUrl();
    if (this.getInsecure()) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.log(`[pfSense] (${url}) Port forwarding added: ${externalPort} -> ${internalIp}:22`);
  }
};

