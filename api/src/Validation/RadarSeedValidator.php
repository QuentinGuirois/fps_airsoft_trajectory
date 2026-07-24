<?php
declare(strict_types=1);

namespace Fat\Api\Validation;

use DateTimeImmutable;
use DateTimeZone;
use Fat\Api\HttpException;
use Fat\Api\Support;

final class RadarSeedValidator
{
    private const TOP_LEVEL_KEYS = [
        'schema_version', 'dataset', 'generated_at', 'timezone', 'purpose',
        'import_defaults', 'privacy', 'source_policy', 'events',
    ];
    private const EVENT_KEYS = [
        'external_key', 'title', 'organizer', 'organizer_type', 'source_tier',
        'source_url', 'registration_url', 'source_locator', 'starts_at', 'ends_at',
        'event_type', 'terrain_type', 'location_label', 'address', 'postal_code',
        'city', 'department_code', 'location_precision', 'geocode_query',
        'price_min_eur', 'price_max_eur', 'capacity', 'rules_summary',
    ];
    private const ORGANIZER_TYPES = ['association', 'association_unverified', 'organizer_unverified', 'venue'];
    private const EVENT_TYPES = [
        'OP', 'OP_historique', 'OP_nocturne', 'OP_roleplay', 'big_game', 'dominicale',
        'dominicale_caritative', 'milsim_24h', 'milsim_longue_duree', 'nocturne',
        'nocturne_scenarisee', 'scenarisee', 'semi_nocturne_scenarisee',
        'training_real_cap', 'weekend_nocturne_dominicale',
    ];
    private const TERRAIN_TYPES = ['CQB', 'foret', 'foret_bunkers', 'mixte', 'unknown'];
    private const LOCATION_PRECISIONS = ['street', 'locality', 'city', 'undisclosed'];

    /**
     * @param array<string,mixed> $document
     * @return array{schemaVersion:string,generatedAt:string,timezone:string,events:list<array<string,mixed>>}
     */
    public static function document(array $document): array
    {
        Validator::keys($document, self::TOP_LEVEL_KEYS, self::TOP_LEVEL_KEYS);
        if ($document['schema_version'] !== '1.0.0' || $document['timezone'] !== 'Europe/Paris') {
            throw self::invalid('La version ou le fuseau du lot Radar est invalide.');
        }
        self::text($document['dataset'], 'Le nom du lot', 200, 3);
        self::text($document['purpose'], 'La finalité du lot', 1000, 10);
        self::isoTimestamp($document['generated_at'], 'La date de génération');

        $defaults = self::map($document['import_defaults'], 'Les valeurs d’import');
        Validator::keys($defaults, [
            'owner_mode', 'status', 'visibility', 'claim_state',
            'requires_pre_publication_check', 'allow_public_contact_email',
        ], [
            'owner_mode', 'status', 'visibility', 'claim_state',
            'requires_pre_publication_check', 'allow_public_contact_email',
        ]);
        if (
            $defaults['owner_mode'] !== 'runtime_env:FAT_RADAR_SEED_OWNER_EMAIL'
            || $defaults['status'] !== 'draft'
            || $defaults['visibility'] !== 'admin_preview_only'
            || $defaults['claim_state'] !== 'unclaimed'
            || $defaults['requires_pre_publication_check'] !== true
            || $defaults['allow_public_contact_email'] !== false
        ) {
            throw self::invalid('Les garde-fous du lot Radar ont été modifiés.');
        }

        foreach (['privacy', 'source_policy'] as $section) {
            $map = self::map($document[$section], "La section {$section}");
            foreach ($map as $value) {
                self::text($value, "Une valeur de {$section}", 2000, 3);
            }
        }

        if (!is_array($document['events']) || !array_is_list($document['events']) || $document['events'] === [] || count($document['events']) > 500) {
            throw self::invalid('La liste d’événements Radar est invalide.');
        }
        $events = [];
        $seen = [];
        foreach ($document['events'] as $index => $raw) {
            if (!is_array($raw) || array_is_list($raw)) {
                throw self::invalid('Un événement du lot Radar est invalide.', ['row' => $index + 1]);
            }
            $event = self::event($raw, $index + 1);
            if (isset($seen[$event['externalKey']])) {
                throw self::invalid('Une clé externe est présente plusieurs fois.', ['row' => $index + 1]);
            }
            $seen[$event['externalKey']] = true;
            $events[] = $event;
        }

        return [
            'schemaVersion' => '1.0.0',
            'generatedAt' => (string) $document['generated_at'],
            'timezone' => 'Europe/Paris',
            'events' => $events,
        ];
    }

    /** @param array<string,mixed> $raw @return array<string,mixed> */
    private static function event(array $raw, int $row): array
    {
        Validator::keys($raw, self::EVENT_KEYS, self::EVENT_KEYS);
        $externalKey = trim((string) $raw['external_key']);
        if (!preg_match('/^[a-z0-9][a-z0-9-]{5,159}$/D', $externalKey)) {
            throw self::invalid('La clé externe est invalide.', ['row' => $row]);
        }
        $title = self::text($raw['title'], 'Le titre', 120, 3);
        $organizer = self::text($raw['organizer'], 'L’organisateur', 160, 2);
        $organizerType = self::oneOf($raw['organizer_type'], self::ORGANIZER_TYPES, 'Le type d’organisateur');
        $sourceTier = self::oneOf($raw['source_tier'], ['primary', 'secondary'], 'Le niveau de source');
        $sourceUrl = (string) RadarValidator::httpsUrl($raw['source_url'], 'L’URL source', true);
        $registrationUrl = RadarValidator::httpsUrl($raw['registration_url'], 'L’URL d’inscription');
        $sourceLocator = RadarValidator::optionalText($raw['source_locator'], 'Le repère de source', 500);
        [$startsAtUtc, $startPrecision] = self::eventDate($raw['starts_at'], false, 'La date de début');
        [$endsAtUtc, $endPrecision] = self::eventDate($raw['ends_at'], true, 'La date de fin');
        if ($endsAtUtc <= $startsAtUtc) {
            throw self::invalid('La fin doit être postérieure au début.', ['row' => $row]);
        }
        $eventType = self::oneOf($raw['event_type'], self::EVENT_TYPES, 'Le type de partie');
        $terrainType = self::oneOf($raw['terrain_type'], self::TERRAIN_TYPES, 'Le type de terrain');
        $locationLabel = self::text($raw['location_label'], 'Le lieu', 160, 2);
        $address = RadarValidator::optionalText($raw['address'], 'L’adresse', 255);
        $precision = self::oneOf($raw['location_precision'], self::LOCATION_PRECISIONS, 'La précision du lieu');
        $postalCode = self::postalCode($raw['postal_code']);
        $city = $raw['city'] === null ? null : self::text($raw['city'], 'La ville', 120, 1);
        $departmentCode = $raw['department_code'] === null ? null : strtoupper(trim((string) $raw['department_code']));
        if ($departmentCode !== null && !preg_match('/^(?:0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])$/D', $departmentCode)) {
            throw self::invalid('Le département est invalide.', ['row' => $row]);
        }
        $geocodeQuery = RadarValidator::optionalText($raw['geocode_query'], 'La requête de géocodage', 120, 4);
        if (($precision === 'undisclosed') !== ($geocodeQuery === null)) {
            throw self::invalid('Un lieu non communiqué ne doit pas avoir de requête de géocodage.', ['row' => $row]);
        }
        if (($city === null || $departmentCode === null) && $precision !== 'undisclosed') {
            throw self::invalid('La ville et le département sont obligatoires pour un lieu géocodable.', ['row' => $row]);
        }
        $priceMin = self::money($raw['price_min_eur'], 'Le prix minimum');
        $priceMax = self::money($raw['price_max_eur'], 'Le prix maximum');
        if ($priceMin !== null && $priceMax !== null && $priceMax < $priceMin) {
            throw self::invalid('Le prix maximum est inférieur au prix minimum.', ['row' => $row]);
        }
        $capacity = RadarValidator::optionalInteger($raw['capacity'], 'La capacité', 1, 5000);
        $summary = RadarValidator::optionalText($raw['rules_summary'], 'Le résumé', 800, 10);

        return [
            'externalKey' => $externalKey,
            'title' => $title,
            'organizer' => $organizer,
            'organizerType' => $organizerType,
            'sourceTier' => $sourceTier,
            'sourceUrl' => $sourceUrl,
            'registrationUrl' => $registrationUrl,
            'sourceLocator' => $sourceLocator,
            'startsAtUtc' => $startsAtUtc->format('Y-m-d H:i:s'),
            'endsAtUtc' => $endsAtUtc->format('Y-m-d H:i:s'),
            'schedulePrecision' => $startPrecision === 'date' || $endPrecision === 'date' ? 'date' : 'datetime',
            'eventType' => $eventType,
            'terrainType' => $terrainType,
            'locationLabel' => $locationLabel,
            'address' => $address,
            'postalCode' => $postalCode,
            'city' => $city,
            'departmentCode' => $departmentCode,
            'locationPrecision' => $precision,
            'geocodeQuery' => $geocodeQuery,
            'priceMinCents' => $priceMin,
            'priceMaxCents' => $priceMax,
            'capacity' => $capacity,
            'summary' => $summary,
        ];
    }

    /** @return array{DateTimeImmutable,string} */
    private static function eventDate(mixed $value, bool $endOfDay, string $label): array
    {
        if (!is_string($value)) {
            throw self::invalid("{$label} est invalide.");
        }
        $paris = new DateTimeZone('Europe/Paris');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $paris);
            $errors = DateTimeImmutable::getLastErrors();
            if ($date === false || ($errors !== false && ($errors['warning_count'] || $errors['error_count'])) || $date->format('Y-m-d') !== $value) {
                throw self::invalid("{$label} est invalide.");
            }
            $date = $endOfDay ? $date->setTime(23, 59, 59) : $date->setTime(0, 0, 0);
            return [$date->setTimezone(new DateTimeZone('UTC')), 'date'];
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:sP', $value);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date === false || ($errors !== false && ($errors['warning_count'] || $errors['error_count'])) || $date->format('Y-m-d\TH:i:sP') !== $value) {
            throw self::invalid("{$label} doit être une date ISO 8601 complète.");
        }
        return [$date->setTimezone(new DateTimeZone('UTC')), 'datetime'];
    }

    private static function isoTimestamp(mixed $value, string $label): void
    {
        if (!is_string($value)) {
            throw self::invalid("{$label} est invalide.");
        }
        self::eventDate($value, false, $label);
    }

    /** @return array<string,mixed> */
    private static function map(mixed $value, string $label): array
    {
        if (!is_array($value) || array_is_list($value)) {
            throw self::invalid("{$label} est invalide.");
        }
        return $value;
    }

    private static function text(mixed $value, string $label, int $max, int $min): string
    {
        if (!is_string($value)) {
            throw self::invalid("{$label} est invalide.");
        }
        $text = Support::normalizeText($value);
        $length = mb_strlen($text);
        if ($length < $min || $length > $max || preg_match('/[\x00-\x1F\x7F<>]/u', $text)) {
            throw self::invalid("{$label} est invalide.");
        }
        return $text;
    }

    /** @param list<string> $allowed */
    private static function oneOf(mixed $value, array $allowed, string $label): string
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            throw self::invalid("{$label} est invalide.");
        }
        return $value;
    }

    private static function postalCode(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value) || !preg_match('/^\d{5}$/D', $value)) {
            throw self::invalid('Le code postal est invalide.');
        }
        return $value;
    }

    private static function money(mixed $value, string $label): ?int
    {
        if ($value === null) {
            return null;
        }
        if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < 0 || $value > 10_000) {
            throw self::invalid("{$label} est invalide.");
        }
        return (int) round((float) $value * 100);
    }

    /** @param array<string,mixed>|null $details */
    private static function invalid(string $message, ?array $details = null): HttpException
    {
        return new HttpException(422, 'radar_seed_validation', $message, $details);
    }
}
