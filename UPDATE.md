# 업데이트 내역

## 개요

이번 업데이트에서는 고급 govc 프로비저닝 로직을 구현하고, Content Library 통합, 자동 데이터스토어 선택, Cloud-init 지원, **대기열 (Queue) 시스템** 등 여러 기능을 추가했습니다.

**대기열 시스템**은 여러 사용자가 동시에 VM 프로비저닝을 요청할 때 순차적으로 처리하고, 동시성을 제어하며, 상태를 추적할 수 있도록 합니다.

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

## 7. 대기열 (Queue) 시스템

### 7.1 개요

여러 사용자가 동시에 VM 프로비저닝을 요청할 수 있으므로, **대기열 시스템**을 도입하여 다음과 같은 기능을 제공합니다:

- **순차 처리**: 요청이 들어온 순서대로 처리
- **동시성 제어**: 최대 동시 작업 수 제한 (기본: 2 개)
- **우선순위**: 중요 요청 우선 처리
- **자동 재시도**: 실패 시 자동 재시도 (기본: 3 회)
- **시간 제한**: 각 작업에 시간 제한 적용 (기본: 5 분)
- **상태 추적**: Job 상태 실시간 조회

### 7.2 Job 인터페이스

```typescript
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number;  // 낮을수록 우선순위 높음
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
  retryCount: number;
  maxRetries: number;
  timeout?: number;  // ms 단위
}
```

### 7.3 JobQueue 클래스

```typescript
import { JobQueue, JobData } from '@/lib/queue';

const jobQueue = new JobQueue(maxConcurrent: number = 2);

// Job 추가
const job = jobQueue.add<VMCreateData>({
  type: 'vm-create',
  payload: { name: 'my-vm', ... },
  priority: 0,      // 낮을수록 우선
  timeout: 600000,  // 10 분
  maxRetries: 1,
});

// 상태 조회
const status = jobQueue.getStatus();
const pendingJobs = jobQueue.getPendingJobs();
const jobStatus = jobQueue.getJob(job.id);
```

### 7.4 대기열 상태

```typescript
export interface QueueStatus {
  pending: number;   // 대기 중인 Job 수
  running: number;   // 진행 중인 Job 수
  completed: number; // 완료된 Job 수
  failed: number;    // 실패한 Job 수
  total: number;     // 총 Job 수
}
```

### 7.5 상태 전이

```
[pending] ──▶ [running] ──▶ [completed]
     ▲           │
     │           └──▶ [failed] (재시도 가능)
     └────────────┘
```

---

## 8. 추가된 파일

| 파일 경로 | 설명 |
|-----------|------|
| `src/lib/queue.ts` | **대기열 시스템** |
| `src/services/imageService.ts` | 클라우드 이미지 관리 서비스 |
| `src/app/api/images/route.ts` | 이미지 API 엔드포인트 |
| `src/app/api/datastores/route.ts` | 데이터스토어 API 엔드포인트 |
| `src/app/api/jobs/route.ts` | **대기열 상태 조회 API** |
| `src/app/api/jobs/[id]/route.ts` | **개별 Job 상태 조회 API** |

---

## 8. 수정된 파일

| 파일 경로 | 수정 내용 |
|-----------|-----------|
| `src/lib/infrastructure.ts` | 타입 확장, govcStrategy 메서드 추가, esxiClient 확장 |
| `src/services/vmService.ts` | `ssh_public_key` 파라미터 전달, `updateVmStatus` 메서드 추가 |

---

## 9. 수정된 파일

| 파일 경로 | 수정 내용 |
|-----------|-----------|
| `src/lib/infrastructure.ts` | 타입 확장, govcStrategy 메서드 추가, esxiClient 확장 |
| `src/services/vmService.ts` | **대기열 시스템 통합**, `ssh_public_key` 파라미터 전달 |
| `src/app/api/vms/route.ts` | **대기열 기반 VM 생성** (비동기 처리) |

---

## 10. 대기열 관련 API 엔드포인트

### 10.1 대기열 상태 조회

#### 엔드포인트: `GET /api/jobs`

대기열 전체 상태 조회

**응답 예시:**

```json
{
  "pending": 3,
  "running": 2,
  "completed": 15,
  "failed": 1,
  "total": 21
}
```

**상세 정보 포함:**

```bash
GET /api/jobs?detail=true
```

```json
{
  "status": {
    "pending": 3,
    "running": 2,
    "completed": 15,
    "failed": 1,
    "total": 21
  },
  "pendingJobs": [
    {
      "jobId": "vm-create-1714684800000-abc123",
      "type": "vm-create",
      "status": "pending",
      "createdAt": "2026-05-02T10:00:00.000Z",
      "priority": 0
    }
  ]
}
```

### 10.2 개별 Job 상태 조회

#### 엔드포인트: `GET /api/jobs/[id]`

특정 Job 의 상세 상태 조회

**응답 예시:**

```json
{
  "success": true,
  "jobId": "vm-create-1714684800000-abc123",
  "type": "vm-create",
  "status": "running",
  "createdAt": "2026-05-02T10:00:00.000Z",
  "startedAt": "2026-05-02T10:02:00.000Z",
  "completedAt": null,
  "error": null,
  "result": null
}
```

**완료된 Job:**

```json
{
  "success": true,
  "jobId": "vm-create-1714684800000-abc123",
  "type": "vm-create",
  "status": "completed",
  "createdAt": "2026-05-02T10:00:00.000Z",
  "startedAt": "2026-05-02T10:02:00.000Z",
  "completedAt": "2026-05-02T10:05:00.000Z",
  "error": null,
  "result": {
    "success": true,
    "vm_id": "vm-123",
    "name": "my-vm",
    "message": "VM created successfully"
  }
}
```

---

## 11. 확장된 VM 생성 API

### 11.1 요청 방식 변경

기존 방식은 직접 VM 을 생성했으나, 새로운 방식은 **대기열에 Job 을 추가**하고 즉시 반환합니다.

**요청:**

```bash
POST /api/vms
Content-Type: application/json

{
  "name": "my-vm",
  "image_id": "ubuntu-24.04",
  "vcpu": 2,
  "ram_gb": 4,
  "ssh_public_key": "ssh-rsa AAAA...",
  "priority": 0  // 옵션: 낮을수록 우선 (기본: 0)
}
```

**응답 (202 Accepted):**

```json
{
  "success": true,
  "jobId": "vm-create-1714684800000-abc123",
  "message": "VM provisioning queued",
  "estimatedWaitSeconds": 120,
  "status": "queued"
}
```

### 11.2 상태 확인

```bash
# Job 상태 확인
GET /api/jobs/vm-create-1714684800000-abc123

# 대기열 전체 상태 확인
GET /api/jobs
```

### 11.3 프론트엔드 구현 예시

```typescript
// 1. VM 생성 요청
const response = await fetch('/api/vms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'my-vm',
    image_id: 'ubuntu-24.04',
    vcpu: 2,
    ram_gb: 4,
  }),
});

const { jobId, estimatedWaitSeconds } = await response.json();

// 2. 상태 대기 (Polling)
async function waitForJob(jobId: string) {
  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const status = await response.json();
    
    if (status.status === 'completed') {
      return status.result;
    }
    
    if (status.status === 'failed') {
      throw new Error(status.error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 초마다 확인
  }
}

const result = await waitForJob(jobId);
console.log('VM created:', result.vm_id);
```

---

## 12. 환경 변수

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
QUEUE_MAX_CONCURRENT=2  # 대기열 최대 동시 작업 수 (기본: 2)
```

---

## 13. 시스템 요구사항

### Cloud-init ISO 생성을 위한 추가 의존성

```bash
# Ubuntu/Debian
sudo apt-get install genisoimage

# 또는
sudo apt-get install mkisofs
```

### NPM 패키지

```bash
npm install uuid
npm install @types/uuid --save-dev
```

---

## 14. 주의사항

1. **govc 명령어 설치 필요**: 모든 govc 기반 기능은 `govc` CLI 가 시스템 PATH 에 등록되어 있어야 합니다.

2. **Content Library 접근 권한**: Library 조회 및 배포를 위해 ESXi 사용자는 Content Library에 대한 읽기 및 배포 권한이 필요합니다.

3. **데이터스토어 선택 로직**: `selectBestDatastore()` 는 여유 공간이 가장 많은 데이터스토어를 선택합니다. 필요시 커스터마이징 가능합니다.

4. **Cloud-init 지원 OS**: Cloud-init 이 지원되는 OS 템플릿 (Ubuntu, CentOS, Debian 등) 을 사용해야 합니다.

5. **ISO 업로드**: 현재 구현에서는 로컬 ISO 를 데이터스토어로 업로드한 후 마운트합니다. 대용량 ISO 의 경우 업로드 시간이 소요될 수 있습니다.

6. **대기열 동시성**: 기본값으로 최대 2 개 동시 작업이 가능합니다. `QUEUE_MAX_CONCURRENT` 환경 변수로 변경 가능합니다.

7. **Job 시간 제한**: 각 Job 에 기본 5 분의 시간 제한이 적용됩니다. 초과 시 자동으로 실패 처리됩니다.

8. **재시도 로직**: 실패한 Job 은 최대 3 회 자동 재시도됩니다.

9. **In-memory 대기열**: 현재 대기열은 In-memory 로 구현되어 있어 서버 재시작 시 상태가 초기화됩니다. 영속성이 필요한 경우 Redis 등의 외부 저장소로 확장 가능합니다.

---

## 15. 테스트 방법

### 대기열 상태 조회 테스트

```bash
# 기본 상태 조회
curl http://localhost:3000/api/jobs

# 상세 정보 포함
curl "http://localhost:3000/api/jobs?detail=true"
```

### VM 생성 (대기열) 테스트

```bash
# 1. VM 생성 요청
curl -X POST http://localhost:3000/api/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-vm-001",
    "image_id": "ubuntu-24.04",
    "vcpu": 2,
    "ram_gb": 4,
    "ssh_public_key": "ssh-rsa AAAA..."
  }'

# 응답 예시:
# {
#   "success": true,
#   "jobId": "vm-create-1714684800000-abc123",
#   "message": "VM provisioning queued",
#   "estimatedWaitSeconds": 0,
#   "status": "queued"
# }

# 2. Job 상태 확인 (반복)
curl http://localhost:3000/api/jobs/vm-create-1714684800000-abc123
```

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
| 2026-05-02 | 고급 govc 프로비저닝 로직 구현, Content Library 통합, 자동 데이터스토어 선택, Cloud-init 지원, **대기열 시스템** 추가 |
| 2026-05-03 | 동시 VM 생성 버그 수정, pfSense 포트 포워딩, 보안 강화, StoragePod 지원, Cloud-init 개선 |

---

## [2026-05-03] 주요 변경사항

---

### A. 동시 VM 생성 버그 수정

#### A-1. JobQueue 직렬 실행 버그 (`src/lib/queue.ts`)

**문제**: `process()` 내부에서 `await`을 사용해 실제로는 순차 실행이었음

**수정**: `process()`를 동기 함수로 변경, `runJob()`을 fire-and-forget으로 분리

```
기존: while 루프에서 각 job await → 완료 후 다음 시작 (직렬)
수정: process()로 빈 슬롯 채우기 → 각 job이 독립 실행 → 완료 시 process() 재호출
```

- `maxConcurrent` 기본값 2 → 3으로 상향

#### A-2. Job ID 불일치 버그 (`src/services/vmService.ts`)

**문제**: `createVm()`이 자체 생성한 `jobId`를 반환하고, 큐는 별도 UUID를 사용해 `GET /api/jobs/[id]`가 항상 404 반환

**수정**: `jobQueue.add()` 반환값의 `job.id`를 그대로 클라이언트에 전달

#### A-3. 중복 Datastore 선택 제거 (`src/lib/infrastructure.ts`, `src/services/vmService.ts`)

**문제**: `processVmCreateJob`에서 `selectBestDatastore` 호출 후, `govcStrategy.createVm` 내부에서도 재호출하고 `params.datastore`를 무시함

**수정**:
- `govcStrategy.createVm`이 `params.datastore` 우선 사용
- `processVmCreateJob`의 중복 호출 제거

---

### B. pfSense 포트 포워딩

#### B-1. DB 스키마 (`src/db/schema.ts`)

`port_forwards` 테이블 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `tenant_id` | varchar | 할당량 기준 |
| `protocol` | varchar | tcp / udp / tcp/udp |
| `internal_ip` | varchar | 포워딩 대상 내부 IP |
| `internal_port` | int | 포워딩 대상 내부 포트 |
| `external_ip` | varchar | WAN IP |
| `external_port` | int UNIQUE | 외부 포트 (자동 배정 또는 지정) |
| `pfsense_tracker` | varchar | pfSense 내부 rule ID (삭제 시 사용) |

#### B-2. pfSense API 클라이언트 (`src/lib/infrastructure.ts`)

pfSense REST API v2 기준 실제 구현:

```
GET  /api/v2/firewall/nat/port_forwards     — 규칙 목록
POST /api/v2/firewall/nat/port_forward      — 규칙 생성
DEL  /api/v2/firewall/nat/port_forward?id=  — 규칙 삭제
```

인증: `Authorization: <PFSENSE_API_CLIENT_ID> <PFSENSE_API_KEY>`

#### B-3. 포트 포워딩 서비스 (`src/services/portForwardService.ts`)

- 외부 포트 자동 배정 (`PFSENSE_PORT_RANGE_START`~`PFSENSE_PORT_RANGE_END`, 기본 10000~20000)
- 할당량 체크 (`quotas.max_public_ports`)
- pfSense 생성 실패 시 DB 롤백, DB 실패 시 pfSense 규칙 롤백

#### B-4. API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/port-forwards` | 목록 (internal/external IP·포트 포함) |
| POST | `/api/port-forwards` | 생성 |
| DELETE | `/api/port-forwards/[id]` | 삭제 (pfSense 동기 제거) |

**POST 요청 예시:**
```json
{
  "internal_ip": "192.168.1.100",
  "internal_port": 22,
  "external_port": 10022,
  "protocol": "tcp",
  "description": "SSH"
}
```
`external_port` 생략 시 자동 배정.

#### B-5. 쿼터 서비스 연동 (`src/services/quotaService.ts`)

`GET /api/quotas` 응답의 `usage.ports_used`가 실제 DB 카운트로 반영됨:
```json
{
  "usage": { "ports_used": 3 },
  "remaining": { "ports": 7 }
}
```

#### B-6. 필요 환경변수

```env
PFSENSE_API_KEY=your-api-key
PFSENSE_API_CLIENT_ID=client-id        # 선택 (v1 인증 방식)
PFSENSE_WAN_IP=1.2.3.4
PFSENSE_PORT_RANGE_START=10000
PFSENSE_PORT_RANGE_END=20000
```

---

### C. 보안 강화

#### C-1. JWT 인증 미들웨어 (`src/lib/apiAuth.ts` 신규)

모든 포트 포워딩 엔드포인트에 JWT 검증 추가.  
`Authorization: Bearer <token>` 헤더 없으면 401 반환.

```typescript
const auth = requireAuth(request);
if (auth instanceof NextResponse) return auth;
```

`GET /api/vms`, `POST /api/vms`에도 인증 추가.

#### C-2. TLS 전역 오염 수정 (`pfsenseClient.fetchWithTls`)

**문제**: `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` 영구 설정 → 프로세스 전체 HTTPS 검증 비활성화

**수정**: 요청 전 저장, `finally`에서 원래 값 복원 (스코프 한정)

#### C-3. 입력값 검증 (`ValidationError` 클래스)

| 항목 | 규칙 |
|------|------|
| `internal_ip` | RFC 1918 사설 IP만 허용 (SSRF 방지) |
| `internal_port` | 1~65535 정수 |
| `protocol` | tcp / udp / tcp/udp 만 허용 |
| `description` | 255자 이하 |
| `password` | 8~72자 |

#### C-4. 에러 메시지 sanitization

pfSense/govc 내부 오류는 서버 로그에만 기록, 클라이언트에는 일반 메시지만 반환.  
`ValidationError`만 구체적 메시지 전달.

#### C-5. Race condition 방어

pfSense 규칙 생성 후 DB 중복 키(`ER_DUP_ENTRY`) 시 pfSense 규칙 자동 롤백.

---

### D. StoragePod (Datastore Cluster) 지원

#### D-1. `selectBestDatastore` 개선

`GOVC_DATASTORE` 설정 시 govc 네트워크 호출 없이 즉시 반환.  
govc `vm.clone`은 StoragePod 이름을 받으면 Storage DRS가 물리 배치 자동 결정.

#### D-2. `listDatastores` StoragePod 지원

`GOVC_DATASTORE` 설정 시 `govc datastore.cluster.info -json`으로 StoragePod 용량 조회.  
기존 `govc datastore.info`는 StoragePod를 인식하지 못해 빈 목록 반환 문제 해결.

#### D-3. ISO 업로드 분리 (`GOVC_ISO_DATASTORE`)

StoragePod는 `govc datastore.upload` 대상 불가.  
ISO 업로드 전용 DS를 `GOVC_ISO_DATASTORE`로 분리, 미설정 시 `GOVC_DATASTORE` 사용.

```env
GOVC_DATASTORE=DEFAULT-VM-DATASTORE-PROXY   # StoragePod 이름
GOVC_ISO_DATASTORE=ds-node1                 # ISO 업로드용 개별 DS (CLOUD_INIT_METHOD=iso 시만 필요)
```

---

### E. Cloud-init 개선

#### E-1. 버그 수정

| 항목 | 기존 | 수정 |
|------|------|------|
| govc 명령어 | `govc vm.update` (존재하지 않음) | `govc vm.change` |
| user-data 포맷 | JSON 직렬화 | `#cloud-config` YAML |

#### E-2. 비밀번호 지원

`POST /api/vms`에 `password` 필드 추가.  
cloud-config의 `chpasswd` 모듈로 처리 (cloud-init이 내부 해싱):

```yaml
ssh_pwauth: true
chpasswd:
  expire: false
  list: |
    ubuntu:<password>
```

#### E-3. apt 미러 설정

`CLOUD_INIT_APT_MIRROR` 환경변수로 apt 미러 주입:

```yaml
apt:
  primary:
    - arches: [default]
      uri: http://mirror.example.com/ubuntu
  security:
    - arches: [default]
      uri: http://mirror.example.com/ubuntu
```

#### E-4. ExtraConfig 기본값 변경

```
기존: ssh_public_key 있으면 → ISO (genisoimage 필요, StoragePod 호환 안됨)
수정: 항상 ExtraConfig 기본 → CLOUD_INIT_METHOD=iso 설정 시에만 ISO
```

#### E-5. `buildCloudInitUserData()` 공유 헬퍼

ISO/ExtraConfig 양쪽에서 동일한 YAML 생성 함수 공유.  
비밀번호, SSH 키, apt 미러 모두 한 곳에서 관리.

```env
CLOUD_INIT_METHOD=extraconfig       # extraconfig(기본) | iso
CLOUD_INIT_APT_MIRROR=http://mirror.example.com/ubuntu
```

---

### F. 추가/수정 파일 목록

| 파일 | 변경 |
|------|------|
| `src/lib/queue.ts` | 진정한 병렬 처리 구현 (process/runJob 분리) |
| `src/lib/infrastructure.ts` | StoragePod 지원, Cloud-init 전면 개선, pfSense 실구현, TLS 수정 |
| `src/lib/apiAuth.ts` | **신규** — JWT 인증 헬퍼 |
| `src/lib/types.ts` | `PortForward` 타입 추가 |
| `src/db/schema.ts` | `port_forwards` 테이블 추가 |
| `src/services/vmService.ts` | Job ID 수정, password 전달, 중복 DS 선택 제거 |
| `src/services/portForwardService.ts` | **신규** — 포트 포워딩 서비스 |
| `src/services/quotaService.ts` | `ports_used` 실DB 카운트 연동 |
| `src/app/api/vms/route.ts` | JWT 인증, password 검증 추가 |
| `src/app/api/port-forwards/route.ts` | **신규** |
| `src/app/api/port-forwards/[id]/route.ts` | **신규** |
| `.env.example` | pfSense, Cloud-init, StoragePod 관련 변수 추가 |
| `CLAUDE.md` | **신규** — 코드베이스 문서화 |
