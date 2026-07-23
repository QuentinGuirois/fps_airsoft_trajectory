<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Support;

$config = Config::load($root);
$dsn = $config->get('DB_DSN');
if (
    $config->isProduction()
    || !preg_match('/dbname=([a-zA-Z0-9_]+)/', $dsn, $database)
    || !preg_match('/(?:_test|_local|^fat_test$)/', $database[1])
    || !preg_match('/host=(?:127\.0\.0\.1|localhost)/', $dsn)
) {
    fwrite(STDERR, "Refus : le compte de recette ne peut être créé que dans une base locale *_test ou *_local avec APP_ENV=local.\n");
    exit(3);
}

$db = Database::connect($config);
$email = 'admin@local.test';
$pseudo = 'admin';
$algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
$passwordHash = password_hash('admin', $algorithm);
if (!is_string($passwordHash)) {
    throw new RuntimeException('Impossible de calculer le mot de passe local.');
}

$db->beginTransaction();
try {
    $lookup = $db->prepare('SELECT id FROM users WHERE email=? OR LOWER(pseudo)=? FOR UPDATE');
    $lookup->execute([$email, $pseudo]);
    $matches = $lookup->fetchAll(PDO::FETCH_COLUMN);
    if (count($matches) > 1) {
        throw new RuntimeException('Deux comptes locaux entrent en conflit avec l’identité admin.');
    }
    $id = isset($matches[0]) ? (string) $matches[0] : Support::uuid();
    if ($matches === []) {
        $insert = $db->prepare(
            "INSERT INTO users (id,email,pseudo,password_hash,role,email_verified_at,terms_version,terms_accepted_at) "
            . "VALUES (?,?,?,?,'admin',UTC_TIMESTAMP(),'2026-07-23',UTC_TIMESTAMP())"
        );
        $insert->execute([$id, $email, $pseudo, $passwordHash]);
    } else {
        $update = $db->prepare(
            "UPDATE users SET email=?,pseudo=?,password_hash=?,role='admin',email_verified_at=UTC_TIMESTAMP(),"
            . "terms_version='2026-07-23',terms_accepted_at=UTC_TIMESTAMP(),deletion_requested_at=NULL,version=version+1 WHERE id=?"
        );
        $update->execute([$email, $pseudo, $passwordHash, $id]);
    }
    $db->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$id]);
    $db->commit();
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $error;
}

fwrite(STDOUT, "Compte de recette local prêt : admin / admin ({$database[1]}).\n");
