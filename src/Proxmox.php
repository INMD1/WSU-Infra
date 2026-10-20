<?php
declare(strict_types=1);

final class ProxmoxException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 0)
    {
        parent::__construct($message, $httpStatus);
    }

    /** VM이 존재하지 않아서 실패했는지 */
    public function isNotFound(): bool
    {
        return $this->httpStatus === 404
            || ($this->httpStatus === 500 && preg_match('/does not exist|not found/i', $this->getMessage()) === 1);
    }
}

/**
 * Proxmox VE REST API 클라이언트 (API 토큰 인증).
 */
final class Proxmox
{
    private string $base;
    private string $authHeader;

    public function __construct(private array $cfg)
    {
        $this->base = rtrim($cfg['host'], '/') . '/api2/json';
        $this->authHeader = 'Authorization: PVEAPIToken=' . $cfg['token_id'] . '=' . $cfg['token_secret'];
    }

    public function get(string $path, array $query = []): mixed
    {
        return $this->request('GET', $path, $query);
    }

    public function post(string $path, array $params = []): mixed
    {
        return $this->request('POST', $path, $params);
    }

    public function delete(string $path, array $query = []): mixed
    {
        return $this->request('DELETE', $path, $query);
    }

    public function request(string $method, string $path, array $params = []): mixed
    {
        if (trim((string)$this->cfg['host']) === '' || ($this->cfg['token_id'] ?? '') === '' || ($this->cfg['token_secret'] ?? '') === '') {
            throw new ProxmoxException('Proxmox 연결 정보가 아직 설정되지 않았습니다. 관리자 페이지 → 설정에서 입력하세요.');
        }
        $url = $this->base . $path;
        $ch = curl_init();
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => [$this->authHeader, 'Accept: application/json'],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => (int)($this->cfg['timeout'] ?? 20),
            CURLOPT_SSL_VERIFYPEER => (bool)($this->cfg['verify_ssl'] ?? true),
            CURLOPT_SSL_VERIFYHOST => ($this->cfg['verify_ssl'] ?? true) ? 2 : 0,
        ];
        $params = array_map(static fn($v) => is_bool($v) ? (int)$v : $v, $params);
        if ($method === 'POST' || $method === 'PUT') {
            $opts[CURLOPT_POSTFIELDS] = http_build_query($params);
        } elseif ($params) {
            $url .= '?' . http_build_query($params);
        }
        $opts[CURLOPT_URL] = $url;
        curl_setopt_array($ch, $opts);

        $body = curl_exec($ch);
        if ($body === false) {
            $err = curl_error($ch);
            throw new ProxmoxException('Proxmox 연결 실패: ' . $err);
        }
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

        $json = json_decode((string)$body, true);
        if ($status >= 400) {
            $reason = '';
            if (is_array($json) && !empty($json['errors'])) {
                $reason = ' ' . json_encode($json['errors'], JSON_UNESCAPED_UNICODE);
            }
            // Proxmox는 오류 사유를 HTTP 상태줄에 담아 보냄
            $line = trim((string)$body) !== '' && $json === null ? trim((string)$body) : '';
            throw new ProxmoxException("Proxmox API {$method} {$path} 실패 ({$status}){$reason}{$line}", $status);
        }
        return is_array($json) ? ($json['data'] ?? null) : null;
    }

    // ─── 편의 메서드 ──────────────────────────────────────────────

    private static function vmPath(string $node, int $vmid): string
    {
        return '/nodes/' . rawurlencode($node) . '/qemu/' . $vmid;
    }

    /** 연결 확인용: { version, release, repoid } (토큰만 맞으면 권한 없이도 됨) */
    public function version(): array
    {
        return (array)$this->get('/version');
    }

    /** 토큰이 볼 수 있는 리소스 풀 이름 목록 */
    public function pools(): array
    {
        return array_values(array_filter(array_map(static fn($p) => (string)($p['poolid'] ?? ''), (array)$this->get('/pools'))));
    }

    /** /cluster/resources?type=vm  →  vmid 를 키로 하는 배열 */
    public function clusterVms(): array
    {
        $out = [];
        foreach ((array)$this->get('/cluster/resources', ['type' => 'vm']) as $r) {
            if (($r['type'] ?? '') === 'qemu') {
                $out[(int)$r['vmid']] = $r;
            }
        }
        return $out;
    }

    public function templates(): array
    {
        return array_values(array_filter($this->clusterVms(), static fn($r) => !empty($r['template'])));
    }

    /** /cluster/resources?type=node  →  노드 이름을 키로 하는 배열 (Sys.Audit 권한이 있는 노드만 보임) */
    public function clusterNodes(): array
    {
        $out = [];
        foreach ((array)$this->get('/cluster/resources', ['type' => 'node']) as $r) {
            if (isset($r['node'])) {
                $out[(string)$r['node']] = $r;
            }
        }
        return $out;
    }

    /** /cluster/resources?type=storage  →  노드별 스토리지 목록 */
    public function clusterStorages(): array
    {
        return array_values(array_filter(
            (array)$this->get('/cluster/resources', ['type' => 'storage']),
            static fn($r) => isset($r['node'], $r['storage'])
        ));
    }

    /** UPID:<node>:<pid>:...  →  task 가 실행 중인 노드 */
    public static function upidNode(string $upid): ?string
    {
        $parts = explode(':', $upid);
        return ($parts[0] ?? '') === 'UPID' && ($parts[1] ?? '') !== '' ? $parts[1] : null;
    }

    public function nextId(?int $candidate = null): int
    {
        return (int)$this->get('/cluster/nextid', $candidate ? ['vmid' => $candidate] : []);
    }

    public function isVmidFree(int $vmid): bool
    {
        try {
            $this->get('/cluster/nextid', ['vmid' => $vmid]);
            return true;
        } catch (ProxmoxException $e) {
            // 연결 자체가 실패한 경우(상태코드 0)만 예외 전파, 그 외에는 "사용 중"
            if ($e->httpStatus === 0) {
                throw $e;
            }
            return false;
        }
    }

    public function cloneVm(string $node, int $templateId, int $newId, array $opts): string
    {
        return (string)$this->post(self::vmPath($node, $templateId) . '/clone', ['newid' => $newId] + $opts);
    }

    public function taskStatus(string $node, string $upid): array
    {
        return (array)$this->get('/nodes/' . rawurlencode($node) . '/tasks/' . rawurlencode($upid) . '/status');
    }

    public function vmStatus(string $node, int $vmid): array
    {
        return (array)$this->get(self::vmPath($node, $vmid) . '/status/current');
    }

    public function vmConfig(string $node, int $vmid): array
    {
        return (array)$this->get(self::vmPath($node, $vmid) . '/config');
    }

    /** start | stop | shutdown | reboot | reset */
    public function vmAction(string $node, int $vmid, string $action, array $params = []): string
    {
        return (string)$this->post(self::vmPath($node, $vmid) . '/status/' . $action, $params);
    }

    public function destroyVm(string $node, int $vmid): string
    {
        return (string)$this->delete(self::vmPath($node, $vmid), [
            'purge' => 1,
            'destroy-unreferenced-disks' => 1,
        ]);
    }

    public function vncProxy(string $node, int $vmid): array
    {
        return (array)$this->post(self::vmPath($node, $vmid) . '/vncproxy', ['websocket' => 1]);
    }

    /** QEMU guest agent 로 IP 목록 조회 (agent 가 없으면 빈 배열) */
    public function guestIps(string $node, int $vmid): array
    {
        try {
            $res = (array)$this->get(self::vmPath($node, $vmid) . '/agent/network-get-interfaces');
        } catch (ProxmoxException) {
            return [];
        }
        $ips = [];
        foreach ((array)($res['result'] ?? []) as $iface) {
            if (($iface['name'] ?? '') === 'lo') {
                continue;
            }
            foreach ((array)($iface['ip-addresses'] ?? []) as $ip) {
                $addr = (string)($ip['ip-address'] ?? '');
                if ($addr === '' || str_starts_with($addr, 'fe80') || $addr === '::1' || str_starts_with($addr, '127.')) {
                    continue;
                }
                $ips[] = ['iface' => (string)$iface['name'], 'type' => (string)($ip['ip-address-type'] ?? ''), 'address' => $addr];
            }
        }
        return $ips;
    }
}
