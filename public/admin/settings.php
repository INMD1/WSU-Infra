<?php
declare(strict_types=1);

/**
 * 관리자 설정: Proxmox 연결 · 운영 정책 · VM 복제 옵션 · 콘솔 프록시 · 보안.
 * 모든 값은 SQLite settings 테이블에 저장되며 config.php 보다 우선합니다.
 */
require __DIR__ . '/../../src/bootstrap.php';
require __DIR__ . '/../../src/admin.php';

admin_boot('settings.php');

const IP_HEADERS = [
    ''                      => '사용 안 함 (직접 접속 — 기본값)',
    'HTTP_CF_CONNECTING_IP' => 'CF-Connecting-IP (Cloudflare)',
    'HTTP_X_REAL_IP'        => 'X-Real-IP',
    'HTTP_X_FORWARDED_FOR'  => 'X-Forwarded-For',
];

/** 'pve.local' · '10.0.0.10' · 'https://10.0.0.10:8006/' → 'https://10.0.0.10:8006' */
function normalize_host(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return '';
    }
    if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $raw) && !preg_match('#^https?://#i', $raw)) {
        throw new UserError('Proxmox 주소는 https:// 로 시작해야 합니다. 예: https://10.0.0.10:8006');
    }
    if (!preg_match('#^https?://#i', $raw)) {
        $raw = 'https://' . $raw;
    }
    $p = parse_url($raw);
    if (!$p || empty($p['host']) || isset($p['user']) || isset($p['query']) || isset($p['fragment'])) {
        throw new UserError('Proxmox 주소 형식이 올바르지 않습니다. 예: https://10.0.0.10:8006');
    }
    $path = rtrim((string)($p['path'] ?? ''), '/');
    if ($path !== '' && $path !== '/api2/json') {
        throw new UserError('Proxmox 주소에는 경로를 넣지 마세요. 예: https://10.0.0.10:8006');
    }
    $host = str_contains($p['host'], ':') && !str_starts_with($p['host'], '[') ? "[{$p['host']}]" : $p['host'];
    return strtolower($p['scheme']) . '://' . $host . ':' . ($p['port'] ?? 8006);
}

/** 연결 확인 결과 문장. 실패하면 ProxmoxException */
function probe(Proxmox $pve): string
{
    $v = $pve->version();
    $parts = ['Proxmox VE ' . ($v['version'] ?? '?')];
    try {
        $parts[] = '노드 ' . count($pve->clusterNodes()) . '개';
    } catch (ProxmoxException) {
        $parts[] = '노드 목록 권한 없음(Sys.Audit)';
    }
    $parts[] = '템플릿 ' . count($pve->templates()) . '개';
    return implode(' · ', $parts);
}

/** 연결 실패 사유에 해결 방법을 덧붙임 */
function explain(ProxmoxException $e): string
{
    $msg = $e->getMessage();
    if ($e->httpStatus === 401) {
        return '토큰 ID 또는 secret 이 맞지 않습니다 (401). 토큰을 다시 확인하세요.';
    }
    if ($e->httpStatus === 403) {
        return '토큰 권한이 부족합니다 (403). 아래 "API 토큰 만드는 방법"의 권한을 확인하세요. — ' . $msg;
    }
    if ($e->httpStatus === 0 && preg_match('/SSL|certificate/i', $msg)) {
        return '인증서를 확인할 수 없습니다. Proxmox 기본(자체 서명) 인증서라면 "TLS 인증서 검증"을 끄세요. — ' . $msg;
    }
    if ($e->httpStatus === 0 && preg_match('/timed out|resolve|refused|connect/i', $msg)) {
        return '이 서버에서 Proxmox 주소로 접속할 수 없습니다. 주소·포트(8006)·방화벽을 확인하세요. — ' . $msg;
    }
    return $msg;
}

function int_in(string $key, int $min, int $max, int $default): int
{
    return max($min, min($max, (int)($_POST[$key] ?? $default)));
}

// ─── POST 처리 ──────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    $anchor = $action;
    try {
        switch ($action) {
            case 'proxmox':
                $host = normalize_host((string)($_POST['host'] ?? ''));
                $tokenId = trim((string)($_POST['token_id'] ?? ''));
                $secret = trim((string)($_POST['token_secret'] ?? ''));
                if ($secret === '') {
                    $secret = (string)config('proxmox.token_secret');   // 비워 두면 기존 값 유지
                }
                if ($host === '' || $tokenId === '' || $secret === '') {
                    throw new UserError('주소, 토큰 ID, 토큰 secret 을 모두 입력하세요.');
                }
                if (!preg_match('/^[^\s@!]+@[^\s@!]+![A-Za-z0-9][A-Za-z0-9._-]*$/', $tokenId)) {
                    throw new UserError('토큰 ID 형식은 사용자@realm!토큰이름 입니다. 예: vmrental@pve!web');
                }
                if (!preg_match('/^[A-Za-z0-9-]{8,128}$/', $secret)) {
                    throw new UserError('토큰 secret 형식이 올바르지 않습니다. 토큰을 만들 때 표시된 value(UUID)를 그대로 붙여 넣으세요.');
                }
                $cfg = [
                    'host'         => $host,
                    'token_id'     => $tokenId,
                    'token_secret' => $secret,
                    'verify_ssl'   => isset($_POST['verify_ssl']),
                    'timeout'      => int_in('timeout', 3, 120, 20),
                ];
                foreach ($cfg as $k => $v) {
                    AppConfig::set('proxmox.' . $k, $v);
                }
                try {
                    flash('저장했습니다. 연결 확인: ' . probe(new Proxmox($cfg)));
                } catch (ProxmoxException $e) {
                    flash('저장했지만 연결하지 못했습니다 — ' . explain($e));
                }
                break;

            case 'proxmox_test':
                $anchor = 'proxmox';
                try {
                    flash('연결 정상: ' . probe(new Proxmox(proxmox_settings())));
                } catch (ProxmoxException $e) {
                    flash('연결 실패 — ' . explain($e));
                }
                break;

            case 'policy':
                $settings = Settings::all();
                $tpl = (int)($_POST['template_id'] ?? 0);
                // 템플릿을 바꿀 때만 Proxmox 에 확인 (연결이 안 될 때도 나머지 값은 저장할 수 있게)
                if ($tpl !== (int)$settings['template_id']) {
                    $templates = array_column(proxmox()->templates(), null, 'vmid');
                    if (!isset($templates[$tpl])) {
                        throw new UserError("VMID {$tpl} 은(는) Proxmox 템플릿이 아닙니다.");
                    }
                }
                $placement = ($_POST['placement'] ?? '') === 'template' ? 'template' : 'auto';
                // 노드 체크박스는 노드 목록을 읽을 수 있을 때만 폼에 나옴 → 없으면 기존 값 유지
                $placementNodes = null;
                if (isset($_POST['nodes_listed'])) {
                    $known = array_map('strval', array_keys(proxmox()->clusterNodes()));
                    $picked = array_values(array_intersect($known, array_map('strval', (array)($_POST['placement_nodes'] ?? []))));
                    if (!$picked && $placement === 'auto') {
                        throw new UserError('분산할 노드를 하나 이상 선택해 주세요.');
                    }
                    if ($picked) {
                        // 전부 고르면 빈 값 = 모든 노드 (나중에 클러스터에 추가되는 노드도 포함)
                        $placementNodes = count($picked) === count($known) ? '' : implode(',', $picked);
                    }
                }
                if ($tpl > 0) {
                    Settings::set('template_id', $tpl);
                }
                Settings::set('placement', $placement);
                if ($placementNodes !== null) {
                    Settings::set('placement_nodes', $placementNodes);
                }
                Settings::set('lease_hours', int_in('lease_hours', 1, 8760, 24));
                Settings::set('max_active_vms', int_in('max_active_vms', 0, 10000, 0));
                Settings::set('per_ip_daily', int_in('per_ip_daily', 0, 1000, 0));
                Settings::set('creation_enabled', isset($_POST['creation_enabled']) ? 1 : 0);
                flash('운영 정책을 저장했습니다. 새로 만들어지는 서버부터 적용됩니다.');
                break;

            case 'clone':
                $storage = trim((string)($_POST['storage'] ?? ''));
                $pool = trim((string)($_POST['pool'] ?? ''));
                $prefix = trim((string)($_POST['name_prefix'] ?? ''));
                $min = int_in('vmid_min', 0, 999999999, 0);
                $max = int_in('vmid_max', 0, 999999999, 0);
                foreach (['스토리지' => $storage, '리소스 풀' => $pool] as $label => $v) {
                    if ($v !== '' && !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/', $v)) {
                        throw new UserError("{$label} 이름 형식이 올바르지 않습니다.");
                    }
                }
                // 이름 최대 32자 + 접두사 ≤ 63자 (Proxmox VM 이름은 DNS 이름 규칙)
                if ($prefix !== '' && !preg_match('/^[a-z0-9][a-z0-9-]{0,30}$/', $prefix)) {
                    throw new UserError('이름 접두사는 영문 소문자·숫자·하이픈으로 31자 이하, 영문/숫자로 시작해야 합니다.');
                }
                if (($min === 0) !== ($max === 0)) {
                    throw new UserError('VMID 범위는 둘 다 비우거나(0) 둘 다 입력하세요.');
                }
                if ($min !== 0 && ($min < 100 || $min > $max)) {
                    throw new UserError('VMID 범위가 올바르지 않습니다. 100 이상이고 시작 ≤ 끝이어야 합니다.');
                }
                if ($prefix !== (string)config('vm.name_prefix')) {
                    VmService::pinPveNames();   // 이미 만든 VM은 예전 이름으로 계속 찾도록
                }
                AppConfig::set('vm.full_clone', ($_POST['clone_mode'] ?? 'full') !== 'linked');
                AppConfig::set('vm.storage', $storage);
                AppConfig::set('vm.pool', $pool);
                AppConfig::set('vm.name_prefix', $prefix);
                AppConfig::set('vm.vmid_min', $min);
                AppConfig::set('vm.vmid_max', $max);
                flash('VM 복제 옵션을 저장했습니다.');
                break;

            case 'console':
                $path = '/' . trim(trim((string)($_POST['vnc_ws_path'] ?? '')), '/');
                if (!preg_match('#^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$#', $path) || preg_match('#^/(admin|assets|api\.php)#', $path)) {
                    throw new UserError('WebSocket 경로 형식이 올바르지 않습니다. 예: /pve-ws');
                }
                $module = trim((string)($_POST['novnc_module'] ?? ''));
                if ($module === '') {
                    $module = NOVNC_DEFAULT;
                }
                if (!preg_match('#^(https://[^\s"\'<>]+|/[^\s"\'<>]*)\.m?js$#', $module)) {
                    throw new UserError('noVNC 모듈은 https:// 주소 또는 /로 시작하는 경로의 .js 파일이어야 합니다.');
                }
                AppConfig::set('vnc_ws_path', $path);
                AppConfig::set('novnc_module', $module);
                flash('콘솔 설정을 저장했습니다. 경로를 바꿨다면 웹 서버 설정도 아래 예시대로 고치세요.');
                break;

            case 'security':
                $header = (string)($_POST['client_ip_header'] ?? '');
                if (!array_key_exists($header, IP_HEADERS)) {
                    throw new UserError('알 수 없는 헤더입니다.');
                }
                AppConfig::set('client_ip_header', $header);
                flash('클라이언트 IP 설정을 저장했습니다.');
                break;

            case 'password':
                if (!password_verify((string)($_POST['current'] ?? ''), (string)config('admin.password_hash'))) {
                    login_failed(client_ip());
                    throw new UserError('현재 비밀번호가 올바르지 않습니다.');
                }
                $new = (string)($_POST['password'] ?? '');
                if ($problem = password_problem($new, (string)($_POST['password_confirm'] ?? ''))) {
                    throw new UserError($problem);
                }
                AppConfig::set('admin.password_hash', password_hash($new, PASSWORD_DEFAULT));
                session_regenerate_id(true);
                flash('관리자 비밀번호를 바꿨습니다.');
                $anchor = 'security';
                break;

            default:
                throw new UserError('알 수 없는 요청입니다.');
        }
    } catch (UserError $e) {
        flash($e->getMessage());
    } catch (ProxmoxException $e) {
        flash('Proxmox 오류: ' . $e->getMessage());
    }
    admin_redirect('settings.php', [], $anchor);
}

// ─── 화면 데이터 ────────────────────────────────────────────
$flashes = take_flashes();
$csrf = csrf_token();
$settings = Settings::all();
$configured = proxmox_configured();
$pve = proxmox_settings();

$templates = [];
$nodes = [];
$storages = [];
$pools = [];
$pveError = null;
if ($configured) {
    try {
        $templates = proxmox()->templates();
        usort($templates, static fn($a, $b) => $a['vmid'] <=> $b['vmid']);
        try {
            $nodes = proxmox()->clusterNodes();
            ksort($nodes);
        } catch (ProxmoxException) {
            // Sys.Audit 권한이 없으면 노드 선택만 숨김
        }
        try {
            foreach (proxmox()->clusterStorages() as $s) {
                $content = (string)($s['content'] ?? 'images');
                if (str_contains($content, 'images')) {
                    $storages[(string)$s['storage']] = true;
                }
            }
            $storages = array_keys($storages);
            sort($storages);
        } catch (ProxmoxException) {
        }
        try {
            $pools = proxmox()->pools();
            sort($pools);
        } catch (ProxmoxException) {
        }
    } catch (ProxmoxException $e) {
        $pveError = explain($e);
    }
}
$pickedNodes = Settings::strList('placement_nodes');
$vncPath = (string)config('vnc_ws_path');
$authLine = $pve['token_id'] !== '' ? 'PVEAPIToken=' . $pve['token_id'] . '=' . $pve['token_secret'] : 'PVEAPIToken=<토큰 ID>=<토큰 secret>';
$upstream = $pve['host'] !== '' ? $pve['host'] : 'https://<Proxmox 주소>:8006';
$vncRegex = '^' . preg_quote($vncPath) . '/nodes/([A-Za-z0-9._-]+)/qemu/([0-9]+)/vncwebsocket$';

$dbPath = (string)config('db_path');
$dataDir = dirname($dbPath);
$sys = [
    ['PHP', PHP_VERSION, version_compare(PHP_VERSION, '8.1', '>=')],
    ['curl 확장', extension_loaded('curl') ? '사용 가능' : '없음 — php-curl 설치 필요', extension_loaded('curl')],
    ['pdo_sqlite 확장', extension_loaded('pdo_sqlite') ? '사용 가능' : '없음 — php-sqlite3 설치 필요', extension_loaded('pdo_sqlite')],
    ['데이터 폴더', app_relative($dataDir) . (is_writable($dataDir) ? ' (쓰기 가능)' : ' (쓰기 불가 — 웹 서버 사용자에게 권한 필요)'), is_writable($dataDir)],
    ['DB 파일', app_relative($dbPath) . (is_file($dbPath) ? ' · ' . fmt_bytes((int)filesize($dbPath)) : ''), true],
    ['config.php', is_file(APP_ROOT . '/config.php') ? '있음 (여기서 저장한 값이 우선)' : '없음 (필요 없음)', true],
];

admin_header('settings.php', '설정', $flashes);
?>
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="설정 항목">
      <a href="#proxmox">Proxmox 연결</a>
      <a href="#policy">운영 정책</a>
      <a href="#clone">VM 복제</a>
      <a href="#console">콘솔</a>
      <a href="#security">보안</a>
      <a href="#system">시스템 점검</a>
    </nav>

    <div class="stack-lg" style="min-width:0">

      <!-- ─── Proxmox 연결 ─────────────────────────────────── -->
      <div class="card" id="proxmox">
        <div class="row-between">
          <h2 class="h4">Proxmox 연결.</h2>
          <?php if (!$configured): ?>
            <span class="badge badge-outline"><span class="dot dot-off"></span>설정 필요</span>
          <?php elseif ($pveError): ?>
            <span class="badge badge-outline"><span class="dot dot-err"></span>연결 실패</span>
          <?php else: ?>
            <span class="badge badge-outline"><span class="dot dot-on"></span>연결됨</span>
          <?php endif; ?>
        </div>
        <?php if ($pveError): ?>
          <div class="form-error" style="margin-top:12px"><?= h($pveError) ?></div>
        <?php endif; ?>
        <form method="post" class="stack" style="margin-top:16px" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="proxmox">
          <label class="field">
            <span class="field-label">API 주소</span>
            <input class="input mono" name="host" value="<?= h($pve['host']) ?>" placeholder="https://10.0.0.10:8006" required spellcheck="false">
            <span class="hint" style="display:block;margin-top:6px">클러스터면 아무 노드나 괜찮습니다. 포트를 생략하면 8006 을 씁니다.</span>
          </label>
          <div class="grid grid-2">
            <label class="field">
              <span class="field-label">토큰 ID</span>
              <input class="input mono" name="token_id" value="<?= h($pve['token_id']) ?>" placeholder="vmrental@pve!web" required spellcheck="false">
            </label>
            <label class="field">
              <span class="field-label">토큰 secret</span>
              <input class="input mono" type="password" name="token_secret" autocomplete="new-password" spellcheck="false"
                     placeholder="<?= $pve['token_secret'] !== '' ? '저장됨 — 바꿀 때만 입력' : '00000000-0000-0000-0000-000000000000' ?>" <?= $pve['token_secret'] === '' ? 'required' : '' ?>>
            </label>
          </div>
          <div class="row-between">
            <label class="switch">
              <input type="checkbox" name="verify_ssl" <?= $pve['verify_ssl'] ? 'checked' : '' ?>>
              <span class="track"></span>TLS 인증서 검증
            </label>
            <label class="inline-form hint">시간 제한
              <input class="input input-sm" type="number" name="timeout" min="3" max="120" value="<?= (int)$pve['timeout'] ?>" style="width:84px">초
            </label>
          </div>
          <p class="hint">Proxmox 기본 인증서(자체 서명)를 쓰면 검증을 끄세요. 토큰 secret 은 이 서버의 SQLite 파일에만 저장됩니다.</p>
          <div class="row">
            <button class="btn btn-primary btn-sm" type="submit">저장하고 연결 확인</button>
            <?php if ($configured): ?>
              <button class="btn btn-soft btn-sm" type="submit" form="proxmox-test">다시 확인</button>
            <?php endif; ?>
          </div>
        </form>
        <form method="post" id="proxmox-test" hidden>
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="proxmox_test">
        </form>
        <details class="details" style="margin-top:16px">
          <summary>API 토큰 만드는 방법</summary>
          <p class="hint" style="margin-top:8px">Proxmox 노드 셸에서 실행하세요. 마지막 명령이 출력하는 <code>value</code> 가 토큰 secret 입니다.</p>
<pre class="snippet">pveum role add WSURental -privs "VM.Allocate VM.Clone VM.Audit VM.Console VM.PowerMgmt VM.Config.Disk VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.HWType VM.Config.Cloudinit VM.Config.CDROM Datastore.AllocateSpace Datastore.Audit Sys.Audit SDN.Use"
pveum user add vmrental@pve
pveum aclmod / -user vmrental@pve -role WSURental
pveum user token add vmrental@pve web --privsep 0</pre>
          <p class="hint">게스트 IP를 보려면 PVE 8 은 <code>VM.Monitor</code>, PVE 9 는 <code>VM.GuestAgent.Audit</code> 권한도 role 에 추가하세요.</p>
        </details>
      </div>

      <!-- ─── 운영 정책 ────────────────────────────────────── -->
      <form method="post" class="card stack" id="policy">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="policy">
        <div>
          <h2 class="h4">운영 정책.</h2>
          <p class="muted body-sm" style="margin-top:4px">새로 만들어지는 서버에 적용됩니다. 기존 서버에는 영향이 없습니다.</p>
        </div>
        <label class="field">
          <span class="field-label">템플릿</span>
          <?php $cur = (int)$settings['template_id']; ?>
          <?php if ($templates): ?>
            <select class="select" name="template_id" required>
              <?php $found = false; ?>
              <?php foreach ($templates as $t): $found = $found || (int)$t['vmid'] === $cur; ?>
                <option value="<?= (int)$t['vmid'] ?>" <?= (int)$t['vmid'] === $cur ? 'selected' : '' ?>>
                  <?= (int)$t['vmid'] ?> — <?= h($t['name'] ?? '') ?> (<?= h($t['node']) ?><?= !empty($t['maxdisk']) ? ', ' . h(fmt_bytes($t['maxdisk'])) : '' ?>)
                </option>
              <?php endforeach; ?>
              <?php if (!$found): ?>
                <option value="" selected disabled>템플릿을 고르세요</option>
              <?php endif; ?>
            </select>
            <span class="hint" style="display:block;margin-top:6px">Proxmox에서 템플릿으로 변환된 VM만 표시됩니다.</span>
          <?php else: ?>
            <input type="hidden" name="template_id" value="<?= $cur ?>">
            <div class="form-error"><?= !$configured || $pveError ? 'Proxmox에 연결되면 템플릿을 고를 수 있습니다.' : 'Proxmox에 템플릿이 없습니다. VM을 준비한 뒤 우클릭 → Convert to template 하세요.' ?></div>
          <?php endif; ?>
        </label>
        <label class="field">
          <span class="field-label">노드 분산</span>
          <select class="select" name="placement">
            <option value="auto" <?= $settings['placement'] === 'auto' ? 'selected' : '' ?>>자동 — 메모리 여유가 가장 많은 노드에 만들기</option>
            <option value="template" <?= $settings['placement'] === 'template' ? 'selected' : '' ?>>템플릿이 있는 노드에만 만들기</option>
          </select>
        </label>
        <?php if ($nodes): ?>
          <div class="field">
            <input type="hidden" name="nodes_listed" value="1">
            <span class="field-label">분산 대상 노드</span>
            <div class="row" style="gap:10px 16px">
              <?php foreach ($nodes as $n): ?>
                <label class="switch">
                  <input type="checkbox" name="placement_nodes[]" value="<?= h($n['node']) ?>" <?= !$pickedNodes || in_array((string)$n['node'], $pickedNodes, true) ? 'checked' : '' ?>>
                  <span class="track"></span><span class="mono"><?= h($n['node']) ?></span><?php if (($n['status'] ?? '') !== 'online'): ?><span class="muted">(오프라인)</span><?php endif; ?>
                </label>
              <?php endforeach; ?>
            </div>
            <span class="hint" style="display:block;margin-top:6px">자동일 때만 쓰입니다. 모두 켜 두면 나중에 클러스터에 추가되는 노드도 포함됩니다. 오프라인이거나 템플릿 디스크를 쓸 수 없는 노드는 자동으로 건너뜁니다.</span>
          </div>
        <?php elseif ($configured && !$pveError): ?>
          <p class="hint">노드 목록을 읽을 수 없어 노드 선택은 숨겼습니다 (API 토큰에 <code>Sys.Audit</code> 권한 필요).</p>
        <?php endif; ?>
        <div class="grid grid-3">
          <label class="field">
            <span class="field-label">대여 시간 (시간)</span>
            <input class="input" type="number" name="lease_hours" min="1" max="8760" value="<?= (int)$settings['lease_hours'] ?>" required>
          </label>
          <label class="field">
            <span class="field-label">최대 임시 VM 수</span>
            <input class="input" type="number" name="max_active_vms" min="0" max="10000" value="<?= (int)$settings['max_active_vms'] ?>" required>
          </label>
          <label class="field">
            <span class="field-label">IP당 하루 생성 수</span>
            <input class="input" type="number" name="per_ip_daily" min="0" max="1000" value="<?= (int)$settings['per_ip_daily'] ?>" required>
          </label>
        </div>
        <p class="hint">0 은 제한 없음입니다. 영구 서버는 최대 VM 수에 포함되지 않습니다.</p>
        <div class="row-between">
          <label class="switch">
            <input type="checkbox" name="creation_enabled" <?= (int)$settings['creation_enabled'] ? 'checked' : '' ?>>
            <span class="track"></span>새 서버 생성 허용
          </label>
          <button class="btn btn-primary btn-sm" type="submit">저장</button>
        </div>
      </form>

      <!-- ─── VM 복제 ──────────────────────────────────────── -->
      <form method="post" class="card stack" id="clone">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="clone">
        <h2 class="h4">VM 복제.</h2>
        <div class="field">
          <span class="field-label">복제 방식</span>
          <div class="segmented">
            <label class="seg-radio"><input type="radio" name="clone_mode" value="full" <?= config('vm.full_clone') ? 'checked' : '' ?>><span>Full clone</span></label>
            <label class="seg-radio"><input type="radio" name="clone_mode" value="linked" <?= config('vm.full_clone') ? '' : 'checked' ?>><span>Linked clone</span></label>
          </div>
          <span class="hint" style="display:block;margin-top:6px">Full 은 디스크를 통째로 복사해 독립적입니다. Linked 는 빠르고 공간을 아끼지만 템플릿과 같은 스토리지에만 만들 수 있습니다.</span>
        </div>
        <div class="grid grid-2">
          <label class="field">
            <span class="field-label">디스크 스토리지 <span class="muted">(Full clone)</span></span>
            <input class="input mono" name="storage" value="<?= h(config('vm.storage')) ?>" list="storage-list" placeholder="비우면 템플릿과 같은 곳" spellcheck="false">
            <datalist id="storage-list"><?php foreach ($storages as $s): ?><option value="<?= h($s) ?>"><?php endforeach; ?></datalist>
          </label>
          <label class="field">
            <span class="field-label">리소스 풀</span>
            <input class="input mono" name="pool" value="<?= h(config('vm.pool')) ?>" list="pool-list" placeholder="사용 안 함" spellcheck="false">
            <datalist id="pool-list"><?php foreach ($pools as $p): ?><option value="<?= h($p) ?>"><?php endforeach; ?></datalist>
          </label>
        </div>
        <div class="grid grid-3">
          <label class="field">
            <span class="field-label">이름 접두사</span>
            <input class="input mono" name="name_prefix" value="<?= h(config('vm.name_prefix')) ?>" maxlength="31" placeholder="예: tmp-" spellcheck="false">
          </label>
          <label class="field">
            <span class="field-label">VMID 시작</span>
            <input class="input" type="number" name="vmid_min" min="0" max="999999999" value="<?= (int)config('vm.vmid_min') ?>">
          </label>
          <label class="field">
            <span class="field-label">VMID 끝</span>
            <input class="input" type="number" name="vmid_max" min="0" max="999999999" value="<?= (int)config('vm.vmid_max') ?>">
          </label>
        </div>
        <p class="hint">접두사는 Proxmox 화면에 보이는 VM 이름 앞에 붙습니다 (이미 만든 VM에는 적용되지 않음). VMID 범위를 0 으로 두면 Proxmox가 다음 번호를 정합니다.</p>
        <div class="row" style="justify-content:flex-end">
          <button class="btn btn-primary btn-sm" type="submit">저장</button>
        </div>
      </form>

      <!-- ─── 콘솔 ─────────────────────────────────────────── -->
      <div class="card" id="console">
        <form method="post" class="stack">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="console">
          <div>
            <h2 class="h4">콘솔 (noVNC).</h2>
            <p class="muted body-sm" style="margin-top:4px">브라우저는 WebSocket 에 인증 헤더를 실을 수 없어서, 웹 서버가 이 경로를 Proxmox로 넘기며 토큰을 붙여 줘야 합니다.</p>
          </div>
          <div class="grid grid-2">
            <label class="field">
              <span class="field-label">WebSocket 경로</span>
              <input class="input mono" name="vnc_ws_path" value="<?= h($vncPath) ?>" required spellcheck="false">
            </label>
            <label class="field">
              <span class="field-label">noVNC 모듈 (rfb.js)</span>
              <input class="input mono" name="novnc_module" value="<?= h(config('novnc_module')) ?>" spellcheck="false">
            </label>
          </div>
          <p class="hint">인터넷이 막힌 곳이면 noVNC를 <code>public/vendor/novnc</code> 에 두고 <code>/vendor/novnc/core/rfb.js</code> 로 바꾸세요.</p>
          <div class="row" style="justify-content:flex-end">
            <button class="btn btn-primary btn-sm" type="submit">저장</button>
          </div>
        </form>
        <details class="details" style="margin-top:16px">
          <summary>웹 서버 설정 예시 (현재 값 반영 · 토큰 포함)</summary>
          <p class="hint" style="margin-top:8px">토큰을 바꾸면 웹 서버 설정의 <code>Authorization</code> 값도 함께 바꿔야 콘솔이 열립니다. 전체 예시는 <code>deploy/</code> 폴더에 있습니다.</p>
          <p class="field-label" style="margin-top:12px">Caddy</p>
<pre class="snippet">@vnc path_regexp vnc <?= h($vncRegex) ?>

handle @vnc {
	rewrite * /api2/json/nodes/{re.vnc.1}/qemu/{re.vnc.2}/vncwebsocket?{query}
	reverse_proxy <?= h($upstream) ?> {
		header_up Host {upstream_hostport}
		header_up -Cookie
		header_up Authorization "<?= h($authLine) ?>"
		transport http {
			tls_insecure_skip_verify
		}
	}
}
handle <?= h($vncPath) ?>/* {
	respond 404
}</pre>
          <p class="field-label" style="margin-top:12px">nginx</p>
<pre class="snippet">location ~ <?= h($vncRegex) ?> {
    proxy_pass <?= h($upstream) ?>/api2/json/nodes/$1/qemu/$2/vncwebsocket$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $proxy_host;
    proxy_set_header Cookie     "";
    proxy_set_header Authorization "<?= h($authLine) ?>";
    proxy_ssl_verify   off;
    proxy_buffering    off;
    proxy_read_timeout 3600s;
}</pre>
        </details>
      </div>

      <!-- ─── 보안 ─────────────────────────────────────────── -->
      <div class="card stack" id="security">
        <h2 class="h4">보안.</h2>
        <form method="post" class="stack">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="security">
          <label class="field">
            <span class="field-label">클라이언트 IP 헤더</span>
            <select class="select" name="client_ip_header">
              <?php foreach (IP_HEADERS as $k => $label): ?>
                <option value="<?= h($k) ?>" <?= (string)config('client_ip_header') === $k ? 'selected' : '' ?>><?= h($label) ?></option>
              <?php endforeach; ?>
            </select>
            <span class="hint" style="display:block;margin-top:6px">IP당 생성 제한과 로그인 시도 제한에 쓰입니다. Cloudflare 같은 프록시 뒤에 있을 때만 고르세요. 프록시 없이 헤더를 쓰면 누구나 IP를 속여 제한을 피할 수 있습니다. 지금 보이는 내 IP: <code><?= h(client_ip()) ?></code></span>
          </label>
          <div class="row" style="justify-content:flex-end">
            <button class="btn btn-primary btn-sm" type="submit">저장</button>
          </div>
        </form>
        <hr class="rule">
        <form method="post" class="stack" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="password">
          <span class="field-label">관리자 비밀번호 변경</span>
          <div class="grid grid-3">
            <input class="input" type="password" name="current" autocomplete="current-password" placeholder="현재 비밀번호" aria-label="현재 비밀번호" required>
            <input class="input" type="password" name="password" autocomplete="new-password" minlength="<?= ADMIN_PW_MIN ?>" placeholder="새 비밀번호 (<?= ADMIN_PW_MIN ?>자 이상)" aria-label="새 비밀번호" required>
            <input class="input" type="password" name="password_confirm" autocomplete="new-password" minlength="<?= ADMIN_PW_MIN ?>" placeholder="새 비밀번호 확인" aria-label="새 비밀번호 확인" required>
          </div>
          <div class="row" style="justify-content:flex-end">
            <button class="btn btn-primary btn-sm" type="submit">비밀번호 변경</button>
          </div>
        </form>
      </div>

      <!-- ─── 시스템 점검 ──────────────────────────────────── -->
      <div class="card-soft" id="system">
        <h2 class="h4">시스템 점검.</h2>
        <dl class="kv" style="margin-top:12px">
          <?php foreach ($sys as [$label, $value, $ok]): ?>
            <dt><?= h($label) ?></dt><dd><?= $ok ? '' : '<span class="dot dot-err" style="margin-right:8px"></span>' ?><?= h($value) ?></dd>
          <?php endforeach; ?>
          <dt>정기 작업 (cron)</dt>
          <dd><?php $lastCron = Settings::int('last_cron'); ?><?= $lastCron ? h(date('Y-m-d H:i:s', $lastCron)) . (time() - $lastCron > 600 ? ' — 멈춤' : ' — 동작 중') : '<span class="dot dot-err" style="margin-right:8px"></span>등록 안 됨' ?></dd>
        </dl>
        <p class="hint" style="margin-top:12px">cron 등록 (한 번만):</p>
        <code class="code-line"><?= h(sprintf('echo "* * * * * www-data php %s/bin/cron.php >> %s/cron.log 2>&1" | sudo tee /etc/cron.d/wsu-server', APP_ROOT, $dataDir)) ?></code>
      </div>
    </div>
  </div>
</section>
<?php page_foot();
