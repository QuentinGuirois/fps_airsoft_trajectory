<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Support;

$config = Config::load($root);
if ($config->isProduction()) {
    throw new RuntimeException('Fixture Radar interdite en production.');
}
$db = Database::connect($config);
$users = [
    ['radar-owner@example.test', 'RadarOwner', 'user', str_repeat('a', 64), str_repeat('1', 64)],
    ['radar-intruder@example.test', 'RadarIntruder', 'user', str_repeat('b', 64), str_repeat('2', 64)],
    ['radar-admin@example.test', 'RadarAdmin', 'admin', str_repeat('c', 64), str_repeat('3', 64)],
];
$insertUser = $db->prepare(
    'INSERT INTO users (id,email,pseudo,password_hash,role,email_verified_at,terms_version,terms_accepted_at) '
    . 'VALUES (?,?,?,?,?,UTC_TIMESTAMP(),\'2026-07\',UTC_TIMESTAMP())'
);
$insertSession = $db->prepare(
    'INSERT INTO sessions (id,user_id,token_hash,csrf_token,expires_at) VALUES (?,?,?,?,UTC_TIMESTAMP()+INTERVAL 1 DAY)'
);
$result = [];
foreach ($users as [$email, $pseudo, $role, $token, $csrf]) {
    $id = Support::uuid();
    $insertUser->execute([$id, $email, $pseudo, password_hash('MotDePasseFixture123', PASSWORD_DEFAULT), $role]);
    $insertSession->execute([Support::uuid(), $id, Support::tokenHash($token), $csrf]);
    $result[$role === 'admin' ? 'admin' : ($pseudo === 'RadarOwner' ? 'owner' : 'intruder')] = [
        'id' => $id,
        'cookie' => 'fat_session=' . $token,
        'csrf' => $csrf,
    ];
}
echo json_encode($result, JSON_THROW_ON_ERROR);
