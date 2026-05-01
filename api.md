# WSU Server API 명세서

## 1. 인증 (Authentication)

### 1.1 로그인
- **URL**: `POST /api/auth/login`
- **Request Body**:
  ```json
  {
    "username": "user123",
    "password": "password123"
  }
  ```
- **Response**: `200 OK` (Set-Cookie: AccessToken)

### 1.2 로그아웃
- **URL**: `POST /api/auth/logout`
- **Response**: `200 OK` (Cookie Cleared)

---

## 2. 가상 머신 관리 (VM Management)

### 2.1 VM 목록 조회
- **URL**: `GET /api/vms`
- **Response**:
  ```json
  {
    "data": [...],
    "pagination": { "page": 1, "limit": 20, "total": 5 }
  }
  ```

### 2.2 VM 생성 (프로비저닝)
- **URL**: `POST /api/vms`
- **Request Body**:
  ```json
  {
    "name": "my-new-vm",
    "image_id": "ubuntu-22.04-template",
    "vcpu": 2,
    "ram_gb": 4,
    "disk_gb": 40
  }
  ```
- **Response**: `200 OK`

### 2.3 VM 상세 정보 조회
- **URL**: `GET /api/vms/[id]`
- **Response**: VM 객체 상세 정보

### 2.4 VM 상태 제어 및 스펙 변경
- **URL**: `PATCH /api/vms/[id]`
- **Request Body (상태 제어)**:
  ```json
  { "action": "start" } // start, stop, restart
  ```
- **Request Body (스펙 변경)**:
  ```json
  { "vcpu": 4, "ram_gb": 8 }
  ```

### 2.5 VM 삭제
- **URL**: `DELETE /api/vms/[id]`
- **Response**: `200 OK`

---

## 3. 리소스 쿼터 (Quotas)

### 3.1 내 쿼터 정보 조회
- **URL**: `GET /api/quotas`
- **Response**: CPU, RAM, Disk 사용량 및 제한량 정보

### 3.2 쿼터 수정 (관리자용)
- **URL**: `PATCH /api/quotas`
- **Request Body**:
  ```json
  { "max_vcpu": 20, "max_ram_gb": 64 }
  ```
