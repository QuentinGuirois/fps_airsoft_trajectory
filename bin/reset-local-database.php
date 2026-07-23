<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;

if (!in_array('--yes', $argv, true)) {
    fwrite(STDERR, "Commande destructive locale. Relance avec --yes après avoir vérifié FAT_CONFIG_FILE.\n");
    exit(2);
}
$config = Config::load($root);
$dsn = $config->get('DB_DSN');
if (
    $config->isProduction()
    || !preg_match('/dbname=([a-zA-Z0-9_]+)/', $dsn, $matches)
    || !preg_match('/(?:_test|_local|^fat_test$)/', $matches[1])
    || !preg_match('/host=(?:127\.0\.0\.1|localhost)/', $dsn)
) {
    fwrite(STDERR, "Refus : seuls une base locale explicitement nommée *_test ou *_local et APP_ENV=local sont réinitialisables.\n");
    exit(3);
}
$db = Database::connect($config);
$tables = $db->query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'
)->fetchAll(PDO::FETCH_COLUMN);
$db->exec('SET FOREIGN_KEY_CHECKS=0');
foreach ($tables as $table) {
    if (!preg_match('/^[a-z0-9_]+$/', (string) $table)) {
        throw new RuntimeException('Nom de table local inattendu.');
    }
    $db->exec('DROP TABLE `' . $table . '`');
}
$db->exec('SET FOREIGN_KEY_CHECKS=1');
fwrite(STDOUT, "Base locale {$matches[1]} vidée. Réapplication des migrations…\n");
require $root . '/bin/migrate.php';
