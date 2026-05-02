# 업데이트 내역

## 개요

이번 업데이트에서는 고급 govc 프로비저닝 로직을 구현하고, Content Library 통합, 자동 데이터스토어 선택, Cloud-init 지원 등 여러 기능을 추가했습니다.

---

## 1. 확장된 인프라 타입 정의

### 파일: `src/lib/infrastructure.ts`

새로운 인터페이스 추가:

```typescript
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
```

---

## 2. govcStrategy 의 새로운 메서드

### 2.1 자동 데이터스토어 선택

```typescript
async selectBestDatastore(prefix = 'ds-', minFreeGb = 20): Promise<string>
```

- **기능**: 사용 가능한 여유 공간 기반으로 최적의 데이터스토어 자동 선택
- **파라미터**:
  - `prefix`: 데이터스토어 이름 접두사 (기본값: 'ds-')
  - `minFreeGb`: 최소 여유 공간 (기본값: 20GB)
- **반환**: 선택된 데이터스토어 이름
- **예외**: 적합한 데이터스토어가 없으면 에러 발생

### 2.2 데이터스토어 목록 조회

```typescript
async listDatastores(): Promise<DatastoreInfo[]>
```

- **기능**: 모든 데이터스토어의 상세 정보 조회 (사용률 기반 정렬)
- **반환**: 각 데이터스토어의 용량, 여유 공간, 사용률, 타입 정보

### 2.3 Cloud-init ISO 자동 생성

```typescript
async createCloudInitIso(vmName: string, sshKey: string): Promise<string>
```

- **기능**: Cloud-init ISO 자동 생성 (genisoimage/mkisofs 필요)
- **파라미터**:
  - `vmName`: VM 이름 (인스턴스 ID 로 사용)
  - `sshKey`: SSH 공개키
- **반환**: 생성된 ISO 파일의 로컬 경로
- **내용**:
  - user-data: Ubuntu 사용자 생성, SSH 키 설정
  - meta-data: 인스턴스 ID 와 호스트명
  - network-config: DHCP 네트워킹

### 2.4 ExtraConfig 방식 Cloud-init 인젝션

```typescript
async injectCloudInitViaExtraConfig(vmName: string, sshKey: string): Promise<void>
```

- **기능**: ISO 없이 VM ExtraConfig 를 통한 경량 Cloud-init 인젝션
- **방식**: `guestinfo.userdata` 및 `guestinfo.metadata` 속성 사용
- **장점**: ISO 생성 없이 경량화 가능

### 2.5 Content Library 목록 조회

```typescript
async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]>
```

- **기능**: 모든 Content Library 목록 조회
- **명령어**: `govc about.library.ls -json`

### 2.6 Cloud Image (OVA/OVF) 목록 조회

```typescript
async listCloudImages(libraryPath = '/'): Promise<CloudImage[]>
```

- **기능**: Content Library 내 이미지 (OVA/OVF) 목록 조회
- **파라미터**:
  - `libraryPath`: Library 경로 (기본: "/")
- **명령어**: `govc about.library.item.ls -json`

### 2.7 이미지 타입 감지

```typescript
detectImageType(name: string): 'ova' | 'ovf' | 'appliance'
```

- **기능**: 파일명 기반으로 이미지 타입 감지
- **로직**:
  - `.ova` 확장자 → 'ova'
  - `.ovf` 확장자 → 'ovf'
  - 기타 → 'appliance'

### 2.8 Library 에서 배포

```typescript
async deployFromLibrary(imageName: string, vmName: string, libraryPath = '/'): Promise<void>
```

- **기능**: Content Library 이미지를 템플릿으로 클론 (Library Item 배포)
- **명령어**: `govc library.deploy`

---

## 3. 통합 ESXi 클라이언트 확장

### 파일: `src/lib/infrastructure.ts`

`esxiClient` 에 새로운 메서드 추가:

```typescript
export const esxiClient = {
  // 기존 메서드...
  
  // Datastore 관련
  async selectBestDatastore(prefix = 'ds-', minFreeGb = 20): Promise<string>,
  async listDatastores(): Promise<DatastoreInfo[]>,

  // Cloud-init 관련
  async createCloudInitIso(vmName: string, sshKey: string): Promise<string>,
  async injectCloudInitViaExtraConfig(vmName: string, sshKey: string): Promise<void>,

  // Content Library 관련
  async listContentLibraries(): Promise<{ id: string; name: string; type: string; }[]>,
  async listCloudImages(libraryPath = '/'): Promise<CloudImage[]>,
  detectImageType(name: string): 'ova' | 'ovf' | 'appliance',
  async deployFromLibrary(imageName: string, vmName: string, libraryPath = '/'): Promise<void>
};
```

---

## 4. 새로운 서비스: imageService

### 파일: `src/services/imageService.ts`

클라우드 이미지 (OVA/OVF) 관리를 위한 전용 서비스:

```typescript
export const imageService = {
  /**
   * Content Library 목록 조회
   */
  async listLibraries()

  /**
   * Cloud Image (OVA/OVF) 목록 조회
   * @param libraryPath - Library 경로 (기본: "/")
   */
  async listImages(libraryPath = '/')

  /**
   * 특정 Library 의 이미지 목록 조회
   */
  async getImagesByLibrary(libraryName: string)

  /**
   * 이미지 상세 정보 조회
   */
  async getImageDetails(imageName: string, libraryPath = '/')

  /**
   * 이미지 타입 감지 (OVA, OVF, Appliance)
   */
  detectImageType(name: string)
};
```

---

## 5. 새로운 API 엔드포인트

### 5.1 이미지 API

#### 엔드포인트: `GET /api/images`

Cloud Image (OVA/OVF) 목록 조회

**쿼리 파라미터:**
- `library`: Library 이름 (선택) - 특정 Library 의 이미지 조회
- `path`: Library 경로 (선택, 기본: "/")
- `libraries`: `true` 로 설정 시 Library 목록 조회

**응답 예시:**

```json
{
  "success": true,
  "data": [
    {
      "id": "5a1b2c3d-4e5f-6789-abc1-def234567890",
      "name": "ubuntu-24.04-server.ova",
      "description": "Ubuntu 24.04 LTS Server Image",
      "type": "ova",
      "size": 2147483648,
      "size_gb": 2.0,
      "created_time": "2024-01-15T10:30:00.000Z",
      "updated_time": "2024-01-15T10:30:00.000Z",
      "tags": ["ubuntu", "linux", "server"]
    }
  ],
  "count": 1,
  "type": "images"
}
```

**Library 목록 조회:**

```bash
GET /api/images?libraries=true
```

```json
{
  "success": true,
  "data": [
    {
      "id": "Library-S-ESXi-12345",
      "name": "Ubuntu Images",
      "type": "local"
    }
  ],
  "type": "libraries"
}
```

### 5.2 데이터스토어 API

#### 엔드포인트: `GET /api/datastores`

데이터스토어 목록 조회

**응답 예시:**

```json
{
  "success": true,
  "data": [
    {
      "name": "ds-001",
      "capacity_gb": 500.0,
      "free_gb": 350.0,
      "usage_percent": 30.0,
      "type": "vmfs"
    },
    {
      "name": "ds-002",
      "capacity_gb": 1000.0,
      "free_gb": 200.0,
      "usage_percent": 80.0,
      "type": "vmfs"
    }
  ],
  "count": 2
}
```

---

## 6. 확장된 VM 생성

### 6.1 `VmCreateParams` 인터페이스 확장

```typescript
interface VmCreateParams {
  name: string;
  template: string;
  vcpu: number;
  ram_gb: number;
  ssh_public_key?: string;  // ✅ 추가: Cloud-init 을 위한 SSH 공개키
  iso_path?: string;        // ✅ 추가: 외부에서 제공하거나 내부에서 생성
  network?: string;
  folder?: string;
  resource_pool?: string;
}
```

### 6.2 사용 예시

```typescript
await esxiClient.createVmFromTemplate({
  name: 'my-vm',
  template: 'ubuntu-24.04',
  vcpu: 2,
  ram_gb: 4,
  ssh_public_key: 'ssh-rsa AAAA...', // Cloud-init 지원
});
```

### 6.3 프로비저닝 흐름

1. **데이터스토어 자동 선택**: `selectBestDatastore()` 호출
2. **Cloud-init ISO 생성**: SSH 키가 제공된 경우 `createCloudInitIso()` 호출
3. **VM Clone**: 템플릿에서 VM 클론
4. **리소스 및 네트워크 업데이트**: vCPU, RAM, 네트워크 설정
5. **Cloud-init ISO 삽입**: ISO 를 CD-ROM 에 마운트
6. **Power On**: VM 시작
7. **IP 대기**: `govc vm.ip -wait=5m` 로 IP 주소 대기
8. **정보 조회**: VM 상세 정보 및 UUID, Moref 조회

### 6.4 에러 처리 및 롤백

프로비저닝 실패 시 자동으로:

1. 생성된 VM 파괴 (롤백)
2. 임시 ISO 파일 삭제

---

## 7. 추가된 파일

| 파일 경로 | 설명 |
|-----------|------|
| `src/services/imageService.ts` | 클라우드 이미지 관리 서비스 |
| `src/app/api/images/route.ts` | 이미지 API 엔드포인트 |
| `src/app/api/datastores/route.ts` | 데이터스토어 API 엔드포인트 |

---

## 8. 수정된 파일

| 파일 경로 | 수정 내용 |
|-----------|-----------|
| `src/lib/infrastructure.ts` | 타입 확장, govcStrategy 메서드 추가, esxiClient 확장 |
| `src/services/vmService.ts` | `ssh_public_key` 파라미터 전달, `updateVmStatus` 메서드 추가 |

---

## 9. 환경 변수

### 기존 환경 변수

```bash
GOVC_URL=         # ESXi 서버 주소
GOVC_USERNAME=    # ESXi 사용자명
GOVC_PASSWORD=    # ESXi 비밀번호
GOVC_INSECURE=1   # TLS 인증 무시 (1 또는 0)
GOVC_DATASTORE=   # 기본 데이터스토어 (선택)
GOVC_NETWORK=     # 기본 네트워크 (기본: "Internal-VNIC")
GOVC_RESOURCE_POOL= # 리소스 풀 (선택)
GOVC_FOLDER=      # 폴더 (선택)
GOVC_DATACENTER=/ # 데이터센터 (기본: "/")
```

### 새로운 환경 변수

```bash
DATASTORE_PREFIX=ds-    # 데이터스토어 선택 시 사용할 접두사 (기본: "ds-")
ESXI_MODE=govc          # ESXi 연결 모드: "govc" 또는 "rest" (기본: "govc")
```

---

## 10. 시스템 요구사항

### Cloud-init ISO 생성을 위한 추가 의존성

```bash
# Ubuntu/Debian
sudo apt-get install genisoimage

# 또는
sudo apt-get install mkisofs
```

---

## 11. 주의사항

1. **govc 명령어 설치 필요**: 모든 govc 기반 기능은 `govc` CLI 가 시스템 PATH 에 등록되어 있어야 합니다.

2. **Content Library 접근 권한**: Library 조회 및 배포를 위해 ESXi 사용자는 Content Library에 대한 읽기 및 배포 권한이 필요합니다.

3. **데이터스토어 선택 로직**: `selectBestDatastore()` 는 여유 공간이 가장 많은 데이터스토어를 선택합니다. 필요시 커스터마이징 가능합니다.

4. **Cloud-init 지원 OS**: Cloud-init 이 지원되는 OS 템플릿 (Ubuntu, CentOS, Debian 등) 을 사용해야 합니다.

5. **ISO 업로드**: 현재 구현에서는 로컬 ISO 를 데이터스토어로 업로드한 후 마운트합니다. 대용량 ISO 의 경우 업로드 시간이 소요될 수 있습니다.

---

## 12. 테스트 방법

### 데이터스토어 목록 조회 테스트

```bash
curl http://localhost:3000/api/datastores
```

### Library 목록 조회 테스트

```bash
curl "http://localhost:3000/api/images?libraries=true"
```

### 이미지 목록 조회 테스트

```bash
# 모든 이미지 조회
curl http://localhost:3000/api/images

# 특정 Library 의 이미지 조회
curl "http://localhost:3000/api/images?library=Ubuntu%20Images"
```

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-05-02 | 고급 govc 프로비저닝 로직 구현, Content Library 통합, 자동 데이터스토어 선택, Cloud-init 지원 추가 |
