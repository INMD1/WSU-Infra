<?php
declare(strict_types=1);

require __DIR__ . '/../../src/bootstrap.php';
require __DIR__ . '/../../src/admin.php';

admin_boot('');   // 로그인 · 초기 설정 · 로그아웃 처리 (로그인 안 됐으면 여기서 끝남)

// ─── POST 처리 ──────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = (string)($_POST['action'] ?? '');

    try {
        if ($action === 'creation') {
            $on = ($_POST['enabled'] ?? '') === '1';
            Settings::set('creation_enabled', $on ? 1 : 0);
            flash($on ? '새 서버 생성을 다시 허용했습니다.' : '새 서버 생성을 중단했습니다. 이미 만든 서버는 그대로 동작합니다.');
        } elseif ($action === 'tick') {
            $log = vms()->tick();
            flash($log ? '정리 작업 실행: ' . count($log) . '건 처리' : '정리 작업 실행: 처리할 항목이 없습니다.');
        } else {
            $vm = VmService::find((int)($_POST['id'] ?? 0));
            if (!$vm || $vm['state'] === 'deleted') {
                throw new UserError('VM을 찾을 수 없습니다.');
            }
            switch ($action) {
                case 'extend':
                    $hours = max(1, min(8760, (int)($_POST['hours'] ?? 24)));
                    vms()->extend($vm, $hours * 3600);
                    flash("{$vm['name']}: 대여 기간을 {$hours}시간 연장했습니다.");
                    break;
                case 'permanent':
                    vms()->makePermanent($vm);
                    flash("{$vm['name']}: 영구 서버로 전환했습니다.");
                    break;
                case 'temporary':
                    vms()->makeTemporary($vm);
                    flash("{$vm['name']}: 임시 서버로 되돌렸습니다 (" . Settings::int('lease_hours') . '시간 뒤 만료).');
                    break;
                case 'delete':
                    vms()->requestDelete($vm);
                    flash("{$vm['name']}: 삭제를 시작했습니다.");
                    break;
                default:
                    throw new UserError('알 수 없는 동작입니다.');
            }
        }
    } catch (UserError $e) {
        flash($e->getMessage());
    } catch (ProxmoxException $e) {
        flash('Proxmox 오류: ' . $e->getMessage());
    }
    admin_redirect('', ($_POST['view'] ?? '') === 'deleted' ? ['view' => 'deleted'] : []);
}

$flashes = take_flashes();

// ─── 대시보드 데이터 ────────────────────────────────────────
vms()->maybeTick();
$view = ($_GET['view'] ?? '') === 'deleted' ? 'deleted' : 'active';

$live = [];
$nodes = [];
$pveError = null;
$configured = proxmox_configured();
if ($configured) {
    try {
        $live = proxmox()->clusterVms();
        try {
            $nodes = proxmox()->clusterNodes();
            ksort($nodes);
        } catch (ProxmoxException) {
            // Sys.Audit 권한이 없으면 노드 목록만 생략
        }
    } catch (ProxmoxException $e) {
        $pveError = $e->getMessage();
    }
}
$templates = array_values(array_filter($live, static fn($r) => !empty($r['template'])));
usort($templates, static fn($a, $b) => $a['vmid'] <=> $b['vmid']);

$active = Db::all("SELECT * FROM vms WHERE state <> 'deleted' ORDER BY (expires_at IS NULL), expires_at, id DESC");
$rows = $view === 'deleted'
    ? Db::all("SELECT * FROM vms WHERE state = 'deleted' AND deleted_at > ? ORDER BY deleted_at DESC LIMIT 200", [time() - 30 * 86400])
    : $active;

$stats = ['active' => count($active), 'running' => 0, 'soon' => 0, 'permanent' => 0];
foreach ($active as $r) {
    if (($live[(int)$r['vmid']]['status'] ?? '') === 'running') {
        $stats['running']++;
    }
    if ($r['expires_at'] === null) {
        $stats['permanent']++;
    } elseif ((int)$r['expires_at'] - time() < 3 * 3600) {
        $stats['soon']++;
    }
}
$settings = Settings::all();
$lastTick = Settings::int('last_tick');
$lastCron = Settings::int('last_cron');
$csrf = csrf_token();
$deletedCount = (int)Db::scalar("SELECT COUNT(*) FROM vms WHERE state = 'deleted' AND deleted_at > ?", [time() - 30 * 86400]);
$creationOn = (bool)(int)$settings['creation_enabled'];

// ─── 설정 점검: 하나라도 안 되어 있으면 위쪽에 안내 카드 ─────
$curTemplate = null;
foreach ($templates as $t) {
    if ((int)$t['vmid'] === (int)$settings['template_id']) {
        $curTemplate = $t;
    }
}
$dataDir = dirname((string)config('db_path'));
$checks = [
    [
        'ok'   => $configured && $pveError === null,
        'name' => 'Proxmox 연결',
        'text' => !$configured ? 'API 주소와 토큰을 입력하세요.' : ($pveError !== null ? '연결 실패 — ' . $pveError : '연결됨 · ' . config('proxmox.host')),
        'href' => url('admin/settings.php#proxmox'),
    ],
    [
        'ok'   => $curTemplate !== null,
        'name' => '템플릿',
        'text' => $curTemplate !== null
            ? $curTemplate['vmid'] . ' — ' . ($curTemplate['name'] ?? '')
            : ($configured && $pveError === null ? '새 VM을 복제할 템플릿을 고르세요.' : 'Proxmox에 연결되면 고를 수 있습니다.'),
        'href' => url('admin/settings.php#policy'),
    ],
    [
        'ok'   => time() - $lastCron <= 600,
        'name' => '정리 작업 (cron)',
        'text' => $lastCron
            ? (time() - $lastCron <= 600 ? '동작 중' : '최근 10분 동안 실행되지 않았습니다. 지금은 누군가 페이지를 열 때만 만료된 VM이 정리됩니다.')
            : '아직 등록되지 않았습니다. 만료된 VM이 제때 삭제되도록 서버에서 아래 명령을 한 번 실행하세요.',
        'code' => sprintf('echo "* * * * * www-data php %s/bin/cron.php >> %s/cron.log 2>&1" | sudo tee /etc/cron.d/wsu-server', APP_ROOT, $dataDir),
    ],
];
$allOk = !array_filter($checks, static fn($c) => !$c['ok']);

ob_start(); ?>
      <form method="post" class="inline-form">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="creation">
        <input type="hidden" name="enabled" value="<?= $creationOn ? '0' : '1' ?>">
        <?php if ($creationOn): ?>
          <button class="btn btn-soft btn-sm" type="submit" data-confirm="새 서버 생성을 중단할까요? 이미 만든 서버는 그대로 동작합니다.">생성 중단</button>
        <?php else: ?>
          <button class="btn btn-primary btn-sm" type="submit">생성 재개</button>
        <?php endif; ?>
      </form>
      <form method="post" class="inline-form">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="tick">
        <input type="hidden" name="view" value="<?= h($view) ?>">
        <button class="btn btn-soft btn-sm" type="submit" title="만료된 VM 삭제 및 진행 중 작업 갱신">지금 정리 실행</button>
      </form>
<?php
admin_header('', '전체 서버', $flashes, (string)ob_get_clean());
?>
  <?php if (!$allOk): ?>
    <div class="card" style="margin-top:16px">
      <h2 class="h4">설정 점검.</h2>
      <p class="muted body-sm" style="margin-top:4px">아래 항목이 모두 끝나야 서버가 만들어지고 만료된 서버가 제때 정리됩니다.</p>
      <ul class="checklist">
        <?php foreach ($checks as $c): ?>
          <li>
            <span class="dot <?= $c['ok'] ? 'dot-on' : 'dot-err' ?>" aria-hidden="true"></span>
            <div style="min-width:0;flex:1">
              <span class="em"><?= h($c['name']) ?></span> <span class="muted"><?= $c['ok'] ? '완료' : '필요' ?></span>
              <div class="muted body-sm" style="margin-top:2px"><?= h($c['text']) ?></div>
              <?php if (!$c['ok'] && !empty($c['code'])): ?><code class="code-line"><?= h($c['code']) ?></code><?php endif; ?>
            </div>
            <?php if (!$c['ok'] && !empty($c['href'])): ?><a class="btn btn-soft btn-xs" href="<?= h($c['href']) ?>">설정하기</a><?php endif; ?>
          </li>
        <?php endforeach; ?>
      </ul>
    </div>
  <?php endif; ?>
  <?php if (!$creationOn): ?>
    <div class="form-error" style="margin-top:16px">새 서버 생성이 중단된 상태입니다. 사용자는 기존 서버만 열 수 있습니다.</div>
  <?php endif; ?>

  <div id="live">
    <div class="grid grid-4" style="margin-top:32px">
      <div class="stat"><div class="stat-label">활성 VM</div><div class="stat-value"><?= $stats['active'] ?></div><div class="stat-sub">임시 VM 한도 <?= (int)$settings['max_active_vms'] ?: '없음' ?></div></div>
      <div class="stat"><div class="stat-label">실행 중</div><div class="stat-value"><?= $stats['running'] ?></div><div class="stat-sub">Proxmox 실시간 상태</div></div>
      <div class="stat"><div class="stat-label">3시간 내 만료</div><div class="stat-value"><?= $stats['soon'] ?></div><div class="stat-sub">곧 자동 삭제됨</div></div>
      <div class="stat"><div class="stat-label">영구 서버</div><div class="stat-value"><?= $stats['permanent'] ?></div><div class="stat-sub">자동 삭제 제외</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <div class="segmented">
          <a href="<?= h(url('admin/')) ?>" class="<?= $view === 'active' ? 'active' : '' ?>">활성 <span class="muted"><?= $stats['active'] ?></span></a>
          <a href="<?= h(url('admin/?view=deleted')) ?>" class="<?= $view === 'deleted' ? 'active' : '' ?>">삭제됨 <span class="muted"><?= $deletedCount ?></span></a>
        </div>
        <span class="caption muted">10초마다 자동 갱신 · <?= h(date('H:i:s')) ?></span>
      </div>

      <?php if (!$rows): ?>
        <div class="empty"><p class="muted"><?= $view === 'deleted' ? '최근 30일 동안 삭제된 서버가 없습니다.' : '아직 만들어진 서버가 없습니다.' ?></p></div>
      <?php elseif ($view === 'deleted'): ?>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>이름</th><th>VMID · 노드</th><th>템플릿</th><th>생성 IP</th><th>생성</th><th>삭제</th></tr></thead>
            <tbody>
            <?php foreach ($rows as $r): ?>
              <tr>
                <td class="cell-name"><?= h($r['name']) ?></td>
                <td class="num"><?= (int)$r['vmid'] ?> · <?= h($r['node']) ?></td>
                <td class="num"><?= (int)$r['template_id'] ?></td>
                <td class="mono"><?= h($r['creator_ip']) ?></td>
                <td class="num"><?= h(fmt_time((int)$r['created_at'])) ?></td>
                <td class="num"><?= h(fmt_time((int)$r['deleted_at'])) ?></td>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      <?php else: ?>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>이름</th><th>VMID · 노드</th><th>상태</th><th>CPU</th><th>메모리</th><th>남은 시간</th><th style="text-align:right">관리</th></tr></thead>
            <tbody>
            <?php foreach ($rows as $r):
                $l = $live[(int)$r['vmid']] ?? null;
                $running = ($l['status'] ?? '') === 'running';
                // 노드가 오프라인이면 Proxmox가 cpu/mem/maxmem 없이 status=unknown 만 줌
                $mem = (int)($l['mem'] ?? 0);
                $maxmem = (int)($l['maxmem'] ?? 0);
                $cpu = $running ? (float)($l['cpu'] ?? 0) * 100 : 0;
                $memPct = $running && $maxmem > 0 ? $mem / $maxmem * 100 : 0;
                $busy = in_array($r['state'], ['creating', 'starting', 'deleting', 'destroying'], true);
                $permanent = $r['expires_at'] === null;
                ?>
              <tr>
                <td>
                  <a class="cell-name" href="<?= h(vm_url($r['name'])) ?>" target="_blank" rel="noopener"><?= h($r['name']) ?></a>
                  <div class="caption muted"><span class="mono"><?= h($r['creator_ip']) ?></span> · <?= h(date('m-d H:i', (int)$r['created_at'])) ?> 생성</div>
                </td>
                <td class="num"><?= (int)$r['vmid'] ?> · <?= h($r['node']) ?><div class="caption muted">템플릿 <?= (int)$r['template_id'] ?></div></td>
                <td>
                  <?php if ($r['state'] === 'ready'): ?>
                    <span class="badge <?= $running ? 'badge-ink' : '' ?>"><span class="dot <?= $running ? 'dot-on' : 'dot-off' ?>"></span><?= $l ? ($running ? '실행 중' : (($l['status'] ?? '') === 'stopped' ? '정지됨' : h((string)($l['status'] ?? '알 수 없음')))) : 'Proxmox에 없음' ?></span>
                  <?php else: ?>
                    <span class="badge"><span class="dot <?= $busy ? 'dot-busy' : 'dot-err' ?>"></span><?= h(state_label($r['state'])) ?></span>
                  <?php endif; ?>
                  <?php if ($r['last_error']): ?><div class="caption muted" style="max-width:220px;margin-top:4px" title="<?= h($r['last_error']) ?>"><?= h(mb_strimwidth($r['last_error'], 0, 60, '…')) ?></div><?php endif; ?>
                </td>
                <td class="num"><?= $running ? number_format($cpu, 1) . '%' : '—' ?><?php if ($running): ?><div class="mini-meter"><span style="width:<?= min(100, $cpu) ?>%"></span></div><?php endif; ?></td>
                <td class="num"><?= $running ? h(fmt_bytes($mem)) . ' / ' . h(fmt_bytes($maxmem)) : ($maxmem > 0 ? h(fmt_bytes($maxmem)) : '—') ?><?php if ($running): ?><div class="mini-meter"><span style="width:<?= $memPct ?>%"></span></div><?php endif; ?></td>
                <td class="num">
                  <?php if ($permanent): ?>
                    <span class="badge badge-ink">영구</span>
                  <?php else: ?>
                    <?= h(fmt_remaining((int)$r['expires_at'])) ?>
                    <div class="caption muted"><?= h(date('m-d H:i', (int)$r['expires_at'])) ?> 삭제</div>
                  <?php endif; ?>
                </td>
                <td>
                  <div class="actions">
                    <?php if (!in_array($r['state'], ['deleting', 'destroying'], true)): ?>
                      <form method="post" class="inline-form">
                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                        <input type="hidden" name="action" value="extend">
                        <select class="select select-sm" name="hours" aria-label="연장 시간" <?= $permanent ? 'disabled' : '' ?>>
                          <option value="1">+1시간</option><option value="6">+6시간</option>
                          <option value="24" selected>+1일</option><option value="72">+3일</option>
                          <option value="168">+7일</option><option value="720">+30일</option>
                        </select>
                        <button class="btn btn-soft btn-xs" type="submit" <?= $permanent ? 'disabled' : '' ?>>연장</button>
                      </form>
                      <form method="post" class="inline-form">
                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                        <?php if ($permanent): ?>
                          <input type="hidden" name="action" value="temporary">
                          <button class="btn btn-soft btn-xs" type="submit" data-confirm="<?= h($r['name']) ?> 을(를) 임시 서버로 되돌릴까요? <?= Settings::int('lease_hours') ?>시간 뒤 자동 삭제됩니다.">임시로</button>
                        <?php else: ?>
                          <input type="hidden" name="action" value="permanent">
                          <button class="btn btn-soft btn-xs" type="submit" data-confirm="<?= h($r['name']) ?> 을(를) 영구 서버로 전환할까요? 자동 삭제되지 않습니다.">영구화</button>
                        <?php endif; ?>
                      </form>
                      <form method="post" class="inline-form">
                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                        <input type="hidden" name="action" value="delete">
                        <button class="btn btn-outline btn-xs" type="submit" data-confirm="<?= h($r['name']) ?> (VMID <?= (int)$r['vmid'] ?>) 을(를) 삭제할까요? VM과 디스크가 완전히 삭제되며 되돌릴 수 없습니다.">삭제</button>
                      </form>
                    <?php else: ?>
                      <span class="caption muted">삭제 진행 중…</span>
                    <?php endif; ?>
                  </div>
                </td>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      <?php endif; ?>
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:16px;align-items:start">
    <div class="card">
      <div class="row-between">
        <h2 class="h4">운영 정책.</h2>
        <a class="btn btn-soft btn-xs" href="<?= h(url('admin/settings.php#policy')) ?>">변경</a>
      </div>
      <dl class="kv" style="margin-top:12px">
        <dt>새 서버 생성</dt><dd><?= $creationOn ? '허용' : '중단됨' ?></dd>
        <dt>템플릿</dt><dd><?= $curTemplate ? (int)$curTemplate['vmid'] . ' — ' . h($curTemplate['name'] ?? '') : '<span class="muted">선택 안 됨</span>' ?></dd>
        <dt>대여 시간</dt><dd><?= (int)$settings['lease_hours'] ?>시간</dd>
        <dt>최대 임시 VM</dt><dd><?= (int)$settings['max_active_vms'] ?: '제한 없음' ?></dd>
        <dt>IP당 하루 생성</dt><dd><?= (int)$settings['per_ip_daily'] ?: '제한 없음' ?></dd>
      </dl>
    </div>

    <div class="card-soft">
      <h2 class="h4">시스템.</h2>
      <dl class="kv" style="margin-top:12px">
        <dt>Proxmox</dt><dd class="mono"><?= $configured ? h(config('proxmox.host')) : '<span class="muted">설정 안 됨</span>' ?></dd>
        <dt>API 토큰</dt><dd class="mono"><?= h(config('proxmox.token_id')) ?></dd>
        <dt>연결 상태</dt><dd><?= !$configured ? '설정 필요' : ($pveError ? '연결 실패' : '정상 · VM ' . count($live) . '대, 템플릿 ' . count($templates) . '개') ?></dd>
        <dt>복제 방식</dt><dd><?= config('vm.full_clone') ? 'Full clone' : 'Linked clone' ?><?= config('vm.storage') ? ' → ' . h(config('vm.storage')) : '' ?></dd>
        <dt>노드 분산</dt><dd><?= $settings['placement'] === 'auto' ? '자동 (메모리 여유 순) · ' . (Settings::strList('placement_nodes') ? h(implode(', ', Settings::strList('placement_nodes'))) : '모든 노드') : '템플릿 노드에만' ?></dd>
        <?php foreach ($nodes as $n): ?>
          <?php $nMem = (int)($n['maxmem'] ?? 0) > 0 ? (int)($n['mem'] ?? 0) / (int)$n['maxmem'] * 100 : 0; ?>
          <dt class="mono"><?= h($n['node']) ?></dt>
          <dd><?php if (($n['status'] ?? '') === 'online'): ?>
            CPU <?= number_format((float)($n['cpu'] ?? 0) * 100, 0) ?>% · 메모리 <?= number_format($nMem, 0) ?>% · VM <?= count(array_filter($live, static fn($r) => empty($r['template']) && $r['node'] === $n['node'])) ?>대
          <?php else: ?><span class="muted">오프라인</span><?php endif; ?></dd>
        <?php endforeach; ?>
        <dt>마지막 정리 작업</dt><dd><?= $lastTick ? h(date('Y-m-d H:i:s', $lastTick)) : '실행된 적 없음' ?></dd>
        <dt>마지막 cron 실행</dt><dd><?= $lastCron ? h(date('Y-m-d H:i:s', $lastCron)) : '실행된 적 없음' ?></dd>
      </dl>
    </div>
  </div>
</section>

<script>
// 표 영역 자동 갱신 (사용자가 폼을 조작 중이면 건너뜀)
(function () {
  let busy = false;
  const live = document.getElementById('live');
  live.addEventListener('focusin', () => { busy = true; });
  live.addEventListener('focusout', () => { busy = false; });
  setInterval(async () => {
    if (busy || document.hidden) return;
    try {
      const res = await fetch(location.href, { credentials: 'same-origin' });
      if (!res.ok || res.redirected) return;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('live');
      if (next && !busy) live.innerHTML = next.innerHTML;
    } catch (_) { /* 다음 주기에 재시도 */ }
  }, 10000);
})();
</script>
<?php page_foot();
