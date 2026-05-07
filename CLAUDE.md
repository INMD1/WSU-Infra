# WSU-Infra

vSphere/ESXi 기반 VM 셀프서비스 포털. 사용자가 VM을 요청하면 Job Queue를 통해 비동기로 프로비저닝.

## 기술 스택

- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **DB**: MySQL + Drizzle ORM (`src/db/schema.ts`)
- **VM 제어**: govc CLI (`ESXI_MODE=govc`, 기본값) 또는 REST (`ESXI_MODE=rest`)
- **인증**: JWT (access + refresh token)
- **쿼터**: 유저별 독립 할당량 (vCPU, RAM, 디스크, 포트포워딩)

## 주요 명령어

```bash
npm run dev          # 개발 서버
npm run build        # 프로덕션 빌드
npm run db:push      # DB 스키마 동기화
npm run db:studio    # Drizzle Studio UI
```

## 아키텍처

```
POST /api/vms
  → vmService.createVm()
  → jobQueue.add()           # 즉시 반환, jobId(UUID) 지급
  → 비동기 processVmCreateJob()
      → esxiClient.createVmFromTemplate()  # govc clone + power on + IP 대기
      → db.insert(vms)

GET /api/jobs/[jobId]        # 폴링으로 완료 여부 확인
GET /api/vms                 # 완료된 VM 목록
```

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/queue.ts` | JobQueue 클래스 — 동시성 제어 (기본 3개 병렬) |
| `src/lib/infrastructure.ts` | govc/REST 전략 패턴, esxiClient |
| `src/services/vmService.ts` | VM CRUD + 큐 연결 |
| `src/db/schema.ts` | users, vms, quotas 테이블 |
| `src/lib/auth.ts` | JWT 발급/검증 |

## JobQueue 동작 원리

- `add()` → 슬롯이 비어있으면 `process()`가 즉시 `runJob()`을 fire-and-forget으로 실행
- 최대 `maxConcurrent`(기본 3)개 병렬 실행
- 각 job 완료 시 `finally`에서 다시 `process()` 호출 → 대기 중인 job 즉시 시작
- `add()`가 반환하는 `job.id`(UUID)가 클라이언트에 전달되는 유일한 ID

## 필수 환경변수

```env
# DB
DATABASE_URL=mysql://user:pass@host:3306/db

# ESXi / govc
GOVC_URL=https://vcenter.host
GOVC_USERNAME=admin
GOVC_PASSWORD=secret
GOVC_INSECURE=1
GOVC_NETWORK=Internal-VNIC
GOVC_RESOURCE_POOL=
GOVC_FOLDER=
GOVC_DATACENTER=/
DATASTORE_PREFIX=ds-          # 자동 선택할 배포 데이터스토어 접두사 (비워두면 모든 DS 대상)
CLOUD_IMAGE_DATASTORE=SSD-DATASTORE-01   # OVA 이미지가 저장된 데이터스토어
CLOUD_IMAGE_PATH=Cloud-image             # 해당 데이터스토어 내 OVA 폴더 경로

# pfSense (포트 포워딩)
PFSENSE_URL=https://pfsense.host
PFSENSE_INSECURE=false

# 관리자 계정 (학생 계정은 DB에서 관리)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password_here

# JWT
JWT_SECRET=your_secret_here

# 전략 선택 (생략 시 govc)
ESXI_MODE=govc
```

## VM 생성 흐름 (govc 전략)

1. 데이터스토어 자동 선택 (여유 공간 기준 정렬)
2. SSH 키 있으면 Cloud-init ISO 생성 → 데이터스토어 업로드
3. `govc vm.clone` (템플릿에서 복제)
4. `govc vm.change` (CPU/RAM 재설정)
5. 네트워크 포트그룹 연결
6. `govc vm.power -on` + IP 대기 (최대 5분)
7. DB 저장

실패 시 `govc vm.destroy`로 자동 롤백.

## 포트 포워딩 (pfSense API)

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/port-forwards` | 목록 조회 (internal/external IP·포트 포함) |
| POST | `/api/port-forwards` | 규칙 생성 |
| DELETE | `/api/port-forwards/[id]` | 규칙 삭제 (pfSense에서도 제거) |

### POST Body
```json
{
  "internal_ip": "192.168.1.100",
  "internal_port": 22,
  "external_port": 10022,   // 생략 시 자동 배정
  "protocol": "tcp",        // 기본 tcp
  "vm_id": "uuid",          // 선택
  "description": "SSH"
}
```

### 환경변수 추가
```env
PFSENSE_API_KEY=your_api_key       # x-api-key 헤더로 전송 (v2 KeyAuth)
PFSENSE_WAN_IP=1.2.3.4            # 외부 IP (응답에 표시)
PFSENSE_PORT_RANGE_START=10000    # 자동 배정 범위 시작 (기본 10000)
PFSENSE_PORT_RANGE_END=20000      # 자동 배정 범위 끝 (기본 20000)
```

### 할당량 체크
- `quotas.max_public_ports` (기본 10)까지만 생성 가능
- `GET /api/quotas`의 `usage.ports_used`에 실사용량 반영
- 초과 시 HTTP 403 반환

### pfSense API 호환성
pfSense-API **v2** 기준:
- `POST /api/v2/firewall/nat/port_forward`로 규칙 생성 → 응답의 `data.id`(정수)를 DB에 저장 (`pfsense_tracker` 컬럼)
- `DELETE /api/v2/firewall/nat/port_forward?id=<id>&apply=true`로 삭제 및 즉시 적용
- POST 후 별도로 `POST /api/v2/firewall/apply` 호출하여 변경사항 적용
- destination은 `wan:ip` (WAN 인터페이스 IP), source_port는 `null` (any)

## 알려진 제약

- govc CLI가 서버에 설치되어 있어야 함
- Cloud-init ISO 방식은 `genisoimage` 패키지 필요 (`injectCloudInitViaExtraConfig`로 대체 가능)
- jobQueue는 프로세스 내 메모리 저장 → 서버 재시작 시 pending 상태 jobs 소실

## 디자인 시스템 (Claude 스타일)

전체 UI는 `DESIGN.md` 기반 Claude 디자인 시스템을 따른다. GCP 스타일 클래스는 제거됨.

### 색상 토큰 (CSS 변수, Tailwind 유틸리티로 사용)
| 역할 | 클래스 | 값 |
|------|--------|-----|
| 배경(캔버스) | `bg-canvas` | #faf9f5 크림색 |
| 카드 배경 | `bg-surface-card` | #efe9de |
| 구분선 | `border-hairline` | #e6dfd8 |
| 주요 텍스트 | `text-ink` | #141413 |
| 보조 텍스트 | `text-muted` | #6c6a64 |
| 강조(코랄) | `bg-primary`, `text-primary` | #cc785c |
| 다크 서피스 | `bg-surface-dark` | #181715 |

### 컴포넌트 클래스 (globals.css 정의)
| 클래스 | 용도 |
|--------|------|
| `.btn-primary` | 주 CTA 버튼 (코랄) |
| `.btn-secondary` | 보조 버튼 (캔버스+테두리) |
| `.btn-ghost` | 텍스트형 버튼 |
| `.input` | 텍스트 입력 필드 |
| `.card` | 카드 컨테이너 (surface-card 배경) |
| `.progress-bar` / `.progress-fill` | 진행 바 |
| `.status-badge .status-running/stopped/pending/error` | VM 상태 배지 |
| `.alert-error/success/warning` | 피드백 알림 박스 |
| `.display-xl/lg/md/sm` | 헤딩 (Cormorant Garamond serif) |
| `.title-lg/md/sm` | 소제목 (Inter, weight 500) |

### 폰트
- **헤딩**: Cormorant Garamond (serif, weight 400, 네거티브 트래킹) — `font-display`
- **본문/UI**: Inter — `font-sans`
- **코드**: JetBrains Mono — `font-mono`

### 금지 사항
- `.card-gcp`, `.btn-gcp-*`, `.table-gcp`, `.progress-gcp*`, `.badge-gcp`, `.status-*-gcp` 클래스 사용 금지
- 하드코딩된 GCP 색상(`#202124`, `#5f6368`, `#1a73e8` 등) 사용 금지
- `style={{ color: '...' }}` 인라인 스타일 대신 Tailwind 토큰 클래스 사용

## 작업이 마무리 된후
만약 사용자가 종료 라고 입력은 한경우 오늘 이 세션에서 작업한 내용을
초중급 개발자가 이해하기 쉽게 정리를 해서 Update_Markdown 폴더에 새로운 파일로 MM-DD_HH:MM.md으로 저장해야함.