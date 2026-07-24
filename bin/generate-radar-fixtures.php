<?php
declare(strict_types=1);

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Validation\RadarValidator;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

$options = getopt('', ['count:', 'replace']);
$count = filter_var($options['count'] ?? null, FILTER_VALIDATE_INT);
if ($count === false || !in_array($count, [1, 10, 50, 200], true) || !isset($options['replace'])) {
    fwrite(STDERR, "Usage : php bin/generate-radar-fixtures.php --count=1|10|50|200 --replace\n");
    exit(2);
}

$config = Config::load($root);
$dsn = $config->get('DB_DSN');
if (
    $config->isProduction()
    || $config->get('APP_ENV') !== 'local'
    || !preg_match('/dbname=([a-zA-Z0-9_]+)/', $dsn, $database)
    || !preg_match('/(?:_test|_local|^fat_test$)/', $database[1])
    || !preg_match('/host=(?:127\.0\.0\.1|localhost)/', $dsn)
) {
    fwrite(STDERR, "Refus absolu : les fixtures Radar exigent APP_ENV=local et une base locale *_test ou *_local.\n");
    exit(3);
}

/** UUID stable réservé aux données locales. */
function fixtureUuid(string $key): string
{
    $hex = hash('sha256', 'fat-radar-fixture:' . $key);
    return sprintf(
        '%s-%s-4%s-a%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 13, 3),
        substr($hex, 17, 3),
        substr($hex, 20, 12),
    );
}

$db = Database::connect($config);
$ownerId = fixtureUuid('owner');
$passwordHash = password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
if (!is_string($passwordHash)) {
    throw new RuntimeException('Impossible de préparer le propriétaire local des fixtures.');
}
$db->beginTransaction();
try {
    $owner = $db->prepare(
        "INSERT INTO users (id,email,pseudo,password_hash,role,email_verified_at,terms_version,terms_accepted_at) "
        . "VALUES (?,'radar-fixture@local.invalid','radar_fixture',?,'user',UTC_TIMESTAMP(),'2026-07-23',UTC_TIMESTAMP()) "
        . "ON DUPLICATE KEY UPDATE id=id"
    );
    $owner->execute([$ownerId, $passwordHash]);
    $delete = $db->prepare('DELETE FROM radar_events WHERE is_fixture=1');
    $delete->execute();

    $insert = $db->prepare(
        "INSERT INTO radar_events (id,user_id,external_key,slug,state,moderation_state,record_visibility,claim_state,title,"
        . "organizer_name,organizer_type,event_type,terrain_type,venue_name,short_description,starts_at_utc,ends_at_utc,"
        . "timezone,schedule_precision,max_capacity,price_cents,price_min_cents,price_max_cents,toilets_available,"
        . "latitude,longitude,location_method,location_confirmed_at,location_visibility,location_precision,geocode_status,"
        . "geocode_checked_at,public_location_label,city,postal_code,department_code,registration_url,"
        . "requires_pre_publication_check,is_fixture,import_batch_key) "
        . "VALUES (?,?,?,?,'draft','visible','private','unclaimed',?,?,?,?,?,?,?,?,?,'Europe/Paris','datetime',"
        . "NULL,NULL,NULL,NULL,?,?,?,?,UTC_TIMESTAMP(),?,?,?,UTC_TIMESTAMP(),?,?,?,?,?,0,1,'local-load-fixtures')"
    );
    $rule = $db->prepare(
        "INSERT INTO radar_event_rules (event_id,rule_type,rule_state,details) VALUES (?,?,'not_communicated','NC')"
    );
    $base = new DateTimeImmutable('2026-08-01 07:00:00', new DateTimeZone('UTC'));
    for ($index = 1; $index <= $count; $index++) {
        $id = fixtureUuid(sprintf('event-%03d', $index));
        $externalKey = sprintf('fixture-radar-%03d', $index);
        $latitude = round(42.65 + (($index * 37) % 570) / 100, 6);
        $longitude = round(-4.75 + (($index * 53) % 1_360) / 100, 6);
        $start = $base->modify('+' . (($index - 1) * 2) . ' days');
        $end = $start->modify('+8 hours');
        $city = sprintf('Ville test %03d', $index);
        $departmentCode = sprintf('%02d', (($index - 1) % 95) + 1);
        $insert->execute([
            $id,
            $ownerId,
            $externalKey,
            $externalKey,
            "Fixture Radar {$index}",
            'Organisateur local de charge',
            'organizer_unverified',
            $index % 5 === 0 ? 'milsim_24h' : 'dominicale',
            $index % 3 === 0 ? 'CQB' : 'foret',
            "Terrain local {$index}",
            'Donnée privée et déterministe réservée au test de charge de la carte.',
            $start->format('Y-m-d H:i:s'),
            $end->format('Y-m-d H:i:s'),
            $index % 2,
            $latitude,
            $longitude,
            'manual',
            'approximate',
            'city',
            'validated',
            "Position approximative — {$city}",
            $city,
            sprintf('%05d', 1000 + $index),
            $departmentCode,
            "https://example.invalid/fixture/{$index}",
        ]);
        foreach (RadarValidator::RULE_TYPES as $type) {
            $rule->execute([$id, $type]);
        }
    }
    $db->commit();
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $error;
}

fwrite(STDOUT, "{$count} fixtures Radar privées déterministes prêtes dans {$database[1]}.\n");
