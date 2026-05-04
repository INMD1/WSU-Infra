'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Script from 'next/script';

declare global {
  interface Window {
    WMKS?: {
      CONST?: {
        ConnectionState?: { CONNECTED: number; DISCONNECTED: number; ERROR: number };
      };
      createWMKS: (containerId: string, options?: any) => any;
    };
  }
}

interface MksInfo {
  vm_name: string;
  ticket: string;
  host: string;
  port: number;
  sslThumbprint: string;
  cfgFile: string;
  vmId: string;
}

function authFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export default function ConsolePage() {
  const params = useParams<{ vmId: string }>();
  const vmId = params?.vmId;
  const [status, setStatus] = useState<string>('초기화 중...');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<MksInfo | null>(null);
  const [jqueryReady, setJqueryReady] = useState(false);
  const [jqueryUiReady, setJqueryUiReady] = useState(false);
  const [wmksReady, setWmksReady] = useState(false);
  const wmksRef = useRef<any>(null);

  // 1) ticket 발급
  useEffect(() => {
    if (!vmId) return;
    let cancelled = false;
    (async () => {
      setStatus('MKS ticket 발급 중...');
      try {
        const res = await authFetch(`/api/vms/${vmId}/console`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.message || data.error || 'ticket 발급 실패');
          return;
        }
        setInfo(data);
        setStatus('wmks.js 로딩 중...');
      } catch {
        if (!cancelled) setError('네트워크 오류');
      }
    })();
    return () => { cancelled = true; };
  }, [vmId]);

  // 2) wmks 로드 + ticket 둘 다 준비되면 connect
  useEffect(() => {
    if (!info || !wmksReady) return;
    setStatus('ESXi WebMKS 연결 중...');
    try {
      const W: any = (window as any).WMKS;
      const $: any = (window as any).jQuery ?? (window as any).$;
      // 디버그: 실제로 어떤 API 가 노출되는지 콘솔에서 확인
      console.log('[wmks] window.WMKS keys:', W ? Object.keys(W) : '(undefined)');
      if ($) console.log('[wmks] jQuery available:', typeof $);

      // vmware-wmks@1.0.0 은 jQuery UI widget. WMKS.widgetProto 를 $.widget() 으로 등록.
      const opts = { useUnicodeKeyboardInput: true, rescale: true };
      if (!$ || !$.widget) {
        throw new Error('jQuery UI Widget Factory 가 로드되지 않음');
      }
      if (!$.fn.wmks) {
        if (!W?.widgetProto) {
          throw new Error(`WMKS.widgetProto 없음 — keys=${JSON.stringify(Object.keys(W))}`);
        }
        $.widget('wmks.wmks', W.widgetProto);
        console.log('[wmks] $.widget("wmks.wmks", widgetProto) 등록 완료');
      }

      const $container = $('#mks-container');
      $container.wmks(opts);
      // jQuery UI widget data key: <namespace>-<name>
      const inst: any = $container.data('wmks-wmks') ?? $container.data('wmks');
      if (!inst) {
        throw new Error('wmks 인스턴스 획득 실패 — $container.data() 비어있음');
      }

      const wssUrl = `wss://${info.host}:${info.port}/ticket/${info.ticket}`;
      console.log('[wmks] connecting:', wssUrl);
      inst.connect(wssUrl);

      const C = W?.CONST?.ConnectionState;
      if (C && inst.register) {
        inst.register('CONNECTIONSTATECHANGE', (_e: any, data: any) => {
          if (data?.state === C.CONNECTED) setStatus('연결됨');
          else if (data?.state === C.DISCONNECTED) setStatus('연결 끊김 — ticket 만료 시 페이지 새로고침');
          else if (data?.state === C.ERROR) setStatus('오류 — 브라우저 콘솔 확인');
        });
      }

      wmksRef.current = inst;
    } catch (err: any) {
      setError(`wmks 초기화 실패: ${err?.message ?? err}\n\n브라우저 개발자도구 Console 에서 [wmks] 로그 확인 후 알려주세요.`);
    }

    return () => {
      try { wmksRef.current?.destroy?.(); } catch {}
    };
  }, [info, wmksReady]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000', color: '#fff' }}>
      {/* VMware WMKS CSS (jsDelivr) */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vmware-wmks@1.0.0/css/css/wmks-all.min.css" />
      {/* 1) jQuery 먼저 */}
      <Script
        src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"
        strategy="afterInteractive"
        onLoad={() => setJqueryReady(true)}
        onError={() => setError('jQuery 로드 실패')}
      />
      {/* 2) jQuery UI Widget Factory — wmks 가 widget 으로 등록되려면 필요 */}
      {jqueryReady && (
        <Script
          src="https://cdn.jsdelivr.net/npm/jquery-ui@1.13.2/dist/jquery-ui.min.js"
          strategy="afterInteractive"
          onLoad={() => setJqueryUiReady(true)}
          onError={() => setError('jQuery UI 로드 실패')}
        />
      )}
      {/* 3) WMKS */}
      {jqueryUiReady && (
        <Script
          src="https://cdn.jsdelivr.net/npm/vmware-wmks@1.0.0/wmks.min.js"
          strategy="afterInteractive"
          onLoad={() => setWmksReady(true)}
          onError={() => setError('wmks.js 로드 실패 (jsDelivr 접근 불가일 수 있음)')}
        />
      )}
      <header style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', borderBottom: '1px solid #333' }}>
        <div>
          <strong>{info?.vm_name ?? 'VM 콘솔'}</strong>
          <span style={{ marginLeft: '1rem', color: '#888', fontSize: '0.85rem' }}>{status}</span>
        </div>
        <button onClick={() => window.close()}
          style={{ background: '#444', color: '#fff', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
          닫기
        </button>
      </header>
      {error ? (
        <div style={{ padding: '2rem', color: '#ff6b6b' }}>
          <h3>오류</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{error}</pre>
          <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '1rem' }}>
            wmks.js 는 jsDelivr CDN(<code>vmware-wmks@1.0.0</code>)에서 로드됩니다. 콘솔 화면 띄우려면 학생 PC 가 jsDelivr (<code>cdn.jsdelivr.net</code>) 및 ESXi 호스트(<code>{info?.host}:{info?.port}</code>)에 직접 도달 가능해야 합니다.
          </p>
        </div>
      ) : (
        <div id="mks-container" style={{ flex: 1, overflow: 'hidden' }} />
      )}
    </div>
  );
}
