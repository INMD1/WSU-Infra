# WSU Server

회원가입 없이 **서버 이름만으로** Proxmox VM을 빌려 쓰는 PHP 웹 애플리케이션입니다.

- 이름을 입력하면 관리자가 지정한 템플릿으로 VM이 복제·부팅됩니다.
- 기본 대여 시간(24시간)이 지나면 VM과 디스크가 자동으로 삭제됩니다.
- 서버 이름이나 링크(`/vm.php?name=…`)를 아는 사람은 누구나 대시보드에 들어갈 수 있습니다.
- 대시보드에서 VM 정보(전원, CPU, 메모리, 사양, IP, 네트워크)를 보고 **noVNC** 콘솔로 접속합니다.
- 관리자 페이지에서 전체 VM을 모니터링하고 **연장 · 영구화 · 삭제**하며, Proxmox 연결부터 템플릿 · 제한값 · 노드 분산까지 **모든 설정을 웹에서** 합니다. 설정 파일을 손으로 고칠 필요가 없습니다.

PHP 8.1 이상 + `pdo_sqlite`, `curl` 확장만 있으면 됩니다 (Composer 불필요).

## 구조

```
public/            ← 웹 문서 루트
  index.php        서버 만들기 / 내 서버 열기
  vm.php           VM 대시보드 (정보 + noVNC 콘솔)
  console.php      전체 화면 콘솔
  api.php          사용자 JSON API (create / status / power / vnc)
  admin/index.php  관리자 대시보드 (VM 목록 · 연장 · 영구화 · 삭제, 설정 체크리스트)
  admin/settings.php 관리자 설정 (Proxmox 연결 · 운영 정책 · 복제 · 콘솔 · 보안)
  assets/          CSS · JS (console.js = noVNC 연결)
src/
  Proxmox.php      Proxmox REST API 클라이언트 (API 토큰)
  VmService.php    생성 · 상태 전이 · 만료 삭제
  Placement.php    클러스터 노드 분산
  Db.php           SQLite 저장소 + 운영 정책 (Settings)
  AppConfig.php    설치 설정 (Proxmox 연결 등, SQLite 저장)
  admin.php        관리자 공통 (초기 설정 · 로그인 · 세션)
bin/
  cron.php         만료 VM 정리 (매분 실행)
  admin-password.php 관리자 비밀번호 재설정 (잊었을 때)
deploy/            Caddy / nginx / Apache 예제 설정
data/              SQLite DB (자동 생성, git 제외)
```

### VM 수명 주기

Proxmox 작업은 모두 비동기 task(UPID)라서, VM은 아래 상태를 차례로 거칩니다.
`advance()` 는 블로킹하지 않고 현재 task 가 끝났는지만 확인하므로 웹 요청과 cron 어디서든 안전하게 호출됩니다.

```
creating ──▶ starting ──▶ ready                (clone → start)
deleting ──▶ destroying ──▶ deleted            (stop → destroy, purge)
error                                          (clone 실패)
```

## 설치

### 1. Proxmox API 토큰 만들기

Proxmox 노드 셸에서:

```bash
pveum role add WSURental -privs "VM.Allocate VM.Clone VM.Audit VM.Console VM.PowerMgmt VM.Config.Disk VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.HWType VM.Config.Cloudinit VM.Config.CDROM Datastore.AllocateSpace Datastore.Audit Sys.Audit SDN.Use"
pveum user add vmrental@pve
pveum aclmod / -user vmrental@pve -role WSURental
pveum user token add vmrental@pve web --privsep 0
```

- 마지막 명령이 출력하는 `value` 가 토큰 secret 입니다.
- 게스트 에이전트로 IP를 보려면 PVE 8 은 `VM.Monitor`, PVE 9 는 `VM.GuestAgent.Audit` 권한도 role 에 추가하세요.
- 템플릿 VM에 `qemu-guest-agent` 를 설치하고 옵션에서 QEMU Guest Agent 를 켜 두면 대시보드에 IP가 표시됩니다.

### 2. 파일 배치

```bash
sudo mkdir -p /var/www/wsu-server/data
sudo cp -r public src bin deploy /var/www/wsu-server/
sudo chown -R www-data:www-data /var/www/wsu-server/data   # 웹 서버 사용자가 DB를 만들 수 있게
```

`config.php` 는 필요 없습니다. DB 위치나 시간대를 바꿀 때만 `config.example.php` 를 `config.php` 로 복사해 고치세요.

### 3. 웹 서버: Caddy (noVNC 프록시 포함)

```bash
sudo apt install -y caddy php-fpm php-sqlite3 php-curl
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo usermod -aG www-data caddy        # Caddy 가 php-fpm 소켓(www-data 소유)에 접근하도록
sudo systemctl restart caddy
```

`/etc/caddy/Caddyfile` 에서 수정할 곳:

- `php_fastcgi` 소켓 경로 → 설치된 PHP 버전 (`ls /run/php/`)
- 첫 줄 `:80` → 도메인이 있으면 도메인으로 (HTTPS 인증서 자동 발급)
- noVNC 프록시 블록(`reverse_proxy` 주소, `Authorization` 토큰) → 다음 단계에서 Proxmox 연결을 저장하면 관리자 설정의 **콘솔** 섹션에 실제 값이 채워진 블록이 나오므로 그대로 붙여 넣으면 됩니다.

수정 후 `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

nginx / Apache 를 쓴다면 `deploy/nginx.conf.example`, `deploy/apache.conf.example` 을 참고하세요.

브라우저 WebSocket 은 `Authorization` 헤더를 보낼 수 없으므로 웹 서버가 API 토큰을 주입합니다.
이 경로는 정규식으로 `vncwebsocket` 엔드포인트만 열어 두며, Proxmox는 `api.php` 가 발급한 일회성 `vncticket`
(해당 VM 경로에 묶이고 수 초 안에 만료) 없이는 연결을 거부합니다.

### 4. 관리자 초기 설정 (웹)

브라우저로 `http://서버주소/admin/` 에 들어가면 **초기 설정** 화면이 나옵니다.

1. 처음 들어온 아무나 관리자가 되지 않도록 설치 코드를 확인합니다. 서버에서 아래 명령을 실행해 나오는 8자리 코드를 입력하세요.
   ```bash
   sudo cat /var/www/wsu-server/data/setup-code
   ```
2. 관리자 비밀번호(8자 이상)를 정하면 바로 로그인되고 **설정** 페이지로 이동합니다.
3. **Proxmox 연결**: 주소(`https://10.0.0.10:8006`), 토큰 ID(`vmrental@pve!web`), 토큰 secret 을 넣고 저장하면 바로 연결을 확인합니다. Proxmox 기본(자체 서명) 인증서라면 "TLS 인증서 검증"을 끄세요.
4. **운영 정책**: 템플릿을 고르고 대여 시간, 제한값, 노드 분산을 정합니다.
5. **콘솔**: 화면의 웹 서버 설정 블록을 3단계의 Caddyfile(또는 nginx/Apache)에 붙여 넣습니다.

관리자 대시보드 위쪽의 체크리스트에서 남은 단계(연결 · 템플릿 · cron)를 확인할 수 있습니다. 설정이 끝나기 전에는 사용자 화면에 "준비 중" 안내가 나오고 서버를 만들 수 없습니다.

### 5. cron

```bash
echo "* * * * * www-data php /var/www/wsu-server/bin/cron.php >> /var/www/wsu-server/data/cron.log 2>&1" | sudo tee /etc/cron.d/wsu-server
```

cron이 없어도 페이지 요청 때 최대 1분에 한 번 정리 작업이 돌지만, 접속이 없으면 만료된 VM이 남아 있게 되므로 cron 등록을 권장합니다. 관리자 대시보드에 cron 동작 여부가 표시됩니다.

### 관리자 비밀번호를 잊었을 때

```bash
cd /var/www/wsu-server && sudo -u www-data php bin/admin-password.php
```

새 비밀번호를 입력하면 SQLite 에 바로 저장되고, 로그인 시도 제한도 초기화됩니다.

## 관리자 설정 항목

모든 값은 관리자 페이지 **설정**에서 바꾸며, SQLite(`data/app.sqlite`)의 `settings` 테이블에 저장됩니다.

| 섹션 | 항목 | 설명 |
|---|---|---|
| Proxmox 연결 | 주소 · 토큰 ID · 토큰 secret · TLS 검증 · 타임아웃 | 저장할 때 연결을 확인합니다. secret 은 화면에 다시 표시되지 않으며, 비워 두면 기존 값을 유지합니다. |
| 운영 정책 | 템플릿 | Proxmox에서 템플릿으로 변환된 VM 목록에서 선택 |
| | 대여 시간 | 새 VM의 기본 수명 (시간) |
| | 최대 임시 VM | 동시에 존재할 수 있는 임시 VM 수 (영구 VM은 제외, 0 = 무제한) |
| | IP당 하루 생성 | 같은 IP가 24시간 안에 만들 수 있는 수 (0 = 무제한) |
| | 새 서버 생성 허용 | 끄면 사용자 생성이 중단됨 (대시보드에서도 바로 켜고 끌 수 있음) |
| | 노드 분산 | 자동(메모리 여유 순) / 템플릿 노드에만, 그리고 분산할 노드 선택 (아래 "클러스터" 참고) |
| VM 복제 | Full/Linked clone · 대상 스토리지 · 리소스 풀 · 이름 접두사 · VMID 범위 | 스토리지와 풀은 Proxmox 목록에서 고를 수 있습니다. 접두사를 바꿔도 이미 만든 VM은 원래 이름으로 계속 찾습니다. |
| 콘솔 | WebSocket 경로 · noVNC 모듈 | 웹 서버 설정 블록을 현재 값으로 만들어 보여 줍니다. |
| 보안 | 클라이언트 IP 헤더 · 관리자 비밀번호 변경 | 리버스 프록시(Cloudflare 등) 뒤라면 IP 헤더를 고르세요. |

예전 버전처럼 `config.php` 에 `proxmox`, `vm` 등을 적어 두었다면 처음 값으로 쓰이고, 관리자 페이지에서 저장한 뒤부터는 DB 값이 우선합니다.

## 클러스터 (여러 노드)

여러 노드가 하나의 Proxmox 클러스터로 묶여 있으면, 클러스터 안 아무 노드 하나에만 API를 연결하면 됩니다. 관리자 페이지의 **노드 분산**이 기본값인 "자동"이면 새 VM을 **메모리 할당률이 가장 낮은 노드**에 만듭니다. 할당률은 실행 중인 VM의 할당 메모리와 아직 복제 중인 VM을 더해서 계산하므로, 동시에 여러 개를 만들어도 한 노드에 몰리지 않습니다.

노드가 후보가 되려면 템플릿을 그 노드에서 쓸 수 있어야 합니다. 스토리지 구성에 따라 다음 중 하나를 고르세요.

| 스토리지 구성 | 할 일 |
|---|---|
| **공유 스토리지** (Ceph, NFS 등) | 템플릿 디스크를 공유 스토리지에 두면 끝입니다. 템플릿 노드에서 `target` 으로 복제합니다. Full clone 에서 `vm.storage` 를 지정한다면 그 스토리지도 공유 스토리지여야 합니다. |
| **로컬 스토리지** (local-lvm, 노드별 ZFS) | 각 노드에 **같은 이름**의 템플릿 사본을 두세요(VMID는 달라도 됨). 관리자 페이지에서 고른 템플릿과 이름이 같은 사본이 있는 노드는 그 사본에서 복제합니다. |

- 특정 노드에만 분산하려면 관리자 페이지에서 쓸 노드만 켜 두세요. 모두 켜 두면 나중에 클러스터에 추가되는 노드도 쓰입니다. 오프라인 노드는 자동으로 제외됩니다.
- 예전처럼 항상 템플릿 노드에 만들려면 노드 분산을 "템플릿이 있는 노드에만"으로 바꿉니다.
- 설정은 SQLite `settings` 테이블의 `placement`(`auto`/`template`), `placement_nodes`(쉼표 구분, 빈 값 = 모든 노드)에 저장됩니다.
- 관리자가 Proxmox에서 VM을 다른 노드로 마이그레이션해도 정리 작업이 바뀐 노드를 찾아 따라갑니다.
- 노드·스토리지 목록을 읽으려면 위 role 의 `Sys.Audit`, `Datastore.Audit` 권한이 `/` 에 있어야 합니다. 권한이 없으면 템플릿 노드에 만듭니다.

## 보안 참고

- **서버 이름 = 접근 키**입니다. 짧거나 흔한 이름은 다른 사람이 추측할 수 있으므로, 화면의 "무작위" 버튼처럼 추측하기 어려운 이름을 권장합니다.
- 회원가입이 없으므로 남용 방지는 IP당 생성 제한과 최대 VM 수로 합니다. 리버스 프록시 뒤라면 관리자 설정 **보안**에서 클라이언트 IP 헤더를 고르세요.
- 사용자 API의 POST 요청은 Origin 검사로 다른 사이트에서 보낸 요청을 막고, 관리자 페이지는 세션 + CSRF 토큰 + 로그인 시도 제한(15분에 5회)을 사용합니다.
- 초기 설정은 서버의 `data/setup-code` 일회성 코드가 있어야 진행되고, 설정이 끝나면 코드 파일은 삭제됩니다.
- Proxmox 토큰 secret 은 `data/app.sqlite` 에 저장되므로 `data/` 는 웹 루트 바깥에 두고 웹 서버 사용자만 읽을 수 있게 하세요 (DB 파일은 `0640` 으로 만들어집니다).
- 템플릿 VM은 외부에서 접근할 수 있는 네트워크(브리지/VLAN) 정책을 미리 고려해 구성하세요.
