<?php
declare(strict_types=1);

/**
 * 정기 작업: 만료된 VM 삭제 + 생성/삭제 진행 상태 갱신.
 * 매분 실행하세요.  예) crontab -e
 *
 *   * * * * * php /var/www/wsu-server/bin/cron.php >> /var/log/wsu-server-cron.log 2>&1
 *
 * 한 번 실행되면 약 55초 동안 5초 간격으로 반복하여 삭제/생성 단계가 빠르게 진행되게 합니다.
 *   --once  한 번만 실행
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap.php';

$lock = fopen(dirname(config('db_path')) . '/cron.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    exit(0); // 이전 실행이 아직 진행 중
}

$once = in_array('--once', $argv, true);
$until = time() + 55;
do {
    Settings::set('last_cron', time());
    try {
        foreach (vms()->tick() as $line) {
            echo date('[Y-m-d H:i:s] '), $line, PHP_EOL;
        }
    } catch (Throwable $e) {
        fwrite(STDERR, date('[Y-m-d H:i:s] ') . 'tick 실패: ' . $e->getMessage() . PHP_EOL);
    }
    $pending = (int)Db::scalar("SELECT COUNT(*) FROM vms WHERE state IN ('creating','starting','deleting','destroying')");
    if ($once || time() + 5 > $until) {
        break;
    }
    sleep($pending ? 5 : 15);
} while (time() < $until);
