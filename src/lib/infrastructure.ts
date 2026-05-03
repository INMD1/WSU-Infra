import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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
  datastore?: string; // 데이터스토어 이름
}

interface VmResult {
  vm_id: string;
  status: string;
  ip_address?: string;
  moref?: string;
}

/**
 * Content Library 이미지 인터페이스
 */
interface CloudImage {
  id: string;
  name: string;
  description?: string;
  type: 'ova' | 'ovf' | 'appliance';
  size: number;
  created_time: string;
  updated_time: string;
  tags?: string[];
}

/**
 * Datastore 정보 인터페이스
 */
interface DatastoreInfo {
  name: string;
  capacity_gb: number;
  free_gb: number;
  usage_percent: number;
  type: string;
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
      GOVC_DATACENTER: process.env.GOVC_DATACENTER || '/',
    };
  },

  /**
   * 용량 기반으로 최적의 Datastore 자동 선택
   */
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

  /**
   * 모든 Datastore 정보 조회 (사용률 기반 정렬)
   */
  async listDatastores(): Promise<DatastoreInfo[]> {
    const env = this.getEnv();
    const { stdout } = await execPromise(`govc datastore.info -json`, { env });
    const data = JSON.parse(stdout);

    return data.Datastores.map((ds: any) => {
      const capacityGb = ds.Info.Capacity / (1024 ** 3);
      const freeGb = ds.Info.FreeSpace / (1024 ** 3);
      return {
        name: ds.Info.Name,
        capacity_gb: Math.round(capacityGb * 100) / 100,
        free_gb: Math.round(freeGb * 100) / 100,
        usage_percent: Math.round(((capacityGb - freeGb) / capacityGb) * 100 * 100) / 100,
        type: ds.Info.Type || 'unknown'
      };
    }).sort((a: DatastoreInfo, b: DatastoreInfo) => a.name.localeCompare(b.name));
  },

  /**
   * Cloud-init ISO 자동 생성 (genisoimage/mkisofs 필요)
   */
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

  /**
   * VM에 Cloud-init 정보를 ExtraConfig 방식으로 인젝션
   * (ISO 없이 guestinfo 속성을 통한 경량 방식)
   */
  async injectCloudInitViaExtraConfig(vmName: string, sshKey: string): Promise<void> {
    const env = this.getEnv();

    const userData = {
      users: [{
        name: 'ubuntu',
        sudo: 'ALL=(ALL) NOPASSWD:ALL',
        shell: '/bin/bash',
        ssh_authorized_keys: [sshKey]
      }]
    };

    const metaData = {
      instance_id: vmName,
      hostname: vmName
    };

    const userDataB64 = Buffer.from(JSON.stringify(userData)).toString('base64');
    const metaDataB64 = Buffer.from(JSON.stringify(metaData)).toString('base64');

    // govc vm.update 로 ExtraConfig 설정
    await execPromise(
      `govc vm.update -vm="${vmName}" ` +
      `-e="guestinfo.userdata=${userDataB64}" ` +
      `-e="guestinfo.userdata.encoding=base64" ` +
      `-e="guestinfo.metadata=${metaDataB64}" ` +
      `-e="guestinfo.metadata.encoding=base64"`,
      { env }
    );
  },

  async createVm(params: VmCreateParams): Promise<VmResult> {
    const env = this.getEnv();
    const ramMb = params.ram_gb * 1024;
    let createdVmName = params.name;
    let isoPath = '';

    try {
      // Use caller-provided datastore or auto-select
      const datastore = params.datastore || await this.selectBestDatastore(process.env.DATASTORE_PREFIX || 'ds-');

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
      try {
        console.log(`[govc] Rolling back: destroying VM ${createdVmName}...`);
        await execPromise(`govc vm.destroy "${createdVmName}"`, { env });
        console.log(`[govc] Rollback completed: VM ${createdVmName} destroyed.`);
      } catch (rollbackError) {
        console.warn(`[govc] Rollback warning for ${createdVmName}:`, rollbackError);
      }

      // Cleanup local ISO
      if (isoPath) await fs.unlink(isoPath).catch(() => {});

      throw error;
    }
  },

  /**
   * Content Library 목록 조회
   */
  async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]> {
    const env = this.getEnv();
    const { stdout } = await execPromise(`govc about.library.ls -json`, { env });
    const data = JSON.parse(stdout);

    return (data.Libraries || []).map((lib: any) => ({
      id: lib.Self.Value,
      name: lib.Config.Name,
      type: lib.Config.Type || 'local'
    }));
  },

  /**
   * Content Library 내 이미지 (OVA/OVF) 목록 조회
   * @param libraryPath - Library 경로 (예: "/" 또는 "/MyLibrary")
   */
  async listCloudImages(libraryPath = '/'): Promise<CloudImage[]> {
    const env = this.getEnv();

    // govc about.library.item.ls 로 Library Item 조회
    const { stdout } = await execPromise(`govc about.library.item.ls -json ${libraryPath}`, { env });
    const data = JSON.parse(stdout);

    return (data.Items || []).map((item: any) => {
      const fileSize = item.FileSize || 0;
      return {
        id: item.Self?.Value || item.Info?.Key || '',
        name: item.Info?.Name || 'Unknown',
        description: item.Info?.Description || '',
        type: this.detectImageType(item.Info?.Name || ''),
        size: fileSize,
        size_gb: Math.round(fileSize / (1024 ** 3) * 100) / 100,
        created_time: item.Info?.CreatedTime?.toISOString() || new Date().toISOString(),
        updated_time: item.Info?.UpdatedTime?.toISOString() || new Date().toISOString(),
        tags: item.Tag?.Attachment?.map((t: any) => t.Name) || []
      };
    });
  },

  /**
   * 이미지 파일명 기반으로 타입 감지
   */
  detectImageType(name: string): 'ova' | 'ovf' | 'appliance' {
    const lowerName = name.toLowerCase();
    if (lowerName.endsWith('.ova')) return 'ova';
    if (lowerName.endsWith('.ovf')) return 'ovf';
    return 'appliance';
  },

  /**
   * Content Library 이미지를 템플릿으로 클론 (Library Item 배포)
   */
  async deployFromLibrary(imageName: string, vmName: string, libraryPath = '/'): Promise<void> {
    const env = this.getEnv();
    const datastore = await this.selectBestDatastore();

    // govc library.deploy 또는 govc vm.clone 사용
    await execPromise(
      `govc library.deploy -library="${libraryPath}" -name="${imageName}" -vm="${vmName}" -ds="${datastore}"`,
      { env }
    );
  }
};

/**
 * RestAPI 방식 구현 (Placeholder)
 */
const restStrategy = {
  async createVm(params: VmCreateParams): Promise<VmResult> {
    return { vm_id: 'rest-id', status: 'created' };
  },

  async selectBestDatastore(): Promise<string> {
    return 'datastore-rest';
  },

  async listDatastores(): Promise<DatastoreInfo[]> {
    return [];
  },

  async createCloudInitIso(): Promise<string> {
    return '';
  },

  async injectCloudInitViaExtraConfig(): Promise<void> {
    // noop
  },

  async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]> {
    return [];
  },

  async listCloudImages(): Promise<CloudImage[]> {
    return [];
  },

  async deployFromLibrary(): Promise<void> {
    // noop
  },

  detectImageType(): 'ova' | 'ovf' | 'appliance' {
    return 'ova';
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
  },

  // Datastore 관련
  async selectBestDatastore(prefix = 'ds-', minFreeGb = 20): Promise<string> {
    return await this.strategy.selectBestDatastore(prefix, minFreeGb);
  },

  async listDatastores(): Promise<DatastoreInfo[]> {
    return await this.strategy.listDatastores();
  },

  // Cloud-init 관련
  async createCloudInitIso(vmName: string, sshKey: string): Promise<string> {
    return await this.strategy.createCloudInitIso(vmName, sshKey);
  },

  async injectCloudInitViaExtraConfig(vmName: string, sshKey: string): Promise<void> {
    return await this.strategy.injectCloudInitViaExtraConfig(vmName, sshKey);
  },

  // Content Library 관련
  async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]> {
    return await this.strategy.listContentLibraries();
  },

  async listCloudImages(libraryPath = '/'): Promise<CloudImage[]> {
    return await this.strategy.listCloudImages(libraryPath);
  },

  detectImageType(name: string): 'ova' | 'ovf' | 'appliance' {
    return this.strategy.detectImageType(name);
  },

  async deployFromLibrary(imageName: string, vmName: string, libraryPath = '/'): Promise<void> {
    return await this.strategy.deployFromLibrary(imageName, vmName, libraryPath);
  }
};

export interface PortForwardParams {
  internalIp: string;
  internalPort: number;
  externalPort: number;
  protocol?: string;
  description?: string;
}

export interface PortForwardResult {
  tracker: string;
  externalIp: string;
  externalPort: number;
  internalIp: string;
  internalPort: number;
  protocol: string;
}

export interface PfSenseNatRule {
  tracker: string;
  interface: string;
  protocol: string;
  target: string;
  'local-port': string;
  dstport: string;
  descr: string;
}

export const pfsenseClient = {
  getUrl(): string {
    return process.env.PFSENSE_URL || '';
  },

  getWanIp(): string {
    return process.env.PFSENSE_WAN_IP || '';
  },

  getHeaders(): Record<string, string> {
    const clientId = process.env.PFSENSE_API_CLIENT_ID || '';
    const apiKey = process.env.PFSENSE_API_KEY || '';
    const auth = clientId ? `${clientId} ${apiKey}` : apiKey;
    return {
      'Content-Type': 'application/json',
      'Authorization': auth,
    };
  },

  assertConfigured() {
    if (!this.getUrl()) throw new Error('PFSENSE_URL is not configured');
    if (!process.env.PFSENSE_API_KEY) throw new Error('PFSENSE_API_KEY is not configured');
  },

  // Scoped TLS override: restore the original value after the request completes.
  // NODE_TLS_REJECT_UNAUTHORIZED is process-global, so we save/restore to avoid
  // permanently disabling verification for all other concurrent HTTPS connections.
  async fetchWithTls(url: string, options: RequestInit = {}): Promise<Response> {
    const insecure = process.env.PFSENSE_INSECURE === 'true' || process.env.PFSENSE_INSECURE === '1';
    if (!insecure) return fetch(url, { ...options, headers: this.getHeaders() });

    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      return await fetch(url, { ...options, headers: this.getHeaders() });
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      }
    }
  },

  async listPortForwards(): Promise<PfSenseNatRule[]> {
    this.assertConfigured();
    const res = await this.fetchWithTls(`${this.getUrl()}/api/v2/firewall/nat/port_forwards`);
    const json = await res.json() as any;
    if (json.code !== 200) throw new Error('pfSense NAT list failed');
    return (json.data as PfSenseNatRule[]) || [];
  },

  async addPortForward(params: PortForwardParams): Promise<PortForwardResult> {
    this.assertConfigured();
    const protocol = params.protocol || 'tcp';
    const res = await this.fetchWithTls(`${this.getUrl()}/api/v2/firewall/nat/port_forward`, {
      method: 'POST',
      body: JSON.stringify({
        interface: 'wan',
        ipprotocol: 'inet',
        protocol,
        source: 'any',
        source_port: 'any',
        destination: 'wanaddress',
        destination_port: String(params.externalPort),
        target: params.internalIp,
        local_port: String(params.internalPort),
        descr: params.description || `Forward ${params.internalIp}:${params.internalPort}`,
        associated_rule_id: 'pass',
      }),
    });
    const json = await res.json() as any;
    if (json.code !== 200) throw new Error('pfSense NAT rule creation failed');

    return {
      tracker: json.data.tracker || json.data.id,
      externalIp: this.getWanIp(),
      externalPort: params.externalPort,
      internalIp: params.internalIp,
      internalPort: params.internalPort,
      protocol,
    };
  },

  async deletePortForward(id: string): Promise<void> {
    this.assertConfigured();
    const res = await this.fetchWithTls(
      `${this.getUrl()}/api/v2/firewall/nat/port_forward?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    const json = await res.json() as any;
    if (json.code !== 200) throw new Error('pfSense NAT rule deletion failed');
  },
};

