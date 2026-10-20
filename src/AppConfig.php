<?php
declare(strict_types=1);

const NOVNC_DEFAULT = 'https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/rfb.js';

/**
 * 관리자 페이지(설정)에서 바꿀 수 있는 앱 설정. SQLite settings 테이블에 저장됩니다.
 *
 * 값을 찾는 순서:  DB(관리자 페이지에서 저장한 값) → config.php → 아래 기본값
 * 그래서 config.php 없이도 동작하고, 예전 config.php 가 있으면 처음 값으로 쓰입니다.
 */
final class AppConfig
{
    /** 키 => [타입, 기본값] */
    public const FIELDS = [
        'proxmox.host'         => ['string', ''],
        'proxmox.token_id'     => ['string', ''],
        'proxmox.token_secret' => ['string', ''],
        'proxmox.verify_ssl'   => ['bool', false],
        'proxmox.timeout'      => ['int', 20],
        'vm.full_clone'        => ['bool', true],
        'vm.storage'           => ['string', ''],
        'vm.pool'              => ['string', ''],
        'vm.name_prefix'       => ['string', ''],
        'vm.vmid_min'          => ['int', 0],
        'vm.vmid_max'          => ['int', 0],
        'admin.password_hash'  => ['string', ''],
        'vnc_ws_path'          => ['string', '/pve-ws'],
        'novnc_module'         => ['string', NOVNC_DEFAULT],
        'client_ip_header'     => ['string', ''],
    ];

    public static function has(string $key): bool
    {
        return isset(self::FIELDS[$key]);
    }

    public static function get(string $key): mixed
    {
        [$type, $default] = self::FIELDS[$key];
        $raw = Settings::raw();
        if (array_key_exists($key, $raw)) {
            $value = $raw[$key];
        } else {
            $value = config_file($key);
            if ($value === null) {
                return $default;
            }
        }
        return match ($type) {
            'bool'  => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            'int'   => (int)$value,
            default => (string)$value,
        };
    }

    public static function set(string $key, string|int|bool $value): void
    {
        if (!self::has($key)) {
            throw new InvalidArgumentException("알 수 없는 설정: {$key}");
        }
        Settings::set($key, is_bool($value) ? (int)$value : $value);
    }
}
