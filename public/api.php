<?php
declare(strict_types=1);

/**
 * 사용자용 JSON API. 회원가입이 없으므로 "서버 이름"이 곧 접근 키입니다.
 *
 *   POST create  name=...                → 새 VM 생성
 *   GET  status  name=...                → 상태 + 상세 정보 (상태 전이도 함께 진행)
 *   POST power   name=... op=start|...   → 전원 제어
 *   POST vnc     name=...                → noVNC 접속용 일회성 티켓
 */
require __DIR__ . '/../src/bootstrap.php';

$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    require_same_origin();
}

/** 이름으로 VM을 찾고, 만료됐으면 삭제를 시작 */
function load_vm(): array
{
    $name = (string)($_REQUEST['name'] ?? '');
    $vm = $name !== '' ? VmService::findByName($name) : null;
    if (!$vm) {
        json_out(['error' => '서버를 찾을 수 없습니다. 이름을 확인하거나, 대여 기간이 끝나 삭제되었을 수 있습니다.'], 404);
    }
    if (VmService::isExpired($vm)) {
        $vm = vms()->requestDelete($vm);
    }
    return $vm;
}

try {
    switch ($action) {
        case 'create':
            if ($method !== 'POST') {
                json_out(['error' => 'POST 만 허용됩니다.'], 405);
            }
            $vm = vms()->create((string)($_POST['name'] ?? ''), client_ip());
            json_out(['vm' => vm_public(vms()->advance($vm))]);

        case 'status':
            vms()->maybeTick();
            $vm = vms()->advance(load_vm());
            $out = ['vm' => vm_public($vm), 'now' => time()];
            if ($vm['state'] === 'ready') {
                try {
                    $out['info'] = vms()->details($vm);
                } catch (ProxmoxException $e) {
                    $out['info_error'] = $e->getMessage();
                }
            }
            json_out($out);

        case 'power':
            if ($method !== 'POST') {
                json_out(['error' => 'POST 만 허용됩니다.'], 405);
            }
            $vm = load_vm();
            vms()->power($vm, (string)($_POST['op'] ?? ''));
            json_out(['ok' => true]);

        case 'vnc':
            if ($method !== 'POST') {
                json_out(['error' => 'POST 만 허용됩니다.'], 405);
            }
            $vm = load_vm();
            if ($vm['state'] !== 'ready') {
                throw new UserError('서버가 아직 준비되지 않았습니다.');
            }
            $t = proxmox()->vncProxy($vm['node'], (int)$vm['vmid']);
            $path = rtrim((string)config('vnc_ws_path', '/pve-ws'), '/')
                . '/nodes/' . rawurlencode($vm['node']) . '/qemu/' . (int)$vm['vmid'] . '/vncwebsocket'
                . '?port=' . (int)$t['port'] . '&vncticket=' . rawurlencode((string)$t['ticket']);
            json_out(['path' => $path, 'password' => (string)$t['ticket']]);

        default:
            json_out(['error' => '알 수 없는 요청입니다.'], 400);
    }
} catch (UserError $e) {
    json_out(['error' => $e->getMessage()], 422);
} catch (ProxmoxException $e) {
    error_log('[vmrental] ' . $e->getMessage());
    json_out(['error' => 'Proxmox 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.'], 502);
} catch (Throwable $e) {
    error_log('[vmrental] ' . $e);
    json_out(['error' => '서버 내부 오류가 발생했습니다.'], 500);
}
