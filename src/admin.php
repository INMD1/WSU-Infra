<?php
declare(strict_types=1);

/**
 * 관리자 페이지 공통: 로그인 · 초기 설정 · 세션 · 알림 메시지 · 상단 탭.
 * public/admin/*.php 에서 bootstrap.php 다음에 불러온 뒤 admin_boot() 를 호출합니다.
 *
 * 초기 설정: 관리자 비밀번호가 아직 없으면 로그인 대신 초기 설정 화면이 나옵니다.
 * 처음 접속한 아무나 관리자가 되지 않도록, 서버의 data/setup-code 파일에 적힌 일회성 코드를
 * 입력해야 합니다 (서버에 접속할 수 있는 사람 = 설치한 사람).
 */

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW    = 900;   // 15분
const ADMIN_TTL       = 28800; // 8시간
const ADMIN_PW_MIN    = 8;

function flash(string $msg): void
{
    $_SESSION['flash'][] = $msg;
}

function take_flashes(): array
{
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $f;
}

/** POST 처리 후 GET 으로 되돌아가기.  $page: '' (서버 목록) | 'settings.php' */
function admin_redirect(string $page = '', array $query = [], string $hash = ''): never
{
    header('Location: ' . url('admin/' . $page) . ($query ? '?' . http_build_query($query) : '') . ($hash !== '' ? '#' . $hash : ''));
    exit;
}

function admin_needs_setup(): bool
{
    return (string)config('admin.password_hash') === '';
}

function setup_code_file(): string
{
    return dirname((string)config('db_path')) . '/setup-code';
}

/** 초기 설정용 일회성 코드. 파일이 없으면 만듦. 쓸 수 없으면 null */
function setup_code(): ?string
{
    $file = setup_code_file();
    if (is_file($file)) {
        $code = trim((string)@file_get_contents($file));
        if ($code !== '') {
            return $code;
        }
    }
    $code = strtoupper(bin2hex(random_bytes(4)));
    $old = umask(0077);
    $ok = @file_put_contents($file, $code . "\n", LOCK_EX) !== false;
    umask($old);
    return $ok ? $code : null;
}

/** 화면에 보여 줄 경로 (설치 폴더 기준) */
function app_relative(string $path): string
{
    return str_starts_with($path, APP_ROOT . '/') ? substr($path, strlen(APP_ROOT) + 1) : $path;
}

function login_blocked(string $ip): bool
{
    Db::exec('DELETE FROM login_attempts WHERE at < ?', [time() - LOGIN_WINDOW]);
    return (int)Db::scalar('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]) >= LOGIN_MAX_FAILS;
}

function login_failed(string $ip): void
{
    Db::exec('INSERT INTO login_attempts(ip, at) VALUES(?, ?)', [$ip, time()]);
}

function admin_sign_in(string $ip): void
{
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    $_SESSION['admin_until'] = time() + ADMIN_TTL;
    Db::exec('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
}

/** 새 비밀번호 검사. 문제가 없으면 null */
function password_problem(string $password, string $confirm): ?string
{
    if (strlen($password) < ADMIN_PW_MIN) {
        return '비밀번호는 ' . ADMIN_PW_MIN . '자 이상이어야 합니다.';
    }
    if (strlen($password) > 72) {
        return '비밀번호는 72바이트 이하로 정해 주세요.';
    }
    if (!hash_equals($password, $confirm)) {
        return '비밀번호 확인이 일치하지 않습니다.';
    }
    return null;
}

/**
 * 모든 관리자 페이지 맨 앞에서 호출합니다.
 * 로그인 · 초기 설정 · 로그아웃 요청을 처리하고, 로그인하지 않았으면 로그인(또는 초기 설정) 화면을 보여 준 뒤 끝냅니다.
 * 이 함수가 돌아오면 로그인된 상태이고, POST 라면 CSRF 검사도 끝난 상태입니다.
 *
 * @param string $page 이 페이지 경로 ('' = 서버 목록, 'settings.php')
 */
function admin_boot(string $page): void
{
    start_session();
    header('Cache-Control: no-store');
    $isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
    $action = $isPost ? (string)($_POST['action'] ?? '') : '';

    if ($action === 'login' || $action === 'setup') {
        csrf_check();
        $ip = client_ip();
        if (login_blocked($ip)) {
            flash('시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.');
        } elseif ($action === 'setup') {
            admin_setup($ip);
        } else {
            $hash = (string)config('admin.password_hash');
            if ($hash !== '' && password_verify((string)($_POST['password'] ?? ''), $hash)) {
                admin_sign_in($ip);
            } else {
                login_failed($ip);
                flash('비밀번호가 올바르지 않습니다.');
            }
        }
        admin_redirect($page);
    }

    if (!is_admin()) {
        if ($isPost) {
            admin_redirect($page);
        }
        admin_auth_screen();
    }

    // 활동이 있으면 세션 연장
    $_SESSION['admin_until'] = time() + ADMIN_TTL;

    if ($isPost) {
        csrf_check();
        if ($action === 'logout') {
            $_SESSION = [];
            session_destroy();
            admin_redirect();
        }
    }
}

/** 초기 설정: 설치 코드 확인 → 관리자 비밀번호 저장 → 로그인 → 설정 페이지로 */
function admin_setup(string $ip): void
{
    if (!admin_needs_setup()) {
        flash('이미 관리자 비밀번호가 정해져 있습니다. 로그인하세요.');
        return;
    }
    $code = setup_code();
    $sent = strtoupper((string)preg_replace('/[\s-]+/', '', (string)($_POST['setup_code'] ?? '')));
    if ($code === null || $sent === '' || !hash_equals($code, $sent)) {
        login_failed($ip);
        flash('설치 코드가 올바르지 않습니다.');
        return;
    }
    $password = (string)($_POST['password'] ?? '');
    if ($problem = password_problem($password, (string)($_POST['password_confirm'] ?? ''))) {
        flash($problem);
        return;
    }
    AppConfig::set('admin.password_hash', password_hash($password, PASSWORD_DEFAULT));
    @unlink(setup_code_file());
    admin_sign_in($ip);
    flash(proxmox_configured()
        ? '관리자 비밀번호를 정했습니다. 아래에서 설정을 확인하세요.'
        : '관리자 비밀번호를 정했습니다. 이제 Proxmox 연결 정보를 입력하세요.');
    admin_redirect('settings.php', [], proxmox_configured() ? '' : 'proxmox');
}

/** 로그인 또는 초기 설정 화면 */
function admin_auth_screen(): never
{
    $flashes = take_flashes();
    $setup = admin_needs_setup();
    $code = $setup ? setup_code() : null;
    page_head(($setup ? '초기 설정' : '관리자 로그인') . ' — WSU Server', ['cta' => null]);
    ?>
<section class="container auth-wrap">
  <div class="card-soft">
    <span class="squircle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
    <?php if ($setup): ?>
      <h1 class="h3" style="margin-top:20px">초기 설정.</h1>
      <p class="muted body-sm" style="margin-top:8px">관리자 비밀번호를 정하면 이 페이지에서 Proxmox 연결과 운영 설정을 모두 할 수 있습니다.</p>
    <?php else: ?>
      <h1 class="h3" style="margin-top:20px">관리자 로그인.</h1>
      <p class="muted body-sm" style="margin-top:8px">전체 VM을 관리하려면 관리자 비밀번호를 입력하세요.</p>
    <?php endif; ?>
    <form method="post" class="stack" style="margin-top:24px">
      <input type="hidden" name="action" value="<?= $setup ? 'setup' : 'login' ?>">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <?php foreach ($flashes as $f): ?><div class="form-error"><?= h($f) ?></div><?php endforeach; ?>
      <?php if ($setup): ?>
        <?php if ($code === null): ?>
          <div class="form-error"><code><?= h(app_relative(dirname(setup_code_file()))) ?></code> 폴더에 쓸 수 없습니다. 서버에서 <code>sudo chown -R www-data:www-data <?= h(app_relative(dirname(setup_code_file()))) ?></code> 를 실행한 뒤 새로고침하세요.</div>
        <?php endif; ?>
        <label class="field">
          <span class="field-label">설치 코드</span>
          <input class="input mono" name="setup_code" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="16" autofocus required>
          <span class="hint" style="display:block;margin-top:6px">서버의 설치 폴더에서 <code>sudo cat <?= h(app_relative(setup_code_file())) ?></code> 를 실행하면 나오는 8자리 코드입니다. 설치한 사람만 관리자를 만들 수 있게 하기 위한 확인입니다.</span>
        </label>
        <label class="field">
          <span class="field-label">새 비밀번호</span>
          <input class="input" type="password" name="password" autocomplete="new-password" minlength="<?= ADMIN_PW_MIN ?>" required>
        </label>
        <label class="field">
          <span class="field-label">비밀번호 확인</span>
          <input class="input" type="password" name="password_confirm" autocomplete="new-password" minlength="<?= ADMIN_PW_MIN ?>" required>
        </label>
        <button class="btn btn-primary btn-block" type="submit">비밀번호 정하고 시작하기</button>
      <?php else: ?>
        <label class="field">
          <span class="field-label">비밀번호</span>
          <input class="input" type="password" name="password" autocomplete="current-password" autofocus required>
        </label>
        <button class="btn btn-primary btn-block" type="submit">로그인</button>
        <p class="hint">비밀번호를 잊었다면 서버에서 <code>sudo -u www-data php bin/admin-password.php</code> 로 다시 정할 수 있습니다.</p>
      <?php endif; ?>
    </form>
  </div>
</section>
<?php
    page_foot();
    exit;
}

/** 관리자 페이지 공통 머리 (제목 · 탭 · 로그아웃 · 알림). $actions 는 오른쪽에 들어갈 추가 HTML */
function admin_header(string $active, string $title, array $flashes, string $actions = ''): void
{
    page_head($title . ' — WSU Server 관리자', [
        'nav' => [['href' => url('index.php'), 'label' => '사용자 화면']],
        'cta' => null,
    ]);
    $tabs = ['' => '서버 목록', 'settings.php' => '설정'];
    ?>
<section class="container container-wide section" style="padding-top:56px">
  <div class="row-between" style="align-items:flex-end">
    <div>
      <span class="badge badge-ink">관리자</span>
      <h1 class="h1" style="margin-top:16px"><?= h($title) ?>.</h1>
    </div>
    <div class="row">
      <?= $actions ?>
      <form method="post" class="inline-form">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>"><input type="hidden" name="action" value="logout">
        <button class="btn btn-outline btn-sm" type="submit">로그아웃</button>
      </form>
    </div>
  </div>
  <nav class="segmented" style="margin-top:24px" aria-label="관리자 메뉴">
    <?php foreach ($tabs as $page => $label): ?>
      <a href="<?= h(url('admin/' . $page)) ?>" class="<?= $page === $active ? 'active' : '' ?>" <?= $page === $active ? 'aria-current="page"' : '' ?>><?= h($label) ?></a>
    <?php endforeach; ?>
  </nav>
  <?php foreach ($flashes as $f): ?>
    <div class="card-soft card-tight" style="margin-top:16px"><?= h($f) ?></div>
  <?php endforeach; ?>
<?php
}
