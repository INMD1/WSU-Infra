<?php
declare(strict_types=1);

/**
 * SQLite 저장소. 스키마는 처음 연결 시 자동 생성됩니다.
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo) {
            return self::$pdo;
        }
        $path = (string)config('db_path');
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
            throw new RuntimeException("데이터 디렉터리를 만들 수 없습니다: {$dir}");
        }
        $isNew = !is_file($path);
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');
        self::migrate($pdo);
        if ($isNew) {
            // API 토큰과 비밀번호 해시가 들어가므로 다른 사용자가 읽지 못하게 (-wal/-shm 도 같은 권한으로 생김)
            @chmod($path, 0640);
        }
        return self::$pdo = $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS vms (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                vmid        INTEGER NOT NULL,
                node        TEXT    NOT NULL,
                template_id INTEGER NOT NULL,
                state       TEXT    NOT NULL,
                task_upid   TEXT,
                last_error  TEXT,
                creator_ip  TEXT,
                created_at  INTEGER NOT NULL,
                expires_at  INTEGER,
                deleted_at  INTEGER,
                updated_at  INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS vms_name_active ON vms(name) WHERE state <> 'deleted';
            CREATE INDEX IF NOT EXISTS vms_state ON vms(state);
            CREATE INDEX IF NOT EXISTS vms_creator ON vms(creator_ip, created_at);

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS login_attempts (
                ip TEXT    NOT NULL,
                at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, at);
        SQL);

        // 추가된 열: 이전 버전 DB 에도 붙임
        $cols = array_column($pdo->query('PRAGMA table_info(vms)')->fetchAll(), 'name');
        if (!in_array('pve_name', $cols, true)) {
            // Proxmox 에 실제로 붙인 VM 이름 (접두사 포함). 관리자가 나중에 접두사를 바꿔도 기존 VM 을 찾을 수 있게
            $pdo->exec('ALTER TABLE vms ADD COLUMN pve_name TEXT');
        }
    }

    public static function one(string $sql, array $args = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function all(string $sql, array $args = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public static function exec(string $sql, array $args = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st->rowCount();
    }

    public static function scalar(string $sql, array $args = []): mixed
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st->fetchColumn();
    }
}

/**
 * 관리자 페이지에서 바꿀 수 있는 설정값 (settings 테이블).
 */
final class Settings
{
    public const DEFAULTS = [
        'template_id'      => null,   // null 이면 (예전 버전) config.php 의 vm.default_template_id
        'lease_hours'      => 24,     // 기본 대여 시간
        'max_active_vms'   => 20,     // 동시에 존재할 수 있는 임시 VM 수 (0 = 무제한)
        'per_ip_daily'     => 3,      // IP 당 24시간 내 생성 가능 수 (0 = 무제한)
        'creation_enabled' => 1,      // 0 이면 신규 생성 중단
        'placement'        => 'auto', // auto = 클러스터 노드에 메모리 여유 순으로 분산, template = 템플릿 노드에만
        'placement_nodes'  => '',     // 분산할 노드 (쉼표 구분, 빈 값 = 온라인 노드 전부. 나중에 추가된 노드 포함)
    ];

    private static ?array $raw = null;
    private static ?array $cache = null;

    /** settings 테이블에 저장된 값 그대로 (AppConfig 도 여기서 읽음) */
    public static function raw(): array
    {
        return self::$raw ??= array_column(Db::all('SELECT key, value FROM settings'), 'value', 'key');
    }

    public static function all(): array
    {
        if (self::$cache === null) {
            $values = self::DEFAULTS;
            $values['template_id'] = (int)config('vm.default_template_id');
            self::$cache = array_replace($values, self::raw());
        }
        return self::$cache;
    }

    public static function int(string $key): int
    {
        return (int)(self::all()[$key] ?? 0);
    }

    public static function str(string $key): string
    {
        return (string)(self::all()[$key] ?? '');
    }

    /** 쉼표로 구분해 저장한 목록 */
    public static function strList(string $key): array
    {
        return array_values(array_filter(array_map('trim', explode(',', self::str($key))), static fn($v) => $v !== ''));
    }

    public static function set(string $key, string|int $value): void
    {
        Db::exec('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$key, (string)$value]);
        self::$cache = null;
        self::$raw = null;
    }
}
