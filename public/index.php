<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$lease = max(1, Settings::int('lease_hours'));
$leaseText = $lease % 24 === 0 ? ($lease / 24 === 1 ? '하루' : ($lease / 24) . '일') : "{$lease}시간";
$ready = proxmox_configured();
$enabled = $ready && (bool)Settings::int('creation_enabled');
$prefill = VmService::normalizeName((string)($_GET['name'] ?? ''));

page_head('서버 만들기 — WSU Server', ['cta' => null, 'nav' => [
    ['href' => url('index.php#open'), 'label' => '내 서버 열기'],
    ['href' => url('admin/'), 'label' => '관리자'],
]]);
?>
<section class="container container-narrow" style="padding-top:64px;max-width:520px">
  <div class="card-soft" id="open">
    <h1 class="h3">서버 만들기.</h1>
    <p class="muted body-sm" style="margin-top:6px">이름을 입력하면 바로 VM이 만들어지고, <?= h($leaseText) ?> 뒤 자동으로 삭제됩니다.</p>

    <div class="segmented segmented-block" role="tablist" aria-label="모드 선택" style="margin-top:20px">
      <button type="button" role="tab" aria-selected="true" data-mode="create">새 서버</button>
      <button type="button" role="tab" aria-selected="false" data-mode="open">내 서버 열기</button>
    </div>

    <form id="main-form" class="stack" style="margin-top:16px" autocomplete="off" novalidate>
      <div class="input-affix">
        <input class="input" id="name" name="name" maxlength="32" spellcheck="false" autocapitalize="off" autofocus
               placeholder="서버 이름 (예: quiet-otter-2048)" value="<?= h($prefill) ?>" aria-label="서버 이름" required>
        <button type="button" class="btn btn-on-soft btn-xs affix-btn" id="random" title="무작위 이름 만들기">무작위</button>
      </div>
      <p class="hint" id="hint-create">영문 소문자·숫자·하이픈, 3~32자. 이름이나 링크를 아는 사람은 누구나 접속할 수 있습니다.</p>
      <p class="hint" id="hint-open" hidden>서버를 만들 때 정한 이름을 입력하세요.</p>
      <div class="form-error" id="form-error" hidden></div>
      <button class="btn btn-primary btn-block" id="submit" type="submit" <?= $enabled ? '' : 'disabled' ?>>서버 만들기</button>
      <?php if (!$enabled): ?>
        <p class="hint center" id="disabled-note"><?= $ready ? '현재 새 서버 생성이 일시 중단되어 있습니다.' : '아직 준비 중입니다. 관리자가 설정을 마치면 이용할 수 있습니다.' ?></p>
      <?php endif; ?>
    </form>
  </div>
</section>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('main-form');
  const input = document.getElementById('name');
  const submit = document.getElementById('submit');
  const err = document.getElementById('form-error');
  const tabs = document.querySelectorAll('[data-mode]');
  const creationEnabled = <?= $enabled ? 'true' : 'false' ?>;
  const vmBase = <?= json_encode(url('vm.php'), JSON_UNESCAPED_SLASHES) ?>;
  let mode = location.hash === '#open' ? 'open' : 'create';

  function setMode(m) {
    mode = m;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    document.getElementById('hint-create').hidden = m !== 'create';
    document.getElementById('hint-open').hidden = m !== 'open';
    document.getElementById('random').hidden = m !== 'create';
    const note = document.getElementById('disabled-note');
    if (note) note.hidden = m !== 'create';
    submit.textContent = m === 'create' ? '서버 만들기' : '서버 열기';
    submit.disabled = m === 'create' && !creationEnabled;
    err.hidden = true;
  }
  tabs.forEach(t => t.addEventListener('click', () => { setMode(t.dataset.mode); input.focus(); }));
  window.addEventListener('hashchange', () => { if (location.hash === '#open') { setMode('open'); input.focus(); } });
  setMode(mode);

  document.getElementById('random').addEventListener('click', () => { input.value = App.randomName(); input.focus(); });
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    input.setSelectionRange(pos, pos);
    err.hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(name)) {
      err.textContent = '영문 소문자·숫자·하이픈으로 3~32자, 하이픈으로 시작하거나 끝날 수 없습니다.';
      err.hidden = false;
      return;
    }
    const go = () => { location.href = vmBase + '?name=' + encodeURIComponent(name); };
    if (mode === 'open') return go();

    submit.disabled = true;
    submit.innerHTML = '<span class="spin"></span> 만드는 중';
    try {
      await App.api('create', { name }, 'POST');
      go();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      submit.disabled = false;
      submit.textContent = '서버 만들기';
    }
  });
});
</script>
<?php page_foot();
