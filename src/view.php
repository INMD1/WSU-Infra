<?php
declare(strict_types=1);

/** 공통 레이아웃: <head> + 플로팅 nav pill */
function page_head(string $title, array $opt = []): void
{
    $nav = $opt['nav'] ?? [
        ['href' => url('index.php#open'), 'label' => '내 서버 열기'],
    ];
    $cta = array_key_exists('cta', $opt) ? $opt['cta'] : ['href' => url('index.php'), 'label' => '서버 만들기'];
    $bodyClass = $opt['body_class'] ?? '';
    ?>
<!doctype html>
<html lang="ko" data-base="<?= h(base_path()) ?>" data-novnc="<?= h(config('novnc_module', NOVNC_DEFAULT)) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= h($title) ?></title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="<?= h(url('assets/app.css')) ?>?v=2">
<script src="<?= h(url('assets/app.js')) ?>?v=1" defer></script>
</head>
<body class="<?= h($bodyClass) ?>">
<?php if (empty($opt['bare'])): ?>
<header class="nav-wrap">
  <nav class="nav-pill" aria-label="주 메뉴">
    <a class="brand" href="<?= h(url('index.php')) ?>">
      <span class="squircle squircle-sm" aria-hidden="true"><?= icon_server() ?></span>
      <span class="brand-name">WSU Server</span>
    </a>
    <div class="nav-links">
      <?php foreach ($nav as $item): ?>
        <a class="nav-link" href="<?= h($item['href']) ?>"><?= h($item['label']) ?></a>
      <?php endforeach; ?>
      <?php if ($cta): ?>
        <a class="btn btn-primary btn-sm" href="<?= h($cta['href']) ?>"><?= h($cta['label']) ?></a>
      <?php endif; ?>
    </div>
  </nav>
</header>
<?php endif; ?>
<main class="page">
<?php
}

function page_foot(array $opt = []): void
{
    ?>
</main>
<?php if (empty($opt['bare'])): ?>
<footer class="footer">
  <div class="footer-inner">
    <div>
      <div class="footer-mark">WSU Server.</div>
      <p class="footer-tag">이름 하나로 만드는 하루짜리 서버.</p>
    </div>
    <div class="footer-cols">
      <div>
        <a class="em" href="<?= h(url('index.php')) ?>">서버 만들기</a>
        <a href="<?= h(url('index.php#open')) ?>">내 서버 열기</a>
      </div>
      <div>
        <a class="em" href="<?= h(url('admin/')) ?>">관리자</a>
        <span>Powered by Proxmox VE</span>
      </div>
    </div>
  </div>
</footer>
<?php endif; ?>
<div class="toast-stack" id="toasts" aria-live="polite"></div>
</body>
</html>
<?php
}

function icon_server(): string
{
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>';
}

/** 상태 코드 → 사용자 표기 */
function state_label(string $state): string
{
    return [
        'creating'   => '복제 중',
        'starting'   => '부팅 중',
        'ready'      => '준비됨',
        'error'      => '오류',
        'deleting'   => '삭제 중',
        'destroying' => '삭제 중',
        'deleted'    => '삭제됨',
    ][$state] ?? $state;
}

function fmt_time(?int $ts): string
{
    return $ts ? date('Y-m-d H:i', $ts) : '—';
}

function fmt_remaining(?int $expires): string
{
    if ($expires === null) {
        return '영구';
    }
    $s = $expires - time();
    if ($s <= 0) {
        return '만료됨';
    }
    $d = intdiv($s, 86400);
    $hh = intdiv($s % 86400, 3600);
    $mm = intdiv($s % 3600, 60);
    return ($d ? "{$d}일 " : '') . ($hh || $d ? "{$hh}시간 " : '') . "{$mm}분";
}

function fmt_bytes(int|float $b): string
{
    $u = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($b >= 1024 && $i < count($u) - 1) {
        $b /= 1024;
        $i++;
    }
    return ($i ? number_format($b, $b < 10 ? 1 : 0) : (string)(int)$b) . ' ' . $u[$i];
}

/** noVNC 콘솔 셸 (대시보드 / 전체 화면 페이지 공용) */
function console_shell(string $name, bool $full = false): void
{
    ?>
<div class="console-shell" data-console>
  <div class="console-bar">
    <div class="title"><span class="dot dot-off" data-status-dot></span><span data-status>연결 안 됨</span></div>
    <div class="row" style="gap:6px">
      <button type="button" class="btn btn-soft btn-xs" data-act="cad" data-needs-conn disabled>Ctrl+Alt+Del</button>
      <button type="button" class="btn btn-soft btn-xs hide-sm" data-act="type" data-needs-conn disabled>텍스트 입력</button>
      <button type="button" class="btn btn-soft btn-xs" data-act="fullscreen">전체 화면</button>
      <?php if (!$full): ?>
        <a class="btn btn-soft btn-xs hide-sm" href="<?= h(url('console.php?name=' . rawurlencode($name))) ?>" target="_blank" rel="noopener">새 창 ↗</a>
      <?php endif; ?>
      <button type="button" class="btn btn-soft btn-xs" data-act="disconnect" data-needs-conn disabled>연결 끊기</button>
    </div>
  </div>
  <div class="console-screen">
    <div data-screen></div>
    <div class="console-overlay" data-overlay>
      <span class="spin" data-o-spin hidden></span>
      <h3 class="h4" data-o-title>콘솔이 준비되었습니다.</h3>
      <p class="body-sm" data-o-text></p>
      <button type="button" class="btn btn-on-soft" data-o-btn>콘솔 연결</button>
    </div>
  </div>
</div>
<?php
}
