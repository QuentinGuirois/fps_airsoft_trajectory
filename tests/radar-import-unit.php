<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\HttpException;
use Fat\Api\Services\GeocodingService;
use Fat\Api\Validation\RadarSeedValidator;

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @return array<string,mixed> */
function radarJson(string $path): array
{
    $raw = file_get_contents($path);
    check(is_string($raw), "JSON absent : {$path}");
    $source = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    check(is_array($source), "JSON invalide : {$path}");
    return $source;
}

$basePath = $root . '/docs/fat-radar/fat-radar-events-seed-2026-07-24.importable-v1.json';
$enrichedPath = $root . '/docs/fat-radar/fat-radar-events-enriched-2026-07-24.json';
$source = radarJson($basePath);
$validated = RadarSeedValidator::document($source);
check(count($validated['events']) === 40, 'Le lot doit contenir 40 événements.');
check(count(array_unique(array_column($validated['events'], 'externalKey'))) === 40, 'Les clés externes doivent être uniques.');
check(
    count(array_filter($validated['events'], static fn(array $event): bool => $event['sourceTier'] === 'primary')) === 40,
    'Les 40 événements doivent provenir de sources primaires.',
);
check(
    count(array_filter($validated['events'], static fn(array $event): bool => $event['schedulePrecision'] === 'date')) === 22,
    'Les 22 événements date seule doivent rester identifiables.',
);
check(
    count(array_filter($validated['events'], static fn(array $event): bool => $event['sourceUrl'] !== '')) === 40,
    'Chaque événement doit avoir une source officielle.',
);
check(
    count(array_filter($validated['events'], static fn(array $event): bool => $event['postalCode'] !== null)) === 32,
    'Le document mis à jour ne fournit que 32 codes postaux explicites.',
);
check(
    array_sum(array_map(static fn(array $event): int => count($event['rules']), $validated['events'])) === 280,
    'Le lot v1 doit être normalisé sur 280 règles NC.',
);

$enrichedSource = radarJson($enrichedPath);
$enriched = RadarSeedValidator::document($enrichedSource);
check($enriched['schemaVersion'] === '1.1.0', 'Le lot enrichi doit utiliser le schéma 1.1.0.');
check(count($enriched['events']) === 40, 'Le lot enrichi doit conserver les 40 événements.');
check(
    array_sum(array_map(static fn(array $event): int => count($event['rules']), $enriched['events'])) === 280,
    'Le lot enrichi doit contenir exactement 280 règles.',
);
$knownRules = [];
foreach ($enriched['events'] as $event) {
    foreach ($event['rules'] as $rule) {
        if ($rule['state'] !== 'not_communicated') {
            $knownRules[] = $rule;
            check($rule['evidence'] !== null, 'Toute règle connue doit avoir une preuve officielle.');
        } else {
            check($rule['joules'] === null && $rule['details'] === 'NC' && $rule['evidence'] === null, 'NC doit rester strict.');
        }
    }
}
check(count($knownRules) === 3, 'Seules trois règles explicitement documentées doivent être connues.');

$missingEvidence = $enrichedSource;
foreach ($missingEvidence['events'] as &$event) {
    foreach ($event['rules'] as &$rule) {
        if ($rule['state'] !== 'not_communicated') {
            $rule['evidence'] = null;
            break 2;
        }
    }
}
unset($event, $rule);
try {
    RadarSeedValidator::document($missingEvidence);
    throw new RuntimeException('Une règle connue sans preuve doit être refusée.');
} catch (HttpException $error) {
    check(
        in_array($error->errorCode, ['validation', 'radar_seed_validation'], true),
        'La preuve manquante doit produire une erreur de validation.',
    );
}

$invalidNc = $enrichedSource;
$invalidNc['events'][0]['rules'][0]['joules'] = 1.2;
try {
    RadarSeedValidator::document($invalidNc);
    throw new RuntimeException('Une règle NC avec joules doit être refusée.');
} catch (HttpException $error) {
    check(
        in_array($error->errorCode, ['validation', 'radar_seed_validation'], true),
        'Le refus NC doit être une validation.',
    );
}

$unknown = $source;
$unknown['events'][0]['owner_email'] = 'interdit';
try {
    RadarSeedValidator::document($unknown);
    throw new RuntimeException('Un champ inconnu doit être refusé.');
} catch (HttpException $error) {
    check($error->errorCode === 'validation', 'Le refus de champ inconnu doit être une validation.');
}

$reflection = new ReflectionClass(GeocodingService::class);
/** @var GeocodingService $geocoder */
$geocoder = $reflection->newInstanceWithoutConstructor();
$suggestions = [[
    'label' => 'Tours',
    'latitude' => 47.394144,
    'longitude' => 0.684840,
    'city' => 'Tours',
    'postalCode' => '37000',
    'departmentCode' => '37',
    'type' => 'municipality',
]];
check(
    $geocoder->matchExpected($suggestions, 'Tours', '37000', '37')['status'] === 'validated',
    'Une réponse IGN strictement concordante doit être validée.',
);
check(
    $geocoder->matchExpected($suggestions, 'Tours', '37100', '37')['status'] === 'needs_review',
    'Un code postal incohérent doit exiger une relecture.',
);
$suggestions[] = [
    'label' => 'Tours bis',
    'latitude' => 47.390000,
    'longitude' => 0.680000,
    'city' => 'Tours',
    'postalCode' => '37000',
    'departmentCode' => '37',
    'type' => 'municipality',
];
check(
    $geocoder->matchExpected($suggestions, 'Tours', '37000', '37')['status'] === 'needs_review',
    'Une réponse ambiguë doit exiger une relecture.',
);

echo json_encode([
    'events' => count($validated['events']),
    'rules' => 280,
    'known' => count($knownRules),
    'dateOnly' => 22,
], JSON_THROW_ON_ERROR), PHP_EOL;
