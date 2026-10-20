<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$vm = VmService::findByName((string)($_GET['name'] ?? ''));
if (!$vm) {
    header('Location: ' . vm_url((string)($_GET['name'] ?? '')));
    exit;
}

page_head($vm['name'] . ' 콘솔 — WSU Server', ['bare' => true, 'body_class' => 'console-page']);
?>
<div class="console-full">
  <?php console_shell($vm['name'], true); ?>
</div>
<script type="module">
import { mountConsole } from '<?= h(url('assets/console.js')) ?>?v=1';
const shell = document.querySelector('[data-console]');
const bar = shell.querySelector('.console-bar .title');
const back = document.createElement('a');
back.href = <?= json_encode(vm_url($vm['name']), JSON_UNESCAPED_SLASHES) ?>;
back.className = 'btn btn-soft btn-xs';
back.textContent = '← ' + <?= json_encode($vm['name']) ?>;
bar.prepend(back);
mountConsole(shell, <?= json_encode($vm['name']) ?>).connect();
</script>
<?php page_foot(['bare' => true]);
