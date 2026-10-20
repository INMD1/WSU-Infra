/**
 * noVNC 콘솔 마운트.
 *
 * 흐름: api.php?action=vnc 로 Proxmox vncproxy 티켓 발급 →
 *       웹 서버의 /pve-ws 프록시(API 토큰 주입)를 통해 vncwebsocket 연결 →
 *       VNC 인증 비밀번호로 동일한 티켓 사용 (Proxmox 기본 동작)
 */
let RFBClass = null;

async function loadRFB() {
  if (!RFBClass) {
    const src = document.documentElement.dataset.novnc;
    RFBClass = (await import(src)).default;
  }
  return RFBClass;
}

/** 문자 → X11 keysym */
function keysymFor(ch) {
  const code = ch.codePointAt(0);
  if (ch === '\n') return 0xff0d; // Return
  if (ch === '\t') return 0xff09; // Tab
  if (code >= 0x20 && code <= 0xff) return code;
  return 0x01000000 + code;
}

export function mountConsole(shell, name) {
  const screen = shell.querySelector('[data-screen]');
  const overlay = shell.querySelector('[data-overlay]');
  const oTitle = overlay.querySelector('[data-o-title]');
  const oText = overlay.querySelector('[data-o-text]');
  const oBtn = overlay.querySelector('[data-o-btn]');
  const oSpin = overlay.querySelector('[data-o-spin]');
  const status = shell.querySelector('[data-status]');
  const statusDot = shell.querySelector('[data-status-dot]');
  let rfb = null;
  let connecting = false;

  function showOverlay(title, text = '', btn = null, busy = false) {
    overlay.hidden = false;
    oTitle.textContent = title;
    oText.textContent = text;
    oText.hidden = !text;
    oBtn.hidden = !btn;
    if (btn) oBtn.textContent = btn;
    oSpin.hidden = !busy;
  }

  function setStatus(text, on) {
    status.textContent = text;
    statusDot.className = 'dot ' + (on ? 'dot-on' : 'dot-off');
    shell.querySelectorAll('[data-needs-conn]').forEach(b => { b.disabled = !on; });
  }

  async function connect() {
    if (connecting || rfb) return;
    connecting = true;
    showOverlay('콘솔에 연결하는 중…', '', null, true);
    setStatus('연결 중', false);
    try {
      const RFB = await loadRFB();
      const t = await App.api('vnc', { name }, 'POST');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      screen.innerHTML = '';
      rfb = new RFB(screen, `${proto}//${location.host}${t.path}`, {
        credentials: { password: t.password },
        wsProtocols: ['binary'],
      });
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.focusOnClick = true;
      rfb.background = '#000';

      rfb.addEventListener('connect', () => {
        overlay.hidden = true;
        setStatus('연결됨', true);
        rfb.focus();
      });
      rfb.addEventListener('credentialsrequired', () => rfb.sendCredentials({ password: t.password }));
      rfb.addEventListener('securityfailure', (e) => {
        showOverlay('인증에 실패했습니다.', e.detail.reason || '티켓이 만료되었을 수 있습니다. 다시 연결해 주세요.', '다시 연결');
      });
      rfb.addEventListener('disconnect', (e) => {
        rfb = null;
        setStatus('연결 안 됨', false);
        if (e.detail.clean) {
          showOverlay('콘솔 연결이 종료되었습니다.', '', '다시 연결');
        } else {
          showOverlay('콘솔에 연결하지 못했습니다.',
            '서버가 켜져 있는지 확인하세요. 계속 실패하면 관리자에게 WebSocket 프록시(/pve-ws) 설정을 확인해 달라고 요청하세요.',
            '다시 연결');
        }
      });
    } catch (ex) {
      rfb = null;
      setStatus('연결 안 됨', false);
      showOverlay('콘솔을 열 수 없습니다.', ex.message, '다시 시도');
    } finally {
      connecting = false;
    }
  }

  function disconnect() {
    if (rfb) rfb.disconnect();
  }

  oBtn.addEventListener('click', connect);
  shell.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'cad':
        rfb && rfb.sendCtrlAltDel();
        break;
      case 'type': {
        if (!rfb) return;
        const text = prompt('서버로 입력할 텍스트 (클립보드 붙여넣기 대용):');
        if (text) {
          for (const ch of text) rfb.sendKey(keysymFor(ch));
          rfb.focus();
        }
        break;
      }
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else shell.requestFullscreen && shell.requestFullscreen();
        break;
      case 'disconnect':
        disconnect();
        break;
    }
  });

  setStatus('연결 안 됨', false);
  showOverlay('콘솔이 준비되었습니다.', '버튼을 누르면 브라우저에서 서버 화면에 바로 접속합니다.', '콘솔 연결');
  return { connect, disconnect, get connected() { return !!rfb; } };
}
