<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$name = VmService::normalizeName((string)($_GET['name'] ?? ''));
$vm = $name !== '' ? VmService::findByName($name) : null;

if (!$vm) {
    http_response_code(404);
    page_head('서버를 찾을 수 없음 — WSU Server');
    ?>
<section class="container container-narrow hero">
  <span class="squircle squircle-lg squircle-soft" style="margin:0 auto"><?= icon_server() ?></span>
  <h1 class="h2" style="margin-top:32px">서버를 찾을 수 없습니다.</h1>
  <p class="lead">
    <?= $name !== '' ? '<strong>' . h($name) . '</strong> 이라는 서버가 없습니다. ' : '' ?>이름을 다시 확인하세요. 대여 기간이 끝나 자동으로 삭제되었을 수도 있습니다.
  </p>
  <div class="row" style="justify-content:center;margin-top:32px">
    <?php if (preg_match(VmService::NAME_PATTERN, $name)): ?>
      <a class="btn btn-primary" href="<?= h(url('index.php?name=' . rawurlencode($name))) ?>">이 이름으로 새로 만들기</a>
    <?php endif; ?>
    <a class="btn btn-outline" href="<?= h(url('index.php#open')) ?>">다른 이름으로 열기</a>
  </div>
</section>
<?php
    page_foot();
    exit;
}

$shareUrl = vm_url($vm['name'], true);
page_head($vm['name'] . ' — WSU Server');
?>
<section class="container section" style="padding-top:56px">
  <div class="row-between" style="align-items:flex-end">
    <div class="stack-sm" style="min-width:0">
      <div class="row" style="gap:8px">
        <span class="badge" id="state-badge"><span class="dot dot-busy"></span><span>불러오는 중</span></span>
        <span class="badge badge-outline" id="lease-badge">—</span>
      </div>
      <h1 class="h1" style="margin-top:16px;word-break:break-all"><?= h($vm['name']) ?>.</h1>
      <p class="muted body-sm">VMID <?= (int)$vm['vmid'] ?> · 노드 <?= h($vm['node']) ?> · <?= h(fmt_time((int)$vm['created_at'])) ?> 생성</p>
    </div>
    <div class="row" id="power" style="gap:8px" hidden>
      <button class="btn btn-primary btn-sm" data-power="start" hidden>시작</button>
      <button class="btn btn-soft btn-sm" data-power="shutdown" hidden>종료</button>
      <button class="btn btn-soft btn-sm" data-power="reboot" hidden>재부팅</button>
      <button class="btn btn-outline btn-sm" data-power="stop" hidden data-confirm="강제 종료하면 저장하지 않은 데이터가 사라질 수 있습니다. 계속할까요?">강제 종료</button>
    </div>
  </div>

  <div class="link-pill" style="margin-top:24px">
    <span class="label muted hide-sm">접속 링크</span>
    <code><?= h($shareUrl) ?></code>
    <button class="btn btn-primary btn-xs" data-copy="<?= h($shareUrl) ?>">복사</button>
  </div>
  <p class="hint" style="margin-top:8px;padding-left:16px">이 링크나 서버 이름을 아는 사람은 누구나 이 서버에 접속할 수 있습니다.</p>

  <div class="form-error" id="page-error" style="margin-top:24px" hidden></div>

  <!-- 생성 진행 중 -->
  <div class="card-soft" id="view-provision" style="margin-top:32px" hidden>
    <h2 class="h4">서버를 준비하고 있습니다.</h2>
    <p class="muted body-sm" style="margin-top:6px">템플릿을 복제하고 부팅합니다. 보통 1~3분 정도 걸리며, 이 페이지를 닫아도 계속 진행됩니다.</p>
    <div class="steps" style="margin-top:20px">
      <div class="step" data-step="creating"><span class="squircle">1</span><div><div class="label" style="font-size:14px">템플릿 복제</div><div class="caption muted">디스크 생성</div></div></div>
      <div class="step" data-step="starting"><span class="squircle">2</span><div><div class="label" style="font-size:14px">부팅</div><div class="caption muted">전원 켜기</div></div></div>
      <div class="step" data-step="ready"><span class="squircle">3</span><div><div class="label" style="font-size:14px">준비 완료</div><div class="caption muted">콘솔 접속 가능</div></div></div>
    </div>
  </div>

  <!-- 오류 / 삭제 -->
  <div class="empty" id="view-message" style="margin-top:32px" hidden>
    <span class="squircle squircle-lg" style="margin:0 auto" id="msg-icon"><?= icon_server() ?></span>
    <h2 class="h3" style="margin-top:24px" id="msg-title"></h2>
    <p class="muted" style="margin-top:8px;max-width:480px;margin-left:auto;margin-right:auto" id="msg-text"></p>
    <a class="btn btn-primary" style="margin-top:24px" href="<?= h(url('index.php')) ?>" id="msg-cta" hidden>새 서버 만들기</a>
  </div>

  <!-- 준비 완료 -->
  <div id="view-ready" hidden>
    <div class="grid grid-4" style="margin-top:32px">
      <div class="stat">
        <div class="stat-label">전원</div>
        <div class="stat-value" id="s-power">—</div>
        <div class="stat-sub" id="s-uptime">&nbsp;</div>
      </div>
      <div class="stat">
        <div class="stat-label">CPU <span id="s-cpus"></span></div>
        <div class="stat-value" id="s-cpu">—</div>
        <div class="meter"><span id="m-cpu"></span></div>
      </div>
      <div class="stat">
        <div class="stat-label">메모리 <span id="s-maxmem"></span></div>
        <div class="stat-value" id="s-mem">—</div>
        <div class="meter"><span id="m-mem"></span></div>
      </div>
      <div class="stat">
        <div class="stat-label">남은 시간</div>
        <div class="stat-value" id="s-remain">—</div>
        <div class="stat-sub" id="s-expire">&nbsp;</div>
      </div>
    </div>

    <div style="margin-top:16px">
      <?php console_shell($vm['name']); ?>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3 class="title">사양.</h3></div>
        <dl class="kv">
          <dt>vCPU</dt><dd id="d-cpu">—</dd>
          <dt>메모리</dt><dd id="d-mem">—</dd>
          <dt>디스크</dt><dd id="d-disk">—</dd>
          <dt>운영체제 유형</dt><dd id="d-os">—</dd>
          <dt>VMID / 노드</dt><dd><?= (int)$vm['vmid'] ?> / <?= h($vm['node']) ?></dd>
          <dt>템플릿</dt><dd><?= (int)$vm['template_id'] ?></dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-head"><h3 class="title">네트워크.</h3></div>
        <dl class="kv" id="d-net">
          <dt>IP 주소</dt><dd id="d-ip">—</dd>
        </dl>
        <p class="hint" id="d-agent-hint" style="margin-top:12px" hidden>IP 주소를 보려면 VM에 QEMU Guest Agent 가 설치·활성화되어 있어야 합니다.</p>
      </div>
    </div>
  </div>
</section>

<script type="module">
import { mountConsole } from '<?= h(url('assets/console.js')) ?>?v=1';

const NAME = <?= json_encode($vm['name']) ?>;
const $ = (id) => document.getElementById(id);
const OS = { l26: 'Linux (2.6 – 6.x)', l24: 'Linux 2.4', win11: 'Windows 11 / 2022', win10: 'Windows 10 / 2016 / 2019', win8: 'Windows 8 / 2012', win7: 'Windows 7 / 2008 R2', other: '기타', solaris: 'Solaris' };
const STATE = { creating: '복제 중', starting: '부팅 중', ready: '준비됨', error: '오류', deleting: '삭제 중', destroying: '삭제 중' };

let vm = null, info = null, consoleCtl = null, timer = null, autoConnected = false;

function badge(el, text, dotClass, ink = false) {
  el.className = 'badge' + (ink ? ' badge-ink' : '');
  el.innerHTML = `<span class="dot ${dotClass}"></span><span></span>`;
  el.lastChild.textContent = text;
}

function show(view) {
  ['view-provision', 'view-message', 'view-ready'].forEach(id => { $(id).hidden = id !== view; });
}

function message(title, text, cta = false) {
  show('view-message');
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  $('msg-cta').hidden = !cta;
}

function renderLease() {
  if (!vm) return;
  const exp = vm.expires_at;
  $('lease-badge').textContent = exp == null ? '영구 서버' : `남은 시간 ${App.remaining(exp)}`;
  if ($('s-remain')) {
    $('s-remain').textContent = App.remaining(exp);
    $('s-expire').textContent = exp == null ? '자동 삭제 안 됨' : new Date(exp * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) + ' 삭제';
  }
}

function renderPower(status) {
  const running = status === 'running';
  $('power').hidden = vm.state !== 'ready';
  document.querySelectorAll('[data-power]').forEach(b => {
    const op = b.dataset.power;
    b.hidden = op === 'start' ? running : !running;
  });
}

function render() {
  const s = vm.state;
  if (s === 'creating' || s === 'starting') {
    badge($('state-badge'), STATE[s], 'dot-busy');
    show('view-provision');
    const order = ['creating', 'starting', 'ready'];
    document.querySelectorAll('[data-step]').forEach(el => {
      const i = order.indexOf(el.dataset.step), cur = order.indexOf(s);
      el.className = 'step' + (i < cur ? ' done' : i === cur ? ' current' : '');
    });
    $('power').hidden = true;
  } else if (s === 'error') {
    badge($('state-badge'), '오류', 'dot-err');
    message('서버를 만들지 못했습니다.', (vm.error || '알 수 없는 오류') + ' — 관리자에게 문의하거나 다른 이름으로 다시 만들어 주세요.', true);
    $('power').hidden = true;
  } else if (s === 'deleting' || s === 'destroying') {
    badge($('state-badge'), '삭제 중', 'dot-busy');
    message('서버를 삭제하고 있습니다.', '대여 기간이 끝났거나 관리자가 삭제했습니다. 잠시 후 완전히 사라집니다.', true);
    $('power').hidden = true;
    consoleCtl && consoleCtl.disconnect();
  } else if (s === 'ready') {
    show('view-ready');
    if (!consoleCtl) consoleCtl = mountConsole(document.querySelector('[data-console]'), NAME);
    if (info) {
      const running = info.status === 'running';
      badge($('state-badge'), running ? '실행 중' : '정지됨', running ? 'dot-on' : 'dot-off', running);
      $('s-power').textContent = running ? '실행 중' : '정지됨';
      $('s-uptime').textContent = running ? `가동 ${App.duration(info.uptime)}` : '서버가 꺼져 있습니다';
      const cpu = running ? info.cpu * 100 : 0;
      $('s-cpus').textContent = `${info.cpus} vCPU`;
      $('s-cpu').innerHTML = `${cpu.toFixed(cpu < 10 ? 1 : 0)}<small>%</small>`;
      $('m-cpu').style.width = Math.min(100, cpu) + '%';
      const memPct = info.maxmem ? (running ? info.mem / info.maxmem * 100 : 0) : 0;
      $('s-maxmem').textContent = App.bytes(info.maxmem);
      $('s-mem').innerHTML = `${memPct.toFixed(0)}<small>% · ${running ? App.bytes(info.mem) : '0 B'}</small>`;
      $('m-mem').style.width = memPct + '%';

      $('d-cpu').textContent = `${info.cores} 코어 × ${info.sockets} 소켓`;
      $('d-mem').textContent = App.bytes(info.maxmem);
      $('d-disk').textContent = info.maxdisk ? App.bytes(info.maxdisk) : '—';
      $('d-os').textContent = OS[info.ostype] || info.ostype || '—';

      // 네트워크
      const dl = $('d-net');
      dl.innerHTML = '';
      const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
      const v4 = info.ips.filter(i => i.type === 'ipv4');
      const ips = v4.length ? v4 : info.ips;
      add('IP 주소', ips.length ? ips.map(i => `${i.address} (${i.iface})`).join('\n') : (running ? '확인 불가' : '—'));
      for (const [k, v] of Object.entries(info.net)) {
        const parts = Object.fromEntries(v.split(',').map(p => p.split('=')));
        const model = Object.keys(parts).find(x => ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3'].includes(x));
        add(`${k} 브리지`, `${parts.bridge || '—'}${parts.tag ? ' · VLAN ' + parts.tag : ''}`);
        if (model) add(`${k} MAC`, `${parts[model]} (${model})`);
      }
      add('수신 / 송신', `${App.bytes(info.netin)} / ${App.bytes(info.netout)}`);
      $('d-agent-hint').hidden = info.agent && (ips.length > 0 || !running);
      renderPower(info.status);

      if (running && !autoConnected) { autoConnected = true; consoleCtl.connect(); }
    }
  }
  $('page-error').hidden = !(vm.error && s === 'ready');
  if (vm.error && s === 'ready') $('page-error').textContent = vm.error;
  renderLease();
}

async function poll() {
  clearTimeout(timer);
  try {
    const data = await App.api('status', { name: NAME });
    vm = data.vm;
    info = data.info || null;
    if (data.info_error) { $('page-error').hidden = false; $('page-error').textContent = 'VM 정보를 불러오지 못했습니다.'; }
    render();
  } catch (ex) {
    if (ex.status === 404) {
      badge($('state-badge'), '삭제됨', 'dot-off');
      message('서버가 삭제되었습니다.', '대여 기간이 끝나 서버가 정리되었습니다. 새 서버를 만들 수 있습니다.', true);
      $('power').hidden = true;
      $('lease-badge').hidden = true;
      return;
    }
    $('page-error').hidden = false;
    $('page-error').textContent = ex.message;
  }
  const transient = vm && vm.state !== 'ready';
  timer = setTimeout(poll, transient ? 2500 : (document.hidden ? 30000 : 5000));
}

document.querySelectorAll('[data-power]').forEach(b => b.addEventListener('click', async () => {
  const op = b.dataset.power;
  const label = b.textContent;
  b.disabled = true;
  try {
    await App.api('power', { name: NAME, op }, 'POST');
    App.toast({ start: '서버를 시작합니다.', shutdown: '종료 신호를 보냈습니다.', reboot: '재부팅합니다.', stop: '강제 종료했습니다.' }[op]);
    if (op === 'start') autoConnected = false;
    setTimeout(poll, 1500);
  } catch (ex) {
    App.toast(ex.message, 4000);
  } finally {
    b.disabled = false;
    b.textContent = label;
  }
}));

document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
setInterval(renderLease, 1000);
poll();
</script>
<?php page_foot();
