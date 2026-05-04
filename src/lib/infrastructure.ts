import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

interface VmCreateParams {
  name: string;
  template: string;
  vcpu: number;
  ram_gb: number;
  ssh_public_key?: string;
  password?: string;
  network?: string;
  folder?: string;
  resource_pool?: string;
  datastore?: string;
  host?: string;
}

interface HostInfo {
  path: string;
  name: string;
  free_memory_mb: number;
  total_memory_mb: number;
  cpu_usage_mhz: number;
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
  size_gb: number;
  /** govc Content Library 경로. 예: "/MyLib/ubuntu-22.04". VM 배포 시 그대로 전달 */
  library_path: string;
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

  async selectBestDatastore(prefix = 'ds-', minFreeGb = 20, excludeNames: string[] = []): Promise<string> {
    // GOVC_DATASTORE가 설정된 경우 그대로 사용 (StoragePod 포함).
    if (process.env.GOVC_DATASTORE) {
      console.log(`[govc] Using configured datastore/StoragePod: ${process.env.GOVC_DATASTORE}`);
      return process.env.GOVC_DATASTORE;
    }

    const env = this.getEnv();
    const { stdout } = await execPromise(`govc datastore.info -json`, { env });
    const data = JSON.parse(stdout);

    const candidates = data.Datastores
      .map((ds: any) => ({
        name: ds.Info.Name,
        freeSpaceGb: ds.Info.FreeSpace / (1024 ** 3),
      }))
      .filter((ds: any) =>
        (prefix === '' || ds.name.startsWith(prefix)) &&
        ds.freeSpaceGb >= minFreeGb &&
        !excludeNames.includes(ds.name)
      )
      .sort((a: any, b: any) => b.freeSpaceGb - a.freeSpaceGb);

    if (candidates.length === 0) {
      throw new Error(`No suitable datastore found (prefix='${prefix}', min=${minFreeGb}GB free).`);
    }

    console.log(`[govc] Selected datastore: ${candidates[0].name} (${candidates[0].freeSpaceGb.toFixed(2)}GB free)`);
    return candidates[0].name;
  },

  /**
   * 입력이 StoragePod(Datastore Cluster)이면 여유 공간이 가장 많은 멤버 데이터스토어 이름 반환.
   * 일반 데이터스토어이면 입력값 그대로 반환.
   * library.deploy 처럼 SDRS 자동 배치를 신뢰할 수 없는 명령에 사용.
   */
  async resolveDatastoreForDeploy(name: string): Promise<string> {
    const env = this.getEnv();

    // 모든 데이터스토어 inventory path 조회
    let allDsPaths: string[] = [];
    try {
      const { stdout } = await execPromise(`govc find / -type s`, { env });
      allDsPaths = stdout.trim().split('\n').filter(Boolean);
    } catch {
      return name;
    }

    const memberPaths = allDsPaths.filter(p => p.includes(`/${name}/`));
    if (memberPaths.length === 0) return name;

    const memberNames = memberPaths
      .map(p => p.split('/').pop() ?? '')
      .filter(Boolean);

    // 벌크 + 개별 폴백으로 멤버 free space 수집
    const infoMap = new Map<string, number>();
    try {
      const { stdout } = await execPromise(`govc datastore.info -json`, { env });
      const data = JSON.parse(stdout);
      for (const ds of (data?.Datastores ?? []) as any[]) {
        const dsName = ds?.Info?.Name;
        const free = Number(ds?.Info?.FreeSpace ?? 0);
        if (dsName) infoMap.set(dsName, free);
      }
    } catch {
      // 벌크 실패 시 아래 개별 조회로 폴백
    }
    for (const memberName of memberNames) {
      if (infoMap.has(memberName)) continue;
      try {
        const { stdout } = await execPromise(`govc datastore.info -json "${memberName}"`, { env });
        const data = JSON.parse(stdout);
        const ds = data?.Datastores?.[0];
        if (ds?.Info?.Name) infoMap.set(ds.Info.Name, Number(ds.Info.FreeSpace ?? 0));
      } catch {
        // 다음 멤버 시도
      }
    }

    let best: { name: string; free: number } | null = null;
    for (const memberName of memberNames) {
      const free = infoMap.get(memberName);
      if (free === undefined) continue;
      if (!best || free > best.free) best = { name: memberName, free };
    }

    if (best) {
      console.log(`[govc] Resolved StoragePod "${name}" → member "${best.name}" (${(best.free / (1024 ** 3)).toFixed(2)}GB free)`);
      return best.name;
    }
    return name;
  },

  async listDatastores(): Promise<DatastoreInfo[]> {
    const env = this.getEnv();

    // GOVC_DATASTORE가 StoragePod(Datastore Cluster)인 경우 cluster.info로 조회.
    // govc datastore.info는 StoragePod를 개별 DS로 노출하지 않는다.
    if (process.env.GOVC_DATASTORE) {
      try {
        const { stdout } = await execPromise(
          `govc datastore.cluster.info -json "${process.env.GOVC_DATASTORE}"`,
          { env }
        );
        const data = JSON.parse(stdout);
        const pods: any[] = data?.StoragePods ?? [];
        if (pods.length > 0) {
          return pods.map((pod: any) => {
            const capacityGb = (pod.Summary?.Capacity ?? 0) / (1024 ** 3);
            const freeGb = (pod.Summary?.FreeSpace ?? 0) / (1024 ** 3);
            return {
              name: pod.Name ?? process.env.GOVC_DATASTORE!,
              capacity_gb: Math.round(capacityGb * 100) / 100,
              free_gb: Math.round(freeGb * 100) / 100,
              usage_percent: capacityGb > 0
                ? Math.round(((capacityGb - freeGb) / capacityGb) * 10000) / 100
                : 0,
              type: 'StoragePod',
            };
          });
        }
      } catch {
        // cluster.info 미지원 또는 단일 DS인 경우 — 아래 일반 조회로 fall-through
      }
    }

    const { stdout } = await execPromise(`govc datastore.info -json`, { env });
    const data = JSON.parse(stdout);
    return data.Datastores.map((ds: any) => {
      const capacityGb = ds.Info.Capacity / (1024 ** 3);
      const freeGb = ds.Info.FreeSpace / (1024 ** 3);
      return {
        name: ds.Info.Name,
        capacity_gb: Math.round(capacityGb * 100) / 100,
        free_gb: Math.round(freeGb * 100) / 100,
        usage_percent: Math.round(((capacityGb - freeGb) / capacityGb) * 10000) / 100,
        type: ds.Info.Type || 'unknown',
      };
    }).sort((a: DatastoreInfo, b: DatastoreInfo) => a.name.localeCompare(b.name));
  },

  // 이미지 데이터스토어에서 OVA/OVF 파일 목록 반환
  async listDatastoreImages(): Promise<{ name: string; path: string; size_gb: number }[]> {
    const env = this.getEnv();
    const imageDs = process.env.CLOUD_IMAGE_DATASTORE || 'SSD-DATASTORE-01';
    // 슬래시 제거 후 비어 있으면 루트 조회
    const imagePath = (process.env.CLOUD_IMAGE_PATH || 'Cloud-image').replace(/^\/|\/$/g, '');

    const parseFiles = (stdout: string, prefix: string) => {
      if (!stdout.trim()) return [];
      const raw = JSON.parse(stdout);
      // govc 버전에 따라 배열 또는 {File:[]} 형태
      const files: any[] = Array.isArray(raw)
        ? (raw[0]?.File ?? [])
        : (raw.File ?? []);
      return files
        .filter((f: any) => /\.(ova|ovf)$/i.test(f.Path ?? ''))
        .map((f: any) => ({
          name: f.Path,
          path: prefix ? `${prefix}/${f.Path}` : f.Path,
          size_gb: Math.round((f.FileSize ?? 0) / (1024 ** 3) * 10) / 10,
        }));
    };

    // 1차: 지정된 경로 시도 (슬래시 없이)
    if (imagePath) {
      try {
        const { stdout } = await execPromise(
          `govc datastore.ls -json -ds="${imageDs}" "${imagePath}"`,
          { env }
        );
        const result = parseFiles(stdout, imagePath);
        if (result.length > 0) return result;
      } catch {
        // 경로가 없거나 접근 불가 → 루트로 폴백
      }
    }

    // 2차: 데이터스토어 루트에서 직접 탐색
    const { stdout: rootOut } = await execPromise(
      `govc datastore.ls -json -ds="${imageDs}"`,
      { env }
    );
    return parseFiles(rootOut, '');
  },

  // 데이터센터 내 모든 ESXi 호스트와 메모리 여유 공간 반환
  async listHosts(): Promise<HostInfo[]> {
    const env = this.getEnv();
    const { stdout: hostPaths } = await execPromise('govc find -type h', { env });
    const paths = hostPaths.trim().split('\n').filter(Boolean);
    if (paths.length === 0) return [];

    const results: HostInfo[] = [];
    for (const hostPath of paths) {
      try {
        const { stdout } = await execPromise(`govc host.info -json "${hostPath}"`, { env });
        const raw = JSON.parse(stdout);
        // govc 버전에 따라 배열 또는 {HostSystems:[...]} 형태
        const hs = Array.isArray(raw) ? raw[0] : raw?.HostSystems?.[0];
        if (!hs) continue;

        const totalMemMb = Math.round((hs.Summary?.Hardware?.MemorySize ?? 0) / (1024 * 1024));
        const usedMemMb = hs.Summary?.QuickStats?.OverallMemoryUsage ?? totalMemMb;
        results.push({
          path: hostPath,
          name: hs.Summary?.Config?.Name ?? hostPath.split('/').pop() ?? hostPath,
          free_memory_mb: Math.max(0, totalMemMb - usedMemMb),
          total_memory_mb: totalMemMb,
          cpu_usage_mhz: hs.Summary?.QuickStats?.OverallCpuUsage ?? 0,
        });
      } catch {
        // 일시적으로 응답 없는 호스트는 건너뜀
      }
    }
    return results;
  },

  // 메모리 여유 공간이 가장 많은 호스트 경로 반환
  async selectBestHost(): Promise<string> {
    const hosts = await this.listHosts();
    if (hosts.length === 0) throw new Error('No ESXi hosts found in datacenter');
    hosts.sort((a, b) => b.free_memory_mb - a.free_memory_mb);
    const best = hosts[0];
    console.log(`[govc] Selected host: ${best.name} (free memory: ${Math.round(best.free_memory_mb / 1024)}GB)`);
    return best.path;
  },

  // OVA 파일을 템플릿 VM으로 임포트 (이미 존재하면 그대로 반환)
  async ensureOvaTemplate(ovaFileName: string): Promise<string> {
    const env = this.getEnv();
    const imageDs = process.env.CLOUD_IMAGE_DATASTORE || 'SSD-DATASTORE-01';
    const imagePath = (process.env.CLOUD_IMAGE_PATH || 'Cloud-image').replace(/^\/|\/$/g, '');
    const templateName = `tpl-${ovaFileName.replace(/\.(ova|ovf)$/i, '')}`;

    // 이미 템플릿이 존재하면 재사용
    try {
      const { stdout } = await execPromise(`govc vm.info -json "${templateName}"`, { env });
      const info = JSON.parse(stdout);
      const vms = Array.isArray(info) ? info : info?.VirtualMachines ?? [];
      if (vms.length > 0) {
        console.log(`[govc] Template "${templateName}" already exists, reusing`);
        return templateName;
      }
    } catch {
      // 존재하지 않음 — 계속 진행
    }

    console.log(`[govc] Importing OVA "${ovaFileName}" as template...`);
    const tmpOvaPath = path.join(os.tmpdir(), `${Date.now()}-${ovaFileName}`);

    // 이미지 데이터스토어에서 로컬로 다운로드
    // imagePath가 있으면 "path/file.ova", 없으면 루트 "file.ova"
    const remoteOvaPath = imagePath ? `${imagePath}/${ovaFileName}` : ovaFileName;
    await execPromise(
      `govc datastore.download -ds="${imageDs}" "${remoteOvaPath}" "${tmpOvaPath}"`,
      { env }
    );

    try {
      const poolFlag = env.GOVC_RESOURCE_POOL ? `-pool="${env.GOVC_RESOURCE_POOL}"` : '';
      const folderFlag = env.GOVC_FOLDER ? `-folder="${env.GOVC_FOLDER}"` : '';
      // 이미지 데이터스토어에 템플릿 저장 (배포용 DS 절약)
      await execPromise(
        `govc import.ova -ds="${imageDs}" ${poolFlag} ${folderFlag} -name="${templateName}" "${tmpOvaPath}"`,
        { env }
      );
      await execPromise(`govc vm.markastemplate "${templateName}"`, { env });
      console.log(`[govc] Template "${templateName}" created and marked`);
    } finally {
      await fs.unlink(tmpOvaPath).catch(() => {});
    }

    return templateName;
  },

  // cloud-config YAML 생성 — 비밀번호, SSH 키, apt 미러를 한곳에서 관리
  buildCloudInitUserData(vmName: string, sshKey?: string, password?: string): string {
    const mirror = process.env.CLOUD_INIT_APT_MIRROR;
    const lines: string[] = ['#cloud-config', ''];

    lines.push('users:');
    lines.push('  - name: ubuntu');
    lines.push('    sudo: ALL=(ALL) NOPASSWD:ALL');
    lines.push('    shell: /bin/bash');
    lines.push('    lock_passwd: false');
    if (sshKey) {
      lines.push('    ssh_authorized_keys:');
      lines.push(`      - ${sshKey}`);
    }

    lines.push('');
    lines.push('ssh_pwauth: true');

    if (password) {
      lines.push('chpasswd:');
      lines.push('  expire: false');
      lines.push('  list: |');
      lines.push(`    ubuntu:${password}`);
    }

    if (mirror) {
      lines.push('');
      lines.push('apt:');
      lines.push('  primary:');
      lines.push('    - arches: [default]');
      lines.push(`      uri: ${mirror}`);
      lines.push('  security:');
      lines.push('    - arches: [default]');
      lines.push(`      uri: ${mirror}`);
    }

    return lines.join('\n') + '\n';
  },

  // ISO 방식 (genisoimage 필요, StoragePod 환경에서는 GOVC_ISO_DATASTORE 별도 설정 필요)
  async createCloudInitIso(vmName: string, sshKey?: string, password?: string): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `cloudinit-${vmName}-`));
    const isoPath = path.join(os.tmpdir(), `${vmName}-cidata.iso`);

    const userData = this.buildCloudInitUserData(vmName, sshKey, password);
    const metaData = `instance-id: ${vmName}\nhostname: ${vmName}\n`;
    const networkConfig = `version: 2\nethernets:\n  ens160:\n    dhcp4: true\n`;

    await fs.writeFile(path.join(tmpDir, 'user-data'), userData);
    await fs.writeFile(path.join(tmpDir, 'meta-data'), metaData);
    await fs.writeFile(path.join(tmpDir, 'network-config'), networkConfig);

    await execPromise(
      `genisoimage -output "${isoPath}" -volid cidata -joliet -rock` +
      ` "${tmpDir}/user-data" "${tmpDir}/meta-data" "${tmpDir}/network-config"`
    );
    await fs.rm(tmpDir, { recursive: true, force: true });
    return isoPath;
  },

  // ExtraConfig 방식 (ISO 불필요, StoragePod 환경에서 권장)
  // cloud-config YAML을 base64로 인코딩해 guestinfo에 주입 — VMware datasource가 부팅 시 읽음
  async injectCloudInitViaExtraConfig(vmName: string, sshKey?: string, password?: string): Promise<void> {
    const env = this.getEnv();
    const userData = this.buildCloudInitUserData(vmName, sshKey, password);
    const metaData = `instance-id: ${vmName}\nhostname: ${vmName}\n`;

    const userDataB64 = Buffer.from(userData).toString('base64');
    const metaDataB64 = Buffer.from(metaData).toString('base64');

    await execPromise(
      `govc vm.change -vm="${vmName}"` +
      ` -e guestinfo.userdata="${userDataB64}"` +
      ` -e guestinfo.userdata.encoding=base64` +
      ` -e guestinfo.metadata="${metaDataB64}"` +
      ` -e guestinfo.metadata.encoding=base64`,
      { env }
    );
  },

  async createVm(params: VmCreateParams): Promise<VmResult> {
    const env = this.getEnv();
    const ramMb = params.ram_gb * 1024;
    let createdVmName = params.name;
    let isoPath = '';
    const imageDs = process.env.CLOUD_IMAGE_DATASTORE || 'SSD-DATASTORE-01';

    try {
      // 호스트 자동 선택 (메모리 여유 공간 기준)
      const targetHost = params.host || await this.selectBestHost().catch(() => '');

      // 배포 데이터스토어 선택 (이미지 DS 제외)
      const datastore = params.datastore || await this.selectBestDatastore(
        process.env.DATASTORE_PREFIX || '',
        20,
        [imageDs]
      );

      const needsCloudInit = params.ssh_public_key || params.password || process.env.CLOUD_INIT_APT_MIRROR;
      const useIso = process.env.CLOUD_INIT_METHOD === 'iso';

      const hostFlag = targetHost ? `-host="${targetHost}"` : '';
      const poolFlag = env.GOVC_RESOURCE_POOL ? `-pool="${env.GOVC_RESOURCE_POOL}"` : '';
      const folderFlag = env.GOVC_FOLDER ? `-folder="${env.GOVC_FOLDER}"` : '';

      // template 형식 판별
      // - "/Lib/Item" 형식 → Content Library 항목 → govc library.deploy
      // - "*.ova" / "*.ovf" → CLOUD_IMAGE_DATASTORE 의 OVA 파일 → import 후 clone (legacy)
      // - 그 외 → 기존 템플릿 VM 이름 → vm.clone
      if (params.template.startsWith('/')) {
        // PowerCLI 는 New-VM 에 DatastoreCluster 객체를 직접 받아 SDRS 로 자동 배치하므로
        // govc library.deploy 의 StoragePod 미지원 한계를 회피.
        // selectBestHost 가 inventory path 를 반환 (예: /<dc>/host/<cluster>/host01) — 마지막 세그먼트만 사용
        const vmHostName = targetHost ? targetHost.split('/').pop() || '' : '';
        await this.deployLibraryItemViaPowerCLI({
          libraryItemPath: params.template,
          vmName: params.name,
          datastoreOrCluster: datastore,
          resourcePool: env.GOVC_RESOURCE_POOL,
          folder: env.GOVC_FOLDER,
          vmHost: vmHostName,
        });
      } else {
        const templateName = /\.(ova|ovf)$/i.test(params.template)
          ? await this.ensureOvaTemplate(params.template)
          : params.template;

        console.log(`[govc] Cloning "${templateName}" → "${params.name}" on host=${targetHost || 'auto'}, ds=${datastore}`);
        await execPromise(
          `govc vm.clone -vm="${templateName}" -ds="${datastore}" ${hostFlag} ${poolFlag} ${folderFlag} -on=false "${params.name}"`,
          { env }
        );
      }

      // Resource & Network
      console.log(`[govc] Configuring resources and network...`);
      await execPromise(`govc vm.change -vm="${params.name}" -c=${params.vcpu} -m=${ramMb}`, { env });
      const network = params.network || env.GOVC_NETWORK;
      await execPromise(`govc device.network.change -vm="${params.name}" -net="${network}" ethernet-0`, { env });

      // Cloud-init 주입
      // ExtraConfig가 기본 (ISO 불필요, StoragePod 호환)
      // CLOUD_INIT_METHOD=iso 설정 시에만 ISO 방식 사용
      if (needsCloudInit) {
        if (useIso) {
          isoPath = await this.createCloudInitIso(params.name, params.ssh_public_key, params.password);
          const isoDs = process.env.GOVC_ISO_DATASTORE || datastore;
          const remoteIsoPath = `cloud-init/${params.name}.iso`;
          await execPromise(`govc datastore.upload -ds="${isoDs}" "${isoPath}" "${remoteIsoPath}"`, { env });
          await execPromise(`govc device.cdrom.insert -vm="${params.name}" -ds="${isoDs}" "${remoteIsoPath}"`, { env });
        } else {
          console.log(`[govc] Injecting cloud-init via ExtraConfig...`);
          await this.injectCloudInitViaExtraConfig(params.name, params.ssh_public_key, params.password);
        }
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

      // Rollback: Destroy VM on failure (power-off + destroy + ISO 정리)
      try {
        console.log(`[govc] Rolling back: destroying VM ${createdVmName}...`);
        await this.destroyVm(createdVmName);
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
   * Content Library 항목을 PowerCLI 로 배포.
   * govc library.deploy 가 StoragePod(클러스터) 를 -ds 로 받지 못하는 한계 우회.
   * PowerCLI 의 New-VM 은 DatastoreCluster 객체를 직접 받아 SDRS 로 자동 배치.
   *
   * 요구: PowerShell 7+ 와 VMware.PowerCLI 모듈 사전 설치 (CLAUDE.md 참고)
   */
  async deployLibraryItemViaPowerCLI(opts: {
    libraryItemPath: string;
    vmName: string;
    datastoreOrCluster: string;
    resourcePool?: string;
    folder?: string;
    vmHost?: string;
  }): Promise<void> {
    const env = this.getEnv();
    const trimmed = opts.libraryItemPath.replace(/^\/+/, '');
    const segments = trimmed.split('/');
    if (segments.length < 2) {
      throw new Error(`Invalid library item path: "${opts.libraryItemPath}" (expected /<library>/<item>)`);
    }
    const libraryName = segments[0];
    const itemName = segments.slice(1).join('/');

    const vcenterHost = (env.GOVC_URL || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!vcenterHost) throw new Error('GOVC_URL is not set');

    const scriptPath = path.resolve(process.cwd(), 'scripts/vsphere/deploy-from-library.ps1');

    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-File', scriptPath,
      '-VCenterServer', vcenterHost,
      '-Username', env.GOVC_USERNAME,
      '-LibraryName', libraryName,
      '-ItemName', itemName,
      '-VMName', opts.vmName,
      '-DatastoreName', opts.datastoreOrCluster,
    ];
    if (opts.resourcePool) args.push('-ResourcePoolName', opts.resourcePool);
    if (opts.folder) args.push('-FolderName', opts.folder);
    if (opts.vmHost) args.push('-VMHostName', opts.vmHost);

    console.log(`[pwsh] Deploying library item "${opts.libraryItemPath}" → "${opts.vmName}" via PowerCLI, ds=${opts.datastoreOrCluster}`);
    try {
      const { stdout, stderr } = await execFilePromise('pwsh', args, {
        env: { ...process.env, VCENTER_PASSWORD: env.GOVC_PASSWORD },
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stdout?.trim()) console.log(`[pwsh] ${stdout.trim()}`);
      if (stderr?.trim()) console.warn(`[pwsh stderr] ${stderr.trim()}`);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new Error(
          'pwsh(PowerShell) 실행 파일을 찾을 수 없습니다. PowerShell 7+ 와 VMware.PowerCLI 모듈을 설치하세요. ' +
          'Ubuntu: https://learn.microsoft.com/powershell/scripting/install/install-ubuntu  ' +
          '설치 후: pwsh -c "Install-Module VMware.PowerCLI -Scope CurrentUser -Force"'
        );
      }
      throw err;
    }
  },

  /**
   * vSphere HTML5 웹콘솔 URL 발급. 단명 sessionTicket 이 포함되어
   * 학생이 vCenter 계정 없이도 새 탭에서 콘솔 접근 가능.
   * 요구: vCenter Standard 이상 라이선스. govc 0.30+.
   */
  async getConsoleUrl(name: string): Promise<string> {
    const env = this.getEnv();
    const { stdout } = await execPromise(`govc vm.console -h5 "${name}"`, { env });
    const url = stdout.trim();
    if (!url || !url.startsWith('http')) {
      throw new Error(`Unexpected console URL output: ${stdout}`);
    }
    return url;
  },

  /**
   * VM 파괴 (디스크 포함). vm.destroy 는 Destroy_Task 를 수행하여
   * VM 폴더의 vmdk/nvram/vmx 파일을 함께 제거함.
   * cloud-init ISO 가 별도 데이터스토어에 업로드된 경우 추가 정리.
   */
  async destroyVm(name: string): Promise<void> {
    const env = this.getEnv();
    // 1) 켜져 있으면 강제 종료. 이미 꺼져 있어도 진행.
    await execPromise(`govc vm.power -off -force "${name}"`, { env }).catch(() => {});
    // 2) VM 파괴 (vmdk 함께 정리)
    await execPromise(`govc vm.destroy "${name}"`, { env });
    // 3) cloud-init ISO 잔여물 정리 (없으면 무시)
    const isoDs = process.env.GOVC_ISO_DATASTORE
      || process.env.CLOUD_IMAGE_DATASTORE
      || 'SSD-DATASTORE-01';
    await execPromise(
      `govc datastore.rm -ds="${isoDs}" "cloud-init/${name}.iso"`,
      { env }
    ).catch(() => {});
  },

  /**
   * Content Library 목록 조회 — `govc library.ls -json /`
   */
  async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]> {
    const env = this.getEnv();
    const { stdout } = await execPromise(`govc library.ls -json /`, { env });
    if (!stdout.trim()) return [];
    const raw = JSON.parse(stdout);
    const libs: any[] = Array.isArray(raw)
      ? raw
      : (raw.library ?? raw.Library ?? raw.libraries ?? []);
    return libs
      .map((lib: any) => {
        if (typeof lib === 'string') {
          const name = lib.replace(/^\//, '');
          return { id: name, name, type: 'local' };
        }
        return {
          id: lib.id ?? lib.ID ?? lib.name ?? lib.Name ?? '',
          name: lib.name ?? lib.Name ?? '',
          type: lib.type ?? lib.Type ?? 'local',
        };
      })
      .filter(l => l.name);
  },

  /**
   * Content Library 내 이미지(OVA/OVF) 목록 조회.
   * @param libraryPath - 특정 라이브러리 경로(예: "/MyLib"). "/" 또는 미지정 시 모든 라이브러리 순회.
   *                      미지정 시 CONTENT_LIBRARY_PATH 환경변수 사용.
   */
  async listCloudImages(libraryPath = process.env.CONTENT_LIBRARY_PATH || '/'): Promise<CloudImage[]> {
    const env = this.getEnv();
    const trimmed = libraryPath.replace(/\/+$/, '');

    const itemsAt = async (libPath: string): Promise<CloudImage[]> => {
      // 끝에 슬래시를 붙이면 govc 가 라이브러리 내 항목을 반환
      const { stdout } = await execPromise(`govc library.ls -json "${libPath}/"`, { env });
      if (!stdout.trim()) return [];
      const raw = JSON.parse(stdout);
      const items: any[] = Array.isArray(raw)
        ? raw
        : (raw.item ?? raw.Item ?? raw.items ?? []);
      return items.map((item: any) => {
        const size = Number(item.size ?? item.Size ?? item.FileSize ?? 0);
        const name = item.name ?? item.Name ?? 'Unknown';
        return {
          id: item.id ?? item.ID ?? name,
          name,
          description: item.description ?? item.Description ?? '',
          type: this.detectImageType(name),
          size,
          size_gb: Math.round(size / (1024 ** 3) * 100) / 100,
          library_path: `${libPath}/${name}`,
          created_time: item.creation_time ?? item.CreationTime ?? new Date().toISOString(),
          updated_time: item.last_modified_time ?? item.LastModifiedTime ?? item.CreationTime ?? new Date().toISOString(),
          tags: [],
        };
      });
    };

    // 특정 라이브러리 경로
    if (trimmed) {
      return itemsAt(trimmed);
    }

    // 루트: 모든 라이브러리에서 항목 수집
    const libs = await this.listContentLibraries();
    const all: CloudImage[] = [];
    for (const lib of libs) {
      const libPath = `/${lib.name}`;
      try {
        const items = await itemsAt(libPath);
        all.push(...items);
      } catch (err) {
        console.warn(`[infrastructure] Failed to list items in ${libPath}:`, err);
      }
    }
    return all;
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

  async destroyVm(_name: string): Promise<void> {
    throw new Error('destroyVm not implemented for REST strategy');
  },

  async getConsoleUrl(_name: string): Promise<string> {
    throw new Error('getConsoleUrl not implemented for REST strategy');
  },

  async deployLibraryItemViaPowerCLI(_opts: any): Promise<void> {
    throw new Error('deployLibraryItemViaPowerCLI not implemented for REST strategy');
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

  async listDatastoreImages(): Promise<{ name: string; path: string; size_gb: number }[]> {
    return [];
  },

  async listHosts(): Promise<HostInfo[]> {
    return [];
  },

  async selectBestHost(): Promise<string> {
    return '';
  },

  async ensureOvaTemplate(ovaFileName: string): Promise<string> {
    return ovaFileName;
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

  async destroyVm(name: string) {
    return await this.strategy.destroyVm(name);
  },

  async getConsoleUrl(name: string): Promise<string> {
    return await this.strategy.getConsoleUrl(name);
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
  async createCloudInitIso(vmName: string, sshKey?: string, password?: string): Promise<string> {
    return await this.strategy.createCloudInitIso(vmName, sshKey, password);
  },

  async injectCloudInitViaExtraConfig(vmName: string, sshKey?: string, password?: string): Promise<void> {
    return await this.strategy.injectCloudInitViaExtraConfig(vmName, sshKey, password);
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
  },

  // 데이터스토어 이미지 관련
  async listDatastoreImages(): Promise<{ name: string; path: string; size_gb: number }[]> {
    return await this.strategy.listDatastoreImages();
  },

  async listHosts(): Promise<HostInfo[]> {
    return await this.strategy.listHosts();
  },

  async selectBestHost(): Promise<string> {
    return await this.strategy.selectBestHost();
  },
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
    return {
      'Content-Type': 'application/json',
      'x-api-key': process.env.PFSENSE_API_KEY || '',
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

  async applyFirewall(): Promise<void> {
    await this.fetchWithTls(`${this.getUrl()}/api/v2/firewall/apply`, { method: 'POST', body: '{}' });
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
        source_port: null,
        destination: 'wan:ip',
        destination_port: String(params.externalPort),
        target: params.internalIp,
        local_port: String(params.internalPort),
        descr: params.description || `Forward ${params.internalIp}:${params.internalPort}`,
        associated_rule_id: 'pass',
      }),
    });
    const json = await res.json() as any;
    if (json.code !== 200) throw new Error('pfSense NAT rule creation failed');

    await this.applyFirewall();

    return {
      tracker: String(json.data.id),
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
      `${this.getUrl()}/api/v2/firewall/nat/port_forward?id=${encodeURIComponent(id)}&apply=true`,
      { method: 'DELETE' }
    );
    const json = await res.json() as any;
    if (json.code !== 200) throw new Error('pfSense NAT rule deletion failed');
  },
};

