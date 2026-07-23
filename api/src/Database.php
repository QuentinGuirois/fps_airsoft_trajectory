<?php
declare(strict_types=1);

namespace Fat\Api;

use PDO;

final class Database
{
    public static function connect(Config $config): PDO
    {
        $initCommandAttribute = defined('\Pdo\Mysql::ATTR_INIT_COMMAND')
            ? constant('\Pdo\Mysql::ATTR_INIT_COMMAND')
            : constant(PDO::class . '::MYSQL_ATTR_INIT_COMMAND');
        return new PDO($config->get('DB_DSN'), $config->get('DB_USER'), $config->get('DB_PASSWORD'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            $initCommandAttribute => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'",
        ]);
    }
}
