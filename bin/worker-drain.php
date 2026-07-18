<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;

$config = Config::load($root);
$db = Database::connect($config);
$queue = $config->storagePath('queue');
$images = $config->storagePath('images');
$events = $config->storagePath('events');
$locks = $config->storagePath('locks');
foreach ([$queue, $images, $events, $locks] as $directory) {
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Impossible de créer le stockage privé.');
    }
}
$lock = fopen($locks . '/worker-drain.lock', 'c+');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    exit(0);
}

try {
    $db->exec("UPDATE image_jobs SET status='processing',started_at=COALESCE(started_at,UTC_TIMESTAMP()),attempt_count=attempt_count+1 WHERE status='queued'");
    $command = [
        $config->get('REMBG_PYTHON', 'python'),
        $config->get('REMBG_WORKER', $root . '/server/background-removal/worker.py'),
        '--queue', $queue,
        '--public', $images,
        '--events', $events,
        '--timeout', (string) $config->int('REMBG_TIMEOUT_SECONDS', 150),
        '--drain',
    ];
    $environment = [
        'PATH' => getenv('PATH') ?: '',
        'HOME' => getenv('HOME') ?: '',
        'SYSTEMROOT' => getenv('SYSTEMROOT') ?: '',
        'TEMP' => getenv('TEMP') ?: sys_get_temp_dir(),
        'TMP' => getenv('TMP') ?: sys_get_temp_dir(),
        'USERPROFILE' => getenv('USERPROFILE') ?: '',
        'LOCALAPPDATA' => getenv('LOCALAPPDATA') ?: '',
        'LD_LIBRARY_PATH' => getenv('LD_LIBRARY_PATH') ?: '',
        'FAT_REMBG_THREADS' => (string) min(4, max(1, $config->int('REMBG_THREADS', 1))),
        'U2NET_HOME' => $config->get('REMBG_MODEL_HOME', $config->storagePath('models')),
    ];
    $environment = array_filter($environment, static fn(string $value): bool => $value !== '');
    $pipes = [];
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root, $environment);
    if (!is_resource($process)) {
        throw new RuntimeException('Impossible de démarrer le worker.');
    }
    fclose($pipes[0]);
    stream_get_contents($pipes[1]);
    stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    if (!in_array($exitCode, [0, 2], true)) {
        error_log('FAT worker: exit non nul');
    }

    foreach (glob($events . '/*.json') ?: [] as $eventPath) {
        $jobId = basename($eventPath, '.json');
        if (!preg_match('/^[a-f0-9-]{36}$/', $jobId)) {
            @unlink($eventPath);
            continue;
        }
        try {
            $event = json_decode((string) file_get_contents($eventPath), true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($event) || ($event['jobId'] ?? '') !== $jobId) {
                throw new RuntimeException('Événement de worker incohérent.');
            }
            $db->beginTransaction();
            $select = $db->prepare('SELECT j.replica_id,j.status,r.user_id FROM image_jobs j JOIN replica_posts r ON r.id=j.replica_id WHERE j.id=? FOR UPDATE');
            $select->execute([$jobId]);
            $job = $select->fetch();
            if (!$job || !in_array($job['status'], ['queued','processing'], true)) {
                $db->rollBack();
                @unlink($eventPath);
                continue;
            }
            if (($event['status'] ?? '') === 'ready') {
                $name = (string) ($event['path'] ?? '');
                $path = $images . DIRECTORY_SEPARATOR . $name;
                if (!preg_match('/^[a-f0-9]{24}\.webp$/', $name) || !is_file($path)) {
                    throw new RuntimeException('Sortie WebP absente.');
                }
                $bytes = filesize($path);
                $info = @getimagesize($path);
                $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
                $sha = hash_file('sha256', $path);
                if ($bytes === false || $bytes < 1 || $bytes > 102_400 || $info === false || $mime !== 'image/webp'
                    || !hash_equals((string) ($event['sha256'] ?? ''), (string) $sha)
                    || (int) ($event['width'] ?? 0) !== (int) $info[0] || (int) ($event['height'] ?? 0) !== (int) $info[1]) {
                    @unlink($path);
                    throw new RuntimeException('WebP final invalide.');
                }
                $scores = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $db->prepare("UPDATE image_jobs SET status='ready',result_json=?,finished_at=UTC_TIMESTAMP() WHERE id=?")
                    ->execute([$scores, $jobId]);
                $db->prepare("UPDATE replica_posts SET image_status='ready',image_path=?,image_mime='image/webp',image_bytes=?,image_width=?,image_height=?,image_sha256=?,image_scores_json=?,image_generated_at=UTC_TIMESTAMP(),version=version+1 WHERE id=?")
                    ->execute([$name, $bytes, $info[0], $info[1], $sha, $scores, $job['replica_id']]);
            } else {
                $code = preg_match('/^[a-z0-9_]{1,64}$/', (string) ($event['code'] ?? '')) ? $event['code'] : 'rejected';
                $db->prepare("UPDATE image_jobs SET status='rejected',last_error_code=?,result_json=?,finished_at=UTC_TIMESTAMP() WHERE id=?")
                    ->execute([$code, json_encode(['status' => 'rejected', 'code' => $code], JSON_THROW_ON_ERROR), $jobId]);
                $db->prepare("UPDATE replica_posts SET image_status='rejected',version=version+1 WHERE id=?")
                    ->execute([$job['replica_id']]);
            }
            $db->commit();
            @unlink($eventPath);
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            error_log('FAT worker reconcile ' . $jobId . ' ' . get_class($error));
        }
    }
} finally {
    flock($lock, LOCK_UN);
    fclose($lock);
}
