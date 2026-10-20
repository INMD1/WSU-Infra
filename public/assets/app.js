/* 공통 유틸 */
(function () {
  const App = (window.App = {});

  App.toast = function (msg, ms = 2600) {
    const stack = document.getElementById('toasts');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  /** api.php 호출. POST 는 form-urlencoded 로 전송 */
  App.api = async function (action, params = {}, method = 'GET') {
    const base = document.documentElement.dataset.base || '';
    const isPost = method === 'POST';
    let url = `${base}/api.php?action=${encodeURIComponent(action)}`;
    const init = { method: isPost ? 'POST' : 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (isPost) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(params).toString();
    } else if (Object.keys(params).length) {
      url += '&' + new URLSearchParams(params).toString();
    }
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch (_) { /* noop */ }
    if (!res.ok || !data || data.error) {
      const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  App.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    App.toast('링크를 복사했습니다.');
  };

  App.remaining = function (expiresAt) {
    if (expiresAt == null) return '영구';
    let s = Math.floor(expiresAt - Date.now() / 1000);
    if (s <= 0) return '만료됨';
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (d) return `${d}일 ${h}시간`;
    if (h) return `${h}시간 ${m}분`;
    return `${m}분 ${String(sec).padStart(2, '0')}초`;
  };

  App.bytes = function (b) {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b < 10 ? 1 : 0) : Math.round(b)) + ' ' + u[i];
  };

  App.duration = function (s) {
    if (!s) return '—';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d}일 ${h}시간`;
    if (h) return `${h}시간 ${m}분`;
    return `${m}분`;
  };

  /** 추측하기 어려운 랜덤 서버 이름 */
  App.randomName = function () {
    const a = ['amber', 'brisk', 'calm', 'dusty', 'eager', 'fuzzy', 'gentle', 'hollow', 'icy', 'jolly', 'lucky', 'mellow', 'noble', 'quiet', 'rapid', 'silent', 'tidy', 'vivid', 'witty', 'young'];
    const n = ['otter', 'falcon', 'maple', 'comet', 'harbor', 'pebble', 'cedar', 'lantern', 'meadow', 'nebula', 'orbit', 'raven', 'summit', 'tundra', 'willow', 'atlas', 'breeze', 'coral', 'delta', 'ember'];
    const pick = (arr) => arr[crypto.getRandomValues(new Uint32Array(1))[0] % arr.length];
    const num = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    return `${pick(a)}-${pick(n)}-${String(num).padStart(4, '0')}`;
  };

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { e.preventDefault(); App.copy(c.dataset.copy); }
    const conf = e.target.closest('[data-confirm]');
    if (conf && !confirm(conf.dataset.confirm)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();
