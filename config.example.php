<?php
/**
 * 설정 파일 예시 — 선택 사항입니다.
 *
 * Proxmox 연결, 토큰, 템플릿, 복제 옵션, 노드 분산, 관리자 비밀번호 같은 설정은 모두
 * 관리자 페이지(/admin/ → 설정)에서 하며 SQLite(data/app.sqlite)에 저장됩니다.
 * 이 파일은 DB 위치나 시간대를 바꾸고 싶을 때만 config.php 로 복사해 쓰세요.
 *
 *   cp config.example.php config.php
 *
 * 예전 버전처럼 'proxmox' => [...], 'vm' => [...] 등을 여기에 적어 두면 처음 값으로 쓰이고,
 * 관리자 페이지에서 저장하는 순간부터는 DB 값이 우선합니다.
 */
return [
    // SQLite 데이터 파일 위치 (웹 루트 바깥이어야 합니다). 기본값: 설치 폴더/data/app.sqlite
    'db_path'  => __DIR__ . '/data/app.sqlite',
    'timezone' => 'Asia/Seoul',
];
