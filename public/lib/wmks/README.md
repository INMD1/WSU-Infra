# wmks.js 배치 위치

브라우저 콘솔 페이지(`/console/[vmId]`)가 사용하는 VMware WebMKS 클라이언트 라이브러리.

`/console/[vmId]` 페이지는 다음 경로에서 로드:
- `/lib/wmks/wmks.min.js` (이 디렉토리 = `public/lib/wmks/`)

## 가져오는 방법

### 1) 자체 vCenter 에서 추출 (권장)

```bash
ssh root@<vcenter>
shell

# vsphere-ui WAR 안에 wmks.js 가 들어있음
WAR=/usr/lib/vmware-vsphere-ui/server/webapps/vsphere-ui.war
# 정확한 파일명은 ls /usr/lib/vmware-vsphere-ui/server/webapps/ 로 확인

TMP=$(mktemp -d)
unzip -q "$WAR" "**/wmks*.js" "**/wmks*.css" -d "$TMP"
find "$TMP" -name "wmks*.js" -o -name "wmks*.css"
# 보통: WEB-INF/lib/<jar>!/static/wmks/ 또는 static/wmks/ 경로
```

찾은 파일들을 `public/lib/wmks/` 에 복사:
```
public/lib/wmks/
├─ wmks.min.js
├─ wmks.css      (있으면)
└─ ...           (의존 자원들)
```

### 2) VMware HTML Console SDK (공식)

VMware 가 별도 배포하던 SDK. https://developer.vmware.com 에서 가능 시 다운로드.

## 라이선스 주의

VMware 의 wmks.js 는 vCenter 라이선스에 따른 자산. 자체 vCenter 환경 안에서만 호스팅·사용하시고 외부 재배포 금지.

## 동작 확인

콘솔 페이지에 `wmks.js 로드 실패` 가 뜨면 이 디렉토리에 파일이 없거나 이름이 `wmks.min.js` 가 아닌 것.
