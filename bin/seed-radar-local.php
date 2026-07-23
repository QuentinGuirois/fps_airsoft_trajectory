<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Support;
use Fat\Api\Validation\RadarValidator;

$options = getopt('', ['owner-email:', 'replace']);
$ownerEmail = mb_strtolower(trim((string) ($options['owner-email'] ?? '')));
if ($ownerEmail === '') {
    fwrite(STDERR, "Usage : php bin/seed-radar-local.php --owner-email=compte-existant@example.test [--replace]\n");
    exit(2);
}
$config = Config::load($root);
if ($config->isProduction()) {
    fwrite(STDERR, "Refus absolu : les données de recette Radar sont réservées à APP_ENV=local.\n");
    exit(3);
}
$db = Database::connect($config);
$owner = $db->prepare('SELECT id FROM users WHERE email=? AND email_verified_at IS NOT NULL LIMIT 1');
$owner->execute([$ownerEmail]);
$ownerId = $owner->fetchColumn();
if (!is_string($ownerId)) {
    fwrite(STDERR, "Compte local vérifié introuvable. Créez-le par le parcours normal puis relancez la commande.\n");
    exit(4);
}

if (isset($options['replace'])) {
    $delete = $db->prepare("DELETE FROM radar_events WHERE user_id=? AND slug LIKE 'recette-radar-%'");
    $delete->execute([$ownerId]);
}

$paris = new DateTimeZone('Europe/Paris');
$utc = new DateTimeZone('UTC');
$base = (new DateTimeImmutable('next saturday 09:00', $paris))->modify('+7 days');
$fixtures = [
    ['Tours', 'Terrain des Rives', 47.3941440, 0.6848400, 'Tours', '37000', '37', 'Indre-et-Loire', 'Centre-Val de Loire', 'exact'],
    ['Bordeaux', 'Bois Atlantique', 44.8377890, -0.5791800, 'Bordeaux', '33000', '33', 'Gironde', 'Nouvelle-Aquitaine', 'exact'],
    ['Strasbourg', 'Zone Rhénane', 48.5734050, 7.7521110, 'Strasbourg', '67000', '67', 'Bas-Rhin', 'Grand Est', 'exact'],
    ['Haute-Savoie', 'Secteur alpin', 45.8992470, 6.1293840, 'Annecy', '74000', '74', 'Haute-Savoie', 'Auvergne-Rhône-Alpes', 'approximate'],
];

$insert = $db->prepare(
    "INSERT INTO radar_events (id,user_id,slug,state,title,venue_name,short_description,starts_at_utc,"
    . "ends_at_utc,scenario,level_label,beginners_welcome,max_capacity,price_cents,minimum_age,"
    . "rental_details,catering_details,toilets_available,latitude,longitude,location_method,location_confirmed_at,location_visibility,"
    . "exact_address,public_location_label,city,postal_code,department_code,department,region,registration_url,"
    . "published_at,expires_at) VALUES (:id,:user_id,:slug,'published',:title,:venue,:description,:starts_at,"
    . ":ends_at,:scenario,:level,1,80,2500,16,'Répliques AEG disponibles sur réservation','Repas tiré du sac',:toilets,"
    . ":latitude,:longitude,'geocoded',UTC_TIMESTAMP(),:visibility,:exact_address,:public_label,:city,:postal_code,"
    . ":department_code,:department,:region,'https://example.org/inscription-radar',UTC_TIMESTAMP(),:expires_at)"
);
$ruleInsert = $db->prepare(
    'INSERT INTO radar_event_rules (event_id,rule_type,rule_state,joules,details) VALUES (?,?,?,?,?)'
);
$linkInsert = $db->prepare(
    "INSERT INTO radar_event_links (id,event_id,link_type,url,sort_order) VALUES (?,?,'website','https://example.org',0)"
);

$db->beginTransaction();
try {
    foreach ($fixtures as $index => [$name, $venue, $latitude, $longitude, $city, $postalCode, $departmentCode, $department, $region, $visibility]) {
        $id = Support::uuid();
        $start = $base->modify('+' . ($index * 7) . ' days');
        $end = $start->modify('+8 hours');
        $slug = 'recette-radar-' . strtolower(str_replace([' ', '-'], '-', $name)) . '-' . substr(str_replace('-', '', $id), 0, 8);
        $insert->execute([
            'id' => $id,
            'user_id' => $ownerId,
            'slug' => $slug,
            'title' => "Opération recette {$name}",
            'venue' => $venue,
            'description' => "Fiche de recette locale pour contrôler la carte et le briefing à {$name}.",
            'starts_at' => $start->setTimezone($utc)->format('Y-m-d H:i:s'),
            'ends_at' => $end->setTimezone($utc)->format('Y-m-d H:i:s'),
            'scenario' => 'Contrôle de zone',
            'level' => 'Tous niveaux',
            'toilets' => $index % 2 === 0 ? 1 : 0,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'visibility' => $visibility,
            'exact_address' => "Adresse privée de recette {$name}",
            'public_label' => $visibility === 'approximate' ? "Commune d’{$city}" : $venue,
            'city' => $city,
            'postal_code' => $postalCode,
            'department_code' => $departmentCode,
            'department' => $department,
            'region' => $region,
            'expires_at' => $end->setTimezone($utc)->format('Y-m-d H:i:s'),
        ]);
        foreach (RadarValidator::RULE_TYPES as $ruleIndex => $type) {
            $state = match ($ruleIndex % 4) {
                0 => 'allowed',
                1 => 'specific',
                2 => 'forbidden',
                default => 'not_communicated',
            };
            $ruleInsert->execute([$id, $type, $state, $ruleIndex < 4 ? 1.5 + ($ruleIndex * .3) : null, $state === 'specific' ? 'Distance minimale communiquée au briefing.' : null]);
        }
        $linkInsert->execute([Support::uuid(), $id]);
    }
    $db->commit();
} catch (Throwable $error) {
    $db->rollBack();
    throw $error;
}
fwrite(STDOUT, count($fixtures) . " fiches de recette Radar locales ajoutées.\n");
