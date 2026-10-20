<?php
declare(strict_types=1);

final class UserError extends RuntimeException
{
}

/**
 * 임시 VM의 생성 · 상태 전이 · 만료 삭제를 담당.
 *
 * 모든 Proxmox 작업은 비동기(UPID task)이므로 VM은 다음 상태를 거칩니다.
 *
 *   creating ─▶ starting ─▶ ready                 (생성)
 *   deleting ─▶ destroying ─▶ deleted             (삭제: 정지 → 제거)
 *   error                                         (복제 실패)
 *
 * advance() 는 현재 task 가 끝났는지 확인하고 다음 단계로 넘깁니다.
 * 블로킹하지 않으므로 웹 요청(상태 폴링)과 cron 양쪽에서 안전하게 호출할 수 있습니다.
 */
final class VmService
{
    public const NAME_PATTERN = '/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/';
    private const TRANSIENT = ['creating', 'starting', 'deleting', 'destroying'];

    public function __construct(private Proxmox $pve)
    {
    }

    // ─── 조회 ──────────────────────────────────────────────────

    public static function normalizeName(string $name): string
    {
        return strtolower(trim($name));
    }

    public static function findByName(string $name): ?array
    {
        return Db::one("SELECT * FROM vms WHERE name = ? AND state <> 'deleted'", [self::normalizeName($name)]);
    }

    public static function find(int $id): ?array
    {
        return Db::one('SELECT * FROM vms WHERE id = ?', [$id]);
    }

    public static function isExpired(array $vm): bool
    {
        return $vm['expires_at'] !== null && (int)$vm['expires_at'] <= time();
    }

    // ─── 생성 ──────────────────────────────────────────────────

    public function create(string $rawName, string $ip): array
    {
        $name = self::normalizeName($rawName);
        if (!preg_match(self::NAME_PATTERN, $name)) {
            throw new UserError('서버 이름은 영문 소문자·숫자·하이픈(-)으로 3~32자여야 하며, 하이픈으로 시작하거나 끝날 수 없습니다.');
        }
        if (!Settings::int('creation_enabled')) {
            throw new UserError('현재 새 서버 생성이 일시 중단되어 있습니다.');
        }
        if (!proxmox_configured()) {
            throw new UserError('아직 준비 중인 서비스입니다. 관리자가 설정을 마치면 이용할 수 있습니다.');
        }

        $lock = fopen(dirname(config('db_path')) . '/create.lock', 'c');
        flock($lock, LOCK_EX);
        try {
            if (self::findByName($name)) {
                throw new UserError('이미 사용 중인 서버 이름입니다. 다른 이름을 입력하거나, 해당 서버로 들어가려면 "내 서버 열기"를 이용하세요.');
            }
            $max = Settings::int('max_active_vms');
            if ($max > 0) {
                $active = (int)Db::scalar("SELECT COUNT(*) FROM vms WHERE state <> 'deleted' AND expires_at IS NOT NULL");
                if ($active >= $max) {
                    throw new UserError('지금은 대여 가능한 서버가 모두 사용 중입니다. 잠시 후 다시 시도해 주세요.');
                }
            }
            $perIp = Settings::int('per_ip_daily');
            if ($perIp > 0) {
                $count = (int)Db::scalar('SELECT COUNT(*) FROM vms WHERE creator_ip = ? AND created_at > ?', [$ip, time() - 86400]);
                if ($count >= $perIp) {
                    throw new UserError("하루에 만들 수 있는 서버 수({$perIp}대)를 초과했습니다.");
                }
            }

            $templateId = Settings::int('template_id');
            $cluster = $this->pve->clusterVms();
            $template = $cluster[$templateId] ?? null;
            if (!$template || empty($template['template'])) {
                throw new UserError('관리자가 지정한 템플릿을 찾을 수 없습니다. 관리자에게 문의해 주세요.');
            }
            // 클러스터 노드 중 어디에 만들지 결정 (node = VM이 놓일 노드, source_* = 복제할 템플릿)
            $place = (new Placement($this->pve))->choose($templateId, $cluster);
            $node = $place['node'];
            $vmid = $this->allocateVmid($cluster);

            $now = time();
            $lease = max(1, Settings::int('lease_hours')) * 3600;
            $pveName = config('vm.name_prefix') . $name;
            Db::exec(
                "INSERT INTO vms(name, pve_name, vmid, node, template_id, state, creator_ip, created_at, expires_at, updated_at)
                 VALUES(?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)",
                [$name, $pveName, $vmid, $node, $place['source_id'], $ip, $now, $now + $lease, $now]
            );
            $id = (int)Db::pdo()->lastInsertId();

            $opts = [
                'name'        => $pveName,
                'full'        => (bool)config('vm.full_clone'),
                'description' => "Temporary VM \"{$name}\" (web rental)\nCreated: " . date('Y-m-d H:i', $now),
            ];
            if (config('vm.full_clone') && config('vm.storage')) {
                $opts['storage'] = config('vm.storage');
            }
            if (config('vm.pool')) {
                $opts['pool'] = config('vm.pool');
            }
            if ($node !== $place['source_node']) {
                $opts['target'] = $node;   // 공유 스토리지: 템플릿 노드에서 복제해 대상 노드로 넘김
            }
            try {
                $upid = $this->pve->cloneVm($place['source_node'], $place['source_id'], $vmid, $opts);
            } catch (Throwable $e) {
                Db::exec('DELETE FROM vms WHERE id = ?', [$id]);
                throw $e;
            }
            Db::exec('UPDATE vms SET task_upid = ?, updated_at = ? WHERE id = ?', [$upid, time(), $id]);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return self::find($id);
    }

    private function allocateVmid(array $cluster): int
    {
        $min = (int)config('vm.vmid_min');
        $max = (int)config('vm.vmid_max');
        $taken = array_flip(array_map('intval', array_column(
            Db::all("SELECT vmid FROM vms WHERE state <> 'deleted'"), 'vmid'
        )));
        if ($min <= 0 || $max < $min) {
            $id = $this->pve->nextId();
            while (isset($taken[$id])) {
                $id++;
            }
            return $id;
        }
        for ($id = $min; $id <= $max; $id++) {
            if (!isset($taken[$id]) && !isset($cluster[$id]) && $this->pve->isVmidFree($id)) {
                return $id;
            }
        }
        throw new UserError('할당 가능한 VMID가 없습니다. 관리자에게 문의해 주세요.');
    }

    // ─── 상태 전이 ─────────────────────────────────────────────

    /** 진행 가능한 만큼 상태를 전진시키고 최신 레코드를 돌려줌 */
    public function advance(array $vm): array
    {
        for ($i = 0; $i < 4 && in_array($vm['state'], self::TRANSIENT, true); $i++) {
            $moved = $this->step($vm);
            // step 이 마지막으로 상태를 기록하고 false 를 돌려줄 수도 있으므로(starting → ready 등) 항상 다시 읽음
            $vm = self::find((int)$vm['id']) ?? $vm;
            if (!$moved) {
                break;
            }
        }
        return $vm;
    }

    /** @return bool 상태가 바뀌어 바로 다음 단계를 시도할 수 있으면 true */
    private function step(array $vm): bool
    {
        $node = $vm['node'];
        $vmid = (int)$vm['vmid'];
        try {
            switch ($vm['state']) {
                case 'creating':
                    $r = $this->taskResult($vm);
                    if ($r === null) {
                        return false;
                    }
                    if ($r !== true) {
                        $this->update($vm, ['state' => 'error', 'task_upid' => null, 'last_error' => "복제 실패: {$r}"]);
                        return false;
                    }
                    $upid = $this->pve->vmAction($node, $vmid, 'start');
                    $this->update($vm, ['state' => 'starting', 'task_upid' => $upid, 'last_error' => null]);
                    return true;

                case 'starting':
                    $r = $this->taskResult($vm);
                    if ($r === null) {
                        return false;
                    }
                    // 시작이 실패해도 VM 자체는 존재하므로 ready 로 두고 오류만 기록 (대시보드에서 재시작 가능)
                    $this->update($vm, ['state' => 'ready', 'task_upid' => null, 'last_error' => $r === true ? null : "시작 실패: {$r}"]);
                    return false;

                case 'deleting':
                    // 진행 중인 task(복제/시작/정지)가 끝날 때까지 대기
                    if ($vm['task_upid'] && $this->taskResult($vm) === null) {
                        return false;
                    }
                    $status = $this->pve->vmStatus($node, $vmid);
                    if (($status['status'] ?? '') === 'running') {
                        $upid = $this->pve->vmAction($node, $vmid, 'stop');
                        $this->update($vm, ['task_upid' => $upid]);
                        return true;
                    }
                    $upid = $this->pve->destroyVm($node, $vmid);
                    $this->update($vm, ['state' => 'destroying', 'task_upid' => $upid]);
                    return true;

                case 'destroying':
                    $r = $this->taskResult($vm);
                    if ($r === null) {
                        return false;
                    }
                    if ($r === true) {
                        $this->markDeleted($vm);
                        return false;
                    }
                    // 실패: VM이 이미 없으면 완료로 간주, 아니면 다음 tick 에 재시도
                    $this->pve->vmStatus($node, $vmid);
                    $this->update($vm, ['state' => 'deleting', 'task_upid' => null, 'last_error' => "삭제 실패: {$r}"]);
                    return false;
            }
        } catch (ProxmoxException $e) {
            // 'creating' 의 not found 는 복제 task 쪽 문제이므로 VM 위치와 무관
            if ($e->isNotFound() && $vm['state'] !== 'creating') {
                try {
                    $actual = $this->locate($vm);
                } catch (ProxmoxException) {
                    $actual = false;   // 확인 불가 → 오류만 기록하고 다음 tick 에 재시도
                }
                // 다른 노드로 마이그레이션됨: 노드를 고치고 바로 다시 시도
                if (is_string($actual) && $actual !== $vm['node']) {
                    $this->update($vm, ['node' => $actual]);
                    return true;
                }
                // 클러스터 어디에도 없으면 이미 지워진 것
                if ($actual === null && in_array($vm['state'], ['deleting', 'destroying'], true)) {
                    $this->markDeleted($vm);
                    return false;
                }
            }
            $this->update($vm, ['last_error' => $e->getMessage()]);
        }
        return false;
    }

    /**
     * 클러스터에서 이 VM이 실제로 있는 노드. 없거나 이름이 다르면 null.
     * (이름까지 확인해서, 같은 VMID 를 나중에 다른 VM이 쓰게 된 경우 엉뚱한 VM을 건드리지 않음)
     */
    private function locate(array $vm, ?array $cluster = null): ?string
    {
        $r = ($cluster ?? $this->pve->clusterVms())[(int)$vm['vmid']] ?? null;
        if (!$r || (string)($r['name'] ?? '') !== self::pveName($vm)) {
            return null;
        }
        return (string)$r['node'];
    }

    /** Proxmox 에 붙어 있는 VM 이름 (예전 레코드는 저장된 값이 없어 현재 접두사로 추정) */
    public static function pveName(array $vm): string
    {
        return (string)($vm['pve_name'] ?? '') !== '' ? (string)$vm['pve_name'] : config('vm.name_prefix') . $vm['name'];
    }

    /** 접두사를 바꾸기 직전에 호출: 이름이 저장되지 않은 예전 레코드에 지금 이름을 기록 */
    public static function pinPveNames(): void
    {
        Db::exec(
            "UPDATE vms SET pve_name = ? || name WHERE (pve_name IS NULL OR pve_name = '') AND state <> 'deleted'",
            [(string)config('vm.name_prefix')]
        );
    }

    /** VM이 다른 노드로 옮겨졌으면 DB 의 node 를 고치고 갱신된 레코드를, 아니면 null 을 돌려줌 */
    private function followMigration(array $vm, ?array $cluster = null): ?array
    {
        $node = $this->locate($vm, $cluster);
        if ($node === null || $node === $vm['node']) {
            return null;
        }
        $this->update($vm, ['node' => $node]);
        return self::find((int)$vm['id']);
    }

    /** @return true|string|null  null=진행 중, true=성공, string=실패 사유 */
    private function taskResult(array $vm): true|string|null
    {
        if (!$vm['task_upid']) {
            return true;
        }
        // 다른 노드로 복제(target)하면 task 는 템플릿 노드에서 돌기 때문에 UPID 에 적힌 노드로 조회
        $t = $this->pve->taskStatus(Proxmox::upidNode($vm['task_upid']) ?? $vm['node'], $vm['task_upid']);
        if (($t['status'] ?? '') === 'running') {
            return null;
        }
        $exit = (string)($t['exitstatus'] ?? '');
        return ($exit === 'OK' || str_starts_with($exit, 'WARNINGS')) ? true : ($exit ?: 'unknown error');
    }

    private function update(array $vm, array $fields): void
    {
        $fields['updated_at'] = time();
        $sets = implode(', ', array_map(static fn($k) => "{$k} = ?", array_keys($fields)));
        Db::exec("UPDATE vms SET {$sets} WHERE id = ?", [...array_values($fields), $vm['id']]);
    }

    private function markDeleted(array $vm): void
    {
        $this->update($vm, ['state' => 'deleted', 'task_upid' => null, 'deleted_at' => time()]);
    }

    // ─── 삭제 · 대여 기간 ──────────────────────────────────────

    public function requestDelete(array $vm): array
    {
        if (in_array($vm['state'], ['deleting', 'destroying', 'deleted'], true)) {
            return $vm;
        }
        // 실행 중인 task 가 있으면 upid 를 유지해 끝날 때까지 기다리게 함
        $this->update($vm, ['state' => 'deleting', 'last_error' => null]);
        return $this->advance(self::find((int)$vm['id']));
    }

    public function extend(array $vm, int $seconds): void
    {
        $base = max(time(), (int)($vm['expires_at'] ?? time()));
        $this->update($vm, ['expires_at' => $base + $seconds]);
    }

    public function makePermanent(array $vm): void
    {
        $this->update($vm, ['expires_at' => null]);
    }

    public function makeTemporary(array $vm): void
    {
        $this->update($vm, ['expires_at' => time() + max(1, Settings::int('lease_hours')) * 3600]);
    }

    /** 사용자 전원 제어: start | shutdown | stop | reboot */
    public function power(array $vm, string $action): void
    {
        if (!in_array($action, ['start', 'shutdown', 'stop', 'reboot'], true)) {
            throw new UserError('알 수 없는 동작입니다.');
        }
        if ($vm['state'] !== 'ready') {
            throw new UserError('서버가 준비된 뒤에 사용할 수 있습니다.');
        }
        $this->pve->vmAction($vm['node'], (int)$vm['vmid'], $action);
        $this->update($vm, ['last_error' => null]);
    }

    // ─── 정기 작업 ─────────────────────────────────────────────

    /** 만료된 VM 삭제 요청 + 진행 중인 VM 상태 전진. @return array 처리 로그 */
    public function tick(): array
    {
        $log = [];
        $rows = Db::all("SELECT * FROM vms WHERE state <> 'deleted' ORDER BY id");
        try {
            $cluster = $rows ? $this->pve->clusterVms() : null;
        } catch (Throwable) {
            $cluster = null;
        }
        foreach ($rows as $vm) {
            try {
                // 관리자가 다른 노드로 마이그레이션한 VM 따라가기.
                // 복제 중('creating')에는 설정 파일이 템플릿 노드에 잠시 있다가 옮겨지므로 건너뜀
                if ($cluster !== null && $vm['state'] !== 'creating' && ($moved = $this->followMigration($vm, $cluster))) {
                    $log[] = "move    #{$vm['vmid']} {$vm['name']}: {$vm['node']} -> {$moved['node']}";
                    $vm = $moved;
                }
                if (self::isExpired($vm) && !in_array($vm['state'], ['deleting', 'destroying'], true)) {
                    $log[] = "expire  #{$vm['vmid']} {$vm['name']}";
                    $vm = $this->requestDelete($vm);
                } elseif (in_array($vm['state'], self::TRANSIENT, true)) {
                    $before = $vm['state'];
                    $vm = $this->advance($vm);
                    if ($vm['state'] !== $before) {
                        $log[] = "advance #{$vm['vmid']} {$vm['name']}: {$before} -> {$vm['state']}";
                    }
                }
            } catch (Throwable $e) {
                $log[] = "error   #{$vm['vmid']} {$vm['name']}: " . $e->getMessage();
            }
        }
        Settings::set('last_tick', time());
        return $log;
    }

    /** cron이 없을 때를 대비해 웹 요청에서도 최대 1분에 한 번 tick 실행 */
    public function maybeTick(): void
    {
        if (time() - Settings::int('last_tick') < 60) {
            return;
        }
        Settings::set('last_tick', time());
        try {
            $this->tick();
        } catch (Throwable) {
            // 웹 요청을 실패시키지 않음
        }
    }

    // ─── 대시보드용 상세 정보 ──────────────────────────────────

    public function details(array $vm): array
    {
        try {
            return $this->fetchDetails($vm);
        } catch (ProxmoxException $e) {
            // 마이그레이션으로 노드가 바뀌었으면 다음 tick 을 기다리지 않고 바로 따라감
            $moved = $e->isNotFound() ? $this->followMigration($vm) : null;
            if ($moved === null) {
                throw $e;
            }
            return $this->fetchDetails($moved);
        }
    }

    private function fetchDetails(array $vm): array
    {
        $node = $vm['node'];
        $vmid = (int)$vm['vmid'];
        $status = $this->pve->vmStatus($node, $vmid);
        $conf = $this->pve->vmConfig($node, $vmid);
        $running = ($status['status'] ?? '') === 'running';

        $net = [];
        foreach ($conf as $k => $v) {
            if (preg_match('/^net\d+$/', $k)) {
                $net[$k] = (string)$v;
            }
        }
        ksort($net);

        return [
            'status'   => (string)($status['status'] ?? 'unknown'),
            'qmp'      => (string)($status['qmpstatus'] ?? ''),
            'cpu'      => (float)($status['cpu'] ?? 0),
            'cpus'     => (int)($status['cpus'] ?? 0),
            'mem'      => (int)($status['mem'] ?? 0),
            'maxmem'   => (int)($status['maxmem'] ?? 0),
            'maxdisk'  => (int)($status['maxdisk'] ?? 0),
            'uptime'   => (int)($status['uptime'] ?? 0),
            'netin'    => (int)($status['netin'] ?? 0),
            'netout'   => (int)($status['netout'] ?? 0),
            'ostype'   => (string)($conf['ostype'] ?? ''),
            'cores'    => (int)($conf['cores'] ?? 1),
            'sockets'  => (int)($conf['sockets'] ?? 1),
            'net'      => $net,
            'agent'    => !empty($conf['agent']) && !str_starts_with((string)$conf['agent'], '0'),
            'ips'      => $running && !empty($conf['agent']) ? $this->pve->guestIps($node, $vmid) : [],
        ];
    }
}
