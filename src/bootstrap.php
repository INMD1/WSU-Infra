<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));

// config.php 는 선택 사항입니다. Proxmox 연결 · 복제 옵션 · 비밀번호 등은 관리자 페이지에서
// 설정하며 SQLite 에 저장됩니다 (AppConfig::FIELDS). config.php 에 있는 값은 처음 값으로 쓰입니다.
$configFile = APP_ROOT . '/config.php';
$GLOBALS['__config'] = array_replace(
    ['db_path' => APP_ROOT . '/data/app.sqlite', 'timezone' => 'Asia/Seoul'],
    is_file($configFile) ? (array)require $configFile : []
);

require __DIR__ . '/AppConfig.php';
require __DIR__ . '/Proxmox.php';
require __DIR__ . '/Db.php';
require __DIR__ . '/Placement.php';
require __DIR__ . '/VmService.php';
require __DIR__ . '/view.php';

date_default_timezone_set(config('timezone') ?: 'UTC');

/**
 * 점 표기로 설정 읽기:  config('proxmox.host')
 * 관리자 페이지에서 바꿀 수 있는 항목(AppConfig::FIELDS)은 DB 값이 config.php 보다 우선합니다.
 */
function config(string $key, mixed $default = null): mixed
{
    return AppConfig::has($key) ? AppConfig::get($key) : config_file($key, $default);
}

/** config.php 에 적힌 값만 읽기 */
function config_file(string $key, mixed $default = null): mixed
{
    $value = $GLOBALS['__config'];
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }
    return $value;
}

/** 현재 저장된 Proxmox 연결 정보 */
function proxmox_settings(): array
{
    return [
        'host'         => (string)config('proxmox.host'),
        'token_id'     => (string)config('proxmox.token_id'),
        'token_secret' => (string)config('proxmox.token_secret'),
        'verify_ssl'   => (bool)config('proxmox.verify_ssl'),
        'timeout'      => (int)config('proxmox.timeout'),
    ];
}

/** Proxmox 주소와 토큰이 입력되어 있는지 (연결이 되는지는 따로 확인) */
function proxmox_configured(): bool
{
    $s = proxmox_settings();
    return $s['host'] !== '' && $s['token_id'] !== '' && $s['token_secret'] !== '';
}

function proxmox(): Proxmox
{
    static $pve = null;
    return $pve ??= new Proxmox(proxmox_settings());
}

function vms(): VmService
{
    static $svc = null;
    return $svc ??= new VmService(proxmox());
}

function client_ip(): string
{
    $header = config('client_ip_header');
    if ($header && !empty($_SERVER[$header])) {
        return trim(explode(',', (string)$_SERVER[$header])[0]);
    }
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'cli');
}

function h(mixed $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** 사이트 기준 URL 경로 (서브 디렉터리 배포 대응) */
function base_path(): string
{
    static $base = null;
    if ($base === null) {
        $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/'));
        $base = rtrim(preg_replace('#/admin$#', '', dirname($script)), '/');
    }
    return $base;
}

function url(string $path = ''): string
{
    return base_path() . '/' . ltrim($path, '/');
}

function absolute_url(string $path = ''): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return ($https ? 'https' : 'http') . '://' . $host . url($path);
}

function vm_url(string $name, bool $absolute = false): string
{
    $path = 'vm.php?name=' . rawurlencode($name);
    return $absolute ? absolute_url($path) : url($path);
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_name('vmrental');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => base_path() . '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function csrf_token(): string
{
    start_session();
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
}

function csrf_check(): void
{
    start_session();
    $sent = $_POST['csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        http_response_code(403);
        exit('잘못된 요청입니다 (CSRF). 페이지를 새로고침한 뒤 다시 시도하세요.');
    }
}

/** 다른 사이트에서 보낸 POST 를 차단 (회원가입이 없으므로 Origin 검사로 대신함) */
function require_same_origin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return; // 구형 브라우저 / 동일 출처 GET
    }
    $host = parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '');
    if (strcasecmp($host, (string)($_SERVER['HTTP_HOST'] ?? '')) !== 0) {
        json_out(['error' => '허용되지 않은 요청 출처입니다.'], 403);
    }
}

function is_admin(): bool
{
    start_session();
    return !empty($_SESSION['admin']) && ($_SESSION['admin_until'] ?? 0) > time();
}

function json_out(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** VM 레코드 → 클라이언트에 보낼 공개 필드 */
function vm_public(array $vm): array
{
    return [
        'name'       => $vm['name'],
        'vmid'       => (int)$vm['vmid'],
        'node'       => $vm['node'],
        'state'      => $vm['state'],
        'error'      => $vm['last_error'],
        'created_at' => (int)$vm['created_at'],
        'expires_at' => $vm['expires_at'] === null ? null : (int)$vm['expires_at'],
        'url'        => vm_url($vm['name'], true),
    ];
}
