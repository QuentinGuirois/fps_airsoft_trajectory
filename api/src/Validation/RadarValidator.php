<?php
declare(strict_types=1);

namespace Fat\Api\Validation;

use DateTimeImmutable;
use DateTimeZone;
use Fat\Api\HttpException;
use Fat\Api\Support;

final class RadarValidator
{
    public const RULE_TYPES = [
        'assault', 'dmr', 'sniper', 'cqb', 'detonating_grenades', 'co2_grenades', 'smoke_grenades',
    ];
    public const RULE_STATES = ['allowed', 'specific', 'forbidden', 'not_communicated'];
    public const LINK_TYPES = ['website', 'facebook', 'helloasso', 'discord', 'instagram'];

    public static function optionalText(mixed $value, string $label, int $max, int $min = 0): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $text = Support::normalizeText($value);
        $length = mb_strlen($text);
        if ($length < $min || $length > $max || preg_match('/[\x00-\x1F\x7F<>]/u', $text)) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        return $text;
    }

    public static function boolean(mixed $value, string $label): bool
    {
        if (!is_bool($value)) {
            throw new HttpException(422, 'validation', "{$label} doit être un booléen.");
        }
        return $value;
    }

    public static function optionalInteger(mixed $value, string $label, int $min, int $max): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $number = filter_var($value, FILTER_VALIDATE_INT);
        if ($number === false || $number < $min || $number > $max) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        return $number;
    }

    public static function enum(mixed $value, string $label, array $allowed): string
    {
        $candidate = (string) $value;
        if (!in_array($candidate, $allowed, true)) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        return $candidate;
    }

    public static function localDate(mixed $value, string $label): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $input = (string) $value;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/D', $input)) {
            throw new HttpException(422, 'validation', "{$label} doit utiliser le fuseau Europe/Paris.");
        }
        $paris = new DateTimeZone('Europe/Paris');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $input, $paris);
        $errors = DateTimeImmutable::getLastErrors();
        if (
            $date === false
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('Y-m-d\TH:i') !== $input
        ) {
            throw new HttpException(422, 'validation', "{$label} n’existe pas dans le fuseau Europe/Paris.");
        }
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    public static function httpsUrl(mixed $value, string $label, bool $required = false): ?string
    {
        $url = trim((string) $value);
        if ($url === '') {
            if ($required) {
                throw new HttpException(422, 'validation', "{$label} est obligatoire.");
            }
            return null;
        }
        if (strlen($url) > 2048 || preg_match('/[\x00-\x20\x7F]/', $url)) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (
            ($parts['scheme'] ?? '') !== 'https'
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || str_starts_with($host, '.')
            || str_ends_with($host, '.')
        ) {
            throw new HttpException(422, 'validation', "{$label} doit être une URL HTTPS complète.");
        }
        return $url;
    }

    /** @return array{float,float} */
    public static function coordinates(mixed $latitude, mixed $longitude): array
    {
        $lat = filter_var($latitude, FILTER_VALIDATE_FLOAT);
        $lon = filter_var($longitude, FILTER_VALIDATE_FLOAT);
        if ($lat === false || $lon === false || !is_finite((float) $lat) || !is_finite((float) $lon)) {
            throw new HttpException(422, 'validation', 'Les coordonnées WGS84 sont invalides.');
        }
        $lat = round((float) $lat, 7);
        $lon = round((float) $lon, 7);
        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
            throw new HttpException(422, 'validation', 'Les coordonnées WGS84 sont hors limites.');
        }
        return [$lat, $lon];
    }

    /** @return list<array{type:string,state:string,joules:?float,details:?string}> */
    public static function rules(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > count(self::RULE_TYPES)) {
            throw new HttpException(422, 'validation', 'La matrice de règles est invalide.');
        }
        $seen = [];
        $rules = [];
        foreach ($value as $row) {
            if (!is_array($row) || array_is_list($row)) {
                throw new HttpException(422, 'validation', 'Une règle est invalide.');
            }
            Validator::keys($row, ['type','state','joules','details'], ['type','state']);
            $type = self::enum($row['type'], 'Le type de règle', self::RULE_TYPES);
            if (isset($seen[$type])) {
                throw new HttpException(422, 'validation', 'Chaque règle ne peut être renseignée qu’une fois.');
            }
            $seen[$type] = true;
            $state = self::enum($row['state'], 'L’état de règle', self::RULE_STATES);
            $joules = null;
            if (($row['joules'] ?? null) !== null && $row['joules'] !== '') {
                $parsed = filter_var($row['joules'], FILTER_VALIDATE_FLOAT);
                if ($parsed === false || !is_finite((float) $parsed) || $parsed < 0.01 || $parsed > 10) {
                    throw new HttpException(422, 'validation', 'La valeur facultative en joules est invalide.');
                }
                $joules = round((float) $parsed, 2);
            }
            $rules[] = [
                'type' => $type,
                'state' => $state,
                'joules' => $joules,
                'details' => self::optionalText($row['details'] ?? null, 'Le détail de règle', 240),
            ];
        }
        return $rules;
    }

    /** @return list<array{type:string,url:string}> */
    public static function links(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > 5) {
            throw new HttpException(422, 'validation', 'La liste de liens est invalide.');
        }
        $seen = [];
        $links = [];
        foreach ($value as $row) {
            if (!is_array($row) || array_is_list($row)) {
                throw new HttpException(422, 'validation', 'Un lien est invalide.');
            }
            Validator::keys($row, ['type','url'], ['type','url']);
            $type = self::enum($row['type'], 'Le type de lien', self::LINK_TYPES);
            if (isset($seen[$type])) {
                throw new HttpException(422, 'validation', 'Un seul lien par plateforme est autorisé.');
            }
            $seen[$type] = true;
            $links[] = ['type' => $type, 'url' => (string) self::httpsUrl($row['url'], 'Le lien communauté', true)];
        }
        return $links;
    }
}
