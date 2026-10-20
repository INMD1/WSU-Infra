<?php
declare(strict_types=1);

/**
 * 관리자 비밀번호를 정하거나 다시 정합니다 (비밀번호를 잊었을 때).  SQLite 에 바로 저장합니다.
 *
 *   sudo -u www-data php bin/admin-password.php          (프롬프트에서 입력, 화면에 표시 안 됨)
 *   sudo -u www-data php bin/admin-password.php --hash   (저장하지 않고 해시만 출력)
 *
 * 처음 설치할 때는 이 명령 대신 웹의 /admin/ 초기 설정 화면을 써도 됩니다.
 * DB 파일 소유자(웹 서버 사용자)로 실행해야 합니다.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/admin.php';

function prompt_hidden(string $label): string
{
    fwrite(STDOUT, $label);
    shell_exec('stty -echo 2>/dev/null');
    $value = rtrim((string)fgets(STDIN), "\r\n");
    shell_exec('stty echo 2>/dev/null');
    fwrite(STDOUT, PHP_EOL);
    return $value;
}

$password = prompt_hidden('새 관리자 비밀번호: ');
if ($problem = password_problem($password, prompt_hidden('비밀번호 확인: '))) {
    fwrite(STDERR, $problem . PHP_EOL);
    exit(1);
}
$hash = password_hash($password, PASSWORD_DEFAULT);

if (in_array('--hash', $argv, true)) {
    echo $hash, PHP_EOL;
    exit(0);
}

try {
    AppConfig::set('admin.password_hash', $hash);
    Db::exec('DELETE FROM login_attempts');
} catch (Throwable $e) {
    fwrite(STDERR, '저장 실패: ' . $e->getMessage() . PHP_EOL
        . 'DB 파일 소유자로 실행했는지 확인하세요:  sudo -u www-data php bin/admin-password.php' . PHP_EOL);
    exit(1);
}
@unlink(setup_code_file());
echo '관리자 비밀번호를 저장했습니다. 로그인 시도 제한도 초기화했습니다.', PHP_EOL;
