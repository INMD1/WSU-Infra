<?php
declare(strict_types=1);

/**
 * Proxmox 클러스터에서 새 VM을 만들 노드를 고릅니다.
 * (설정: 관리자 페이지 → SQLite settings 테이블의 placement, placement_nodes)
 *
 * 온라인 노드 X 는 아래 중 하나를 만족하면 후보가 됩니다.
 *   1) 템플릿이 X 에 있다                               → X 에서 그대로 복제
 *   2) X 에 같은 이름의 템플릿 사본이 있다                → 그 사본에서 복제 (로컬 스토리지 클러스터용)
 *   3) 템플릿 디스크가 모두 공유 스토리지(Ceph, NFS 등)에 있고 X 에서도 보인다
 *                                                       → 템플릿 노드에서 target=X 로 복제
 *
 * 후보 중 메모리 할당률이 가장 낮은 노드를 고릅니다.
 *   (실행 중인 VM 메모리 합 + 복제 중인 우리 VM 수 × 템플릿 메모리) / 노드 전체 메모리
 * 실제 사용량 대신 할당량을 쓰는 이유: ZFS ARC 나 게스트의 지연 할당 때문에 사용량은 크게 출렁이고,
 * 동시에 여러 개를 만들 때 아직 부팅 전인 VM이 반영되지 않기 때문입니다.
 */
final class Placement
{
    private const DRIVE_KEY = '/^(?:(?:ide|sata|scsi|virtio)\d+|efidisk0|tpmstate0)$/';
    /** shared 플래그를 주지 않는 오래된 PVE 용: 원래 여러 노드에서 공유되는 스토리지 종류 */
    private const SHARED_TYPES = ['rbd', 'cephfs', 'nfs', 'cifs', 'glusterfs', 'iscsi', 'iscsidirect', 'zfs'];

    /** @var array<string, array<string, bool>>|null  [node][storage] => shared 여부 (사용 가능한 것만) */
    private ?array $storages = null;
    /** @var string[]|null|false  템플릿 디스크의 스토리지 ID 목록 (false = 아직 안 읽음, null = 다른 노드로 복제 불가) */
    private array|null|false $templateStorages = false;

    public function __construct(private Proxmox $pve)
    {
    }

    /**
     * @param array $cluster Proxmox::clusterVms() 결과 (템플릿이 들어 있어야 함)
     * @return array{node: string, source_node: string, source_id: int}
     *   node = VM이 만들어질 노드, source_node/source_id = 복제할 템플릿
     */
    public function choose(int $templateId, array $cluster): array
    {
        $template = $cluster[$templateId];
        $srcNode = (string)$template['node'];
        $fallback = ['node' => $srcNode, 'source_node' => $srcNode, 'source_id' => $templateId];

        // 관리자 페이지에서 바꾸는 값 (SQLite settings 테이블)
        if (Settings::str('placement') !== 'auto') {
            return $fallback;
        }

        $allowed = Settings::strList('placement_nodes');
        $nodes = array_filter(
            $this->pve->clusterNodes(),
            static fn($n) => ($n['status'] ?? '') === 'online' && (!$allowed || in_array((string)$n['node'], $allowed, true))
        );

        $candidates = [];
        foreach ($nodes as $name => $_) {
            $name = (string)$name;
            $source = $this->sourceFor($name, $templateId, $template, $cluster);
            if ($source !== null) {
                $candidates[$name] = $source;
            }
        }

        if (!$candidates) {
            if ($allowed) {
                error_log('[vmrental] 분산 대상 노드(' . implode(', ', $allowed) . ") 중 템플릿 {$templateId} 을(를) 복제할 수 있는 온라인 노드가 없습니다.");
                throw new UserError('지금은 서버를 만들 수 있는 노드가 없습니다. 관리자에게 문의해 주세요.');
            }
            // 노드 목록을 볼 수 없거나(권한 부족) 단일 노드 환경이면 예전처럼 템플릿 노드에 만듦
            return $fallback;
        }

        $node = $this->leastLoaded($candidates, $nodes, $cluster, (int)($template['maxmem'] ?? 0));
        return ['node' => $node] + $candidates[$node];
    }

    /** 노드 $node 에 만들려면 어떤 템플릿에서 복제해야 하는지. 불가능하면 null */
    private function sourceFor(string $node, int $templateId, array $template, array $cluster): ?array
    {
        $srcNode = (string)$template['node'];
        $storage = config('vm.full_clone') && config('vm.storage') ? (string)config('vm.storage') : null;

        // 1) 템플릿 노드 · 2) 같은 이름의 템플릿 사본이 있는 노드  →  그 노드 안에서 복제
        $local = $node === $srcNode ? $templateId : $this->copyOn($node, $template, $cluster);
        if ($local !== null) {
            if ($storage !== null && ($st = $this->storages()) && !isset($st[$node][$storage])) {
                return null;   // 대상 스토리지가 이 노드에 없음
            }
            return ['source_node' => $node, 'source_id' => $local];
        }

        // 3) 공유 스토리지 → 템플릿 노드에서 target 으로 복제.
        //    복제(디스크 복사)는 템플릿 노드에서 실행되므로 대상 스토리지도 양쪽에서 보이는 공유 스토리지여야 함
        $st = $this->storages();
        $ids = $st ? $this->templateStorages($srcNode, $templateId) : null;
        if ($ids === null) {
            return null;
        }
        foreach ($storage !== null ? [...$ids, $storage] : $ids as $id) {
            if (($st[$srcNode][$id] ?? false) !== true || !isset($st[$node][$id])) {
                return null;
            }
        }
        return ['source_node' => $srcNode, 'source_id' => $templateId];
    }

    /** $node 에 있는 같은 이름의 템플릿 VMID */
    private function copyOn(string $node, array $template, array $cluster): ?int
    {
        $name = (string)($template['name'] ?? '');
        if ($name === '') {
            return null;
        }
        ksort($cluster);
        foreach ($cluster as $vmid => $r) {
            if (!empty($r['template']) && (string)$r['node'] === $node && (string)($r['name'] ?? '') === $name) {
                return (int)$vmid;
            }
        }
        return null;
    }

    private function storages(): array
    {
        if ($this->storages === null) {
            $this->storages = [];
            try {
                foreach ($this->pve->clusterStorages() as $s) {
                    if (($s['status'] ?? '') !== 'available') {
                        continue;
                    }
                    $shared = array_key_exists('shared', $s)
                        ? (bool)$s['shared']
                        : in_array((string)($s['plugintype'] ?? ''), self::SHARED_TYPES, true);
                    $this->storages[(string)$s['node']][(string)$s['storage']] = $shared;
                }
            } catch (ProxmoxException $e) {
                if ($e->httpStatus === 0) {
                    throw $e;
                }
                // 스토리지를 볼 권한이 없으면 스토리지 검사 없이 진행 (다른 노드로의 복제는 하지 않음)
            }
        }
        return $this->storages;
    }

    /** @return string[]|null  null = 경로로 직접 붙인 디스크 등이 있어 다른 노드로 복제할 수 없음 */
    private function templateStorages(string $node, int $vmid): ?array
    {
        if ($this->templateStorages !== false) {
            return $this->templateStorages;
        }
        try {
            $conf = $this->pve->vmConfig($node, $vmid);
        } catch (ProxmoxException $e) {
            if ($e->httpStatus === 0) {
                throw $e;
            }
            return $this->templateStorages = null;
        }
        $ids = [];
        foreach ($conf as $key => $value) {
            if (!preg_match(self::DRIVE_KEY, (string)$key)) {
                continue;
            }
            $file = explode(',', (string)$value, 2)[0];
            if (str_starts_with($file, 'file=')) {
                $file = substr($file, 5);
            }
            if ($file === '' || $file === 'none' || $file === 'cdrom') {
                continue;
            }
            if (!preg_match('/^([A-Za-z][A-Za-z0-9._-]*):/', $file, $m)) {
                return $this->templateStorages = null;
            }
            $ids[$m[1]] = true;
        }
        return $this->templateStorages = array_keys($ids);
    }

    /** 메모리 할당률이 가장 낮은 후보 노드 (같으면 이름순) */
    private function leastLoaded(array $candidates, array $nodes, array $cluster, int $templateMem): string
    {
        $allocated = [];
        foreach ($cluster as $r) {
            if (empty($r['template']) && ($r['status'] ?? '') === 'running') {
                $n = (string)$r['node'];
                $allocated[$n] = ($allocated[$n] ?? 0) + (int)($r['maxmem'] ?? 0);
            }
        }
        // 복제 중인 VM은 아직 실행 전이라 위 합계에 없음
        foreach (Db::all("SELECT node, COUNT(*) AS c FROM vms WHERE state = 'creating' GROUP BY node") as $r) {
            $n = (string)$r['node'];
            $allocated[$n] = ($allocated[$n] ?? 0) + (int)$r['c'] * $templateMem;
        }

        ksort($candidates);
        $best = null;
        $bestScore = INF;
        foreach (array_keys($candidates) as $name) {
            $max = (int)($nodes[$name]['maxmem'] ?? 0);
            $score = $max > 0 ? ($allocated[$name] ?? 0) / $max : INF;
            if ($best === null || $score < $bestScore) {
                $best = (string)$name;
                $bestScore = $score;
            }
        }
        return $best;
    }
}
