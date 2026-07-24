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

$path = $root . '/docs/fat-radar/fat-radar-events-seed-2026-07-24.json';
$raw = file_get_contents($path);
check(is_string($raw), 'JSON de semences absent.');
$source = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
check(is_array($source), 'JSON de semences invalide.');
$validated = RadarSeedValidator::document($source);
check(count($validated['events']) === 46, 'Le lot doit contenir 46 événements.');
check(count(array_unique(array_column($validated['events'], 'externalKey'))) === 46, 'Les clés externes doivent être uniques.');
check(count(array_filter($validated['events'], static fn(array $event): bool => $event['sourceTier'] === 'primary')) === 15, 'Le lot primaire doit contenir 15 événements.');
check(count(array_filter($validated['events'], static fn(array $event): bool => $event['sourceTier'] === 'secondary')) === 31, 'Le lot secondaire doit contenir 31 événements.');
$undisclosed = array_values(array_filter(
    $validated['events'],
    static fn(array $event): bool => $event['locationPrecision'] === 'undisclosed',
));
check(count($undisclosed) === 1, 'Un seul lieu doit être non communiqué.');
check($undisclosed[0]['geocodeQuery'] === null, 'Un lieu non communiqué ne doit jamais être géocodé.');
check(
    count(array_filter($validated['events'], static fn(array $event): bool => $event['schedulePrecision'] === 'date')) === 9,
    'Les neuf événements comportant une date sans horaire doivent rester identifiables.',
);
check(!str_contains(mb_strtolower($raw), '@'), 'Le JSON ne doit contenir aucune adresse email.');

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
$suggestions = [
    [
        'label' => 'Tours',
        'latitude' => 47.394144,
        'longitude' => 0.684840,
        'city' => 'Tours',
        'postalCode' => '37000',
        'departmentCode' => '37',
    ],
];
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
];
check(
    $geocoder->matchExpected($suggestions, 'Tours', '37000', '37')['status'] === 'needs_review',
    'Une réponse ambiguë doit exiger une relecture.',
);

echo json_encode([
    'events' => count($validated['events']),
    'primary' => 15,
    'secondary' => 31,
    'undisclosed' => count($undisclosed),
], JSON_THROW_ON_ERROR), PHP_EOL;
