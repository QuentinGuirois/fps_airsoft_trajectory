<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;

$config = Config::load($root);
$db = Database::connect($config);
$directory = $root . '/database/migrations';
$files = glob($directory . '/*.sql') ?: [];
sort($files, SORT_STRING);
if ($files === []) {
    throw new RuntimeException('Aucune migration trouvée.');
}

foreach ($files as $file) {
    $version = basename($file);
    $sql = file_get_contents($file);
    if ($sql === false || trim($sql) === '') {
        throw new RuntimeException("Migration vide: {$version}");
    }
    $checksum = hash('sha256', $sql);
    if ($version !== '000_schema.sql') {
        $known = $db->prepare('SELECT checksum_sha256 FROM schema_migrations WHERE version=?');
        $known->execute([$version]);
        $saved = $known->fetchColumn();
        if (is_string($saved)) {
            if (!hash_equals($saved, $checksum)) {
                throw new RuntimeException("Checksum modifié pour {$version}");
            }
            fwrite(STDOUT, "déjà appliquée {$version}\n");
            continue;
        }
    }
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
        $db->exec($statement);
    }
    $record = $db->prepare('INSERT INTO schema_migrations (version,checksum_sha256) VALUES (?,?) ON DUPLICATE KEY UPDATE checksum_sha256=VALUES(checksum_sha256)');
    $record->execute([$version, $checksum]);
    fwrite(STDOUT, "appliquée {$version}\n");
}
