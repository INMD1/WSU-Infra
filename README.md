# WSU Server Backend (Next.js)

VMware ESXi 및 pfSense를 이용한 VM 관리 시스템의 백엔드 프로젝트입니다.

## 기술 스택
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Auth**: JWT (jsonwebtoken)
- **Validation**: Zod

## 프로젝트 구조
- `src/app/api/`: API 엔드포인트 정의 (문서의 /auth, /vms, /quotas 대응)
- `src/services/`: 비즈니스 로직 및 Mock 데이터 관리
- `src/lib/`: 공통 유틸리티 및 인프라 연동 클라이언트 예시
- `src/lib/types.ts`: 전역 타입 정의

## 시작하기
1. 의존성 설치: `npm install`
2. 개발 서버 실행: `npm run dev`

## API 주요 기능
- **Auth**: 로그인, 토큰 갱신, 로그아웃 (JWT 기반)
- **VMs**: 목록 조회, 생성, 상세 정보, 전원 제어, 삭제, 스펙 변경
- **Quotas**: 테넌트별 자원 사용량 및 제한 관리
