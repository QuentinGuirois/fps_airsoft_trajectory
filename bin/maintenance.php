<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;

$config = Config::load($root);
$db = Database::connect($config);
$images = $config->storagePath('images');
$db->exec('DELETE FROM sessions WHERE expires_at<UTC_TIMESTAMP()');
$db->exec('DELETE FROM rate_limits WHERE expires_at<UTC_TIMESTAMP()');
$db->exec('DELETE FROM email_verification_tokens WHERE expires_at<UTC_TIMESTAMP()-INTERVAL 7 DAY');
$db->exec('DELETE FROM password_reset_tokens WHERE expires_at<UTC_TIMESTAMP()-INTERVAL 7 DAY');
$expiredUsers = $db->query('SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at<=UTC_TIMESTAMP() ORDER BY deletion_requested_at LIMIT 100')->fetchAll(PDO::FETCH_COLUMN);
foreach ($expiredUsers as $userId) {
    $paths = $db->prepare(
        'SELECT image_path FROM replica_posts WHERE user_id=? AND image_path IS NOT NULL '
        . 'UNION SELECT r.image_path FROM replica_image_retention r JOIN replica_posts p ON p.id=r.replica_id WHERE p.user_id=?'
    );
    $paths->execute([$userId, $userId]);
    $db->beginTransaction();
    $delete = $db->prepare('DELETE FROM users WHERE id=? AND deletion_requested_at<=UTC_TIMESTAMP()');
    $delete->execute([$userId]);
    $db->commit();
    if ($delete->rowCount() === 1) {
        foreach ($paths->fetchAll(PDO::FETCH_COLUMN) as $name) {
            if (preg_match('/^[a-f0-9]{24}\.webp$/', (string) $name)) {
                @unlink($images . DIRECTORY_SEPARATOR . $name);
            }
        }
    }
}
$retained = $db->query('SELECT id,image_path FROM replica_image_retention WHERE delete_after<UTC_TIMESTAMP() ORDER BY id LIMIT 500')->fetchAll();
foreach ($retained as $row) {
    $path = $images . DIRECTORY_SEPARATOR . basename((string) $row['image_path']);
    if (preg_match('/^[a-f0-9]{24}\.webp$/', basename($path))) {
        @unlink($path);
    }
    $delete = $db->prepare('DELETE FROM replica_image_retention WHERE id=?');
    $delete->execute([$row['id']]);
}
$known = array_flip($db->query("SELECT image_path FROM replica_posts WHERE image_path IS NOT NULL UNION SELECT image_path FROM replica_image_retention")->fetchAll(PDO::FETCH_COLUMN));
foreach (glob($images . '/*.webp') ?: [] as $path) {
    if (!isset($known[basename($path)]) && filemtime($path) < time() - 604800) {
        @unlink($path);
    }
}
