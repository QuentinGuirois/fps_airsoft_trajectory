<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Support;
use PDO;

final class GeocodingService
{
    private const OFFICIAL_URL = 'https://data.geopf.fr/geocodage/search/';

    /** @var \Closure(string,int):array{status:int,body:string} */
    private readonly \Closure $transport;

    /** @param (\Closure(string,int):array{status:int,body:string})|null $transport */
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        ?\Closure $transport = null,
    ) {
        $this->transport = $transport ?? fn(string $url, int $timeout): array => $this->fetch($url, $timeout);
    }

    /** @return list<array<string,mixed>> */
    public function search(string $rawQuery, bool $writeCache = true): array
    {
        $query = Support::normalizeText($rawQuery);
        if (mb_strlen($query) < 4 || mb_strlen($query) > 120 || preg_match('/[\x00-\x1F\x7F<>]/u', $query)) {
            throw new HttpException(422, 'validation', 'Saisis au moins quatre caractères pour rechercher un lieu.');
        }
        $endpoint = $this->config->get('RADAR_GEOCODER_URL', self::OFFICIAL_URL);
        if ($this->config->isProduction() && !hash_equals(rtrim(self::OFFICIAL_URL, '/'), rtrim($endpoint, '/'))) {
            throw new \RuntimeException('URL de géocodage IGN non officielle en production.');
        }
        $cacheKey = hash('sha256', mb_strtolower($query) . "\0" . $endpoint, true);
        $cached = $this->cached($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        $url = $endpoint . '?' . http_build_query([
            'q' => $query,
            'limit' => 6,
            'autocomplete' => 1,
        ], '', '&', PHP_QUERY_RFC3986);
        try {
            $result = ($this->transport)(
                $url,
                min(8, max(2, $this->config->int('RADAR_GEOCODER_TIMEOUT_SECONDS', 4))),
            );
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            throw new HttpException(503, 'geocoder_unavailable', 'La recherche IGN est temporairement indisponible.');
        }
        if ($result['status'] === 429) {
            throw new HttpException(429, 'geocoder_rate_limited', 'La recherche IGN reçoit trop de demandes. Réessaie dans quelques instants.');
        }
        if ($result['status'] < 200 || $result['status'] >= 300) {
            throw new HttpException(503, 'geocoder_unavailable', 'La recherche IGN est temporairement indisponible.');
        }

        try {
            $decoded = json_decode($result['body'], true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpException(503, 'geocoder_unavailable', 'La recherche IGN a renvoyé une réponse invalide.');
        }
        $suggestions = $this->normalize($decoded);
        if ($writeCache) {
            $this->store($cacheKey, $suggestions);
        }
        return $suggestions;
    }

    /**
     * Retient une seule réponse concordant strictement avec la commune et, lorsqu'ils
     * sont fournis, le code postal et le département attendus.
     *
     * @param list<array<string,mixed>> $suggestions
     * @return array{status:string,suggestion:?array<string,mixed>}
     */
    public function matchExpected(array $suggestions, string $city, ?string $postalCode, ?string $departmentCode): array
    {
        $matches = $this->expectedMatches($suggestions, $city, $postalCode, $departmentCode);
        if (count($matches) !== 1) {
            return ['status' => 'needs_review', 'suggestion' => null];
        }
        return ['status' => 'validated', 'suggestion' => array_values($matches)[0]];
    }

    /**
     * @return array{
     *   status:'exact'|'approximate'|'ambiguous'|'rejected',
     *   suggestion:?array<string,mixed>,
     *   query:?string,
     *   attempts:list<array{query:string,result:string,matches:int}>
     * }
     */
    public function resolveExpectedLocation(
        ?string $address,
        string $city,
        ?string $postalCode,
        string $departmentCode,
        bool $writeCache = true,
    ): array {
        $queries = [];
        if ($address !== null && trim($address) !== '') {
            $queries[] = trim($address . ', ' . ($postalCode !== null ? $postalCode . ' ' : '') . $city);
        }
        if ($postalCode !== null) {
            $queries[] = trim($postalCode . ' ' . $city);
        }
        // Dernier repli : recherche de la commune, puis validation stricte du
        // département dans la réponse IGN. Ajouter le code départemental au
        // texte libre dégrade certains résultats (par exemple « Benay 02 »).
        $queries[] = trim($city);
        $queries = array_values(array_unique($queries));
        $attempts = [];
        $ambiguous = false;
        foreach ($queries as $index => $query) {
            $suggestions = $this->search($query, $writeCache);
            $matches = $this->expectedMatches($suggestions, $city, $postalCode, $departmentCode);
            $addressAttempt = $index === 0 && $address !== null && trim($address) !== '';
            $expectedTypes = $addressAttempt ? ['housenumber', 'street'] : ['municipality'];
            $matches = array_filter(
                $matches,
                static fn(array $suggestion): bool => in_array(
                    (string) ($suggestion['type'] ?? ''),
                    $expectedTypes,
                    true,
                ),
            );
            $count = count($matches);
            if ($count === 1) {
                $suggestion = array_values($matches)[0];
                $type = (string) ($suggestion['type'] ?? '');
                $exact = $addressAttempt
                    && in_array($type, ['housenumber', 'street'], true);
                $attempts[] = ['query' => $query, 'result' => $exact ? 'exact' : 'approximate', 'matches' => 1];
                return [
                    'status' => $exact ? 'exact' : 'approximate',
                    'suggestion' => $suggestion,
                    'query' => $query,
                    'attempts' => $attempts,
                ];
            }
            if ($count > 1) {
                $ambiguous = true;
                $attempts[] = ['query' => $query, 'result' => 'ambiguous', 'matches' => $count];
            } else {
                $attempts[] = ['query' => $query, 'result' => 'rejected', 'matches' => 0];
            }
        }
        return [
            'status' => $ambiguous ? 'ambiguous' : 'rejected',
            'suggestion' => null,
            'query' => null,
            'attempts' => $attempts,
        ];
    }

    /** @return list<array<string,mixed>>|null */
    private function cached(string $cacheKey): ?array
    {
        $statement = $this->db->prepare(
            'SELECT response_json FROM radar_geocoding_cache WHERE query_hash=? AND expires_at>UTC_TIMESTAMP() LIMIT 1'
        );
        $statement->execute([$cacheKey]);
        $raw = $statement->fetchColumn();
        if (!is_string($raw)) {
            return null;
        }
        try {
            $value = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        return is_array($value) && array_is_list($value) ? $value : null;
    }

    /** @param list<array<string,mixed>> $suggestions */
    private function store(string $cacheKey, array $suggestions): void
    {
        $ttl = min(2_592_000, max(3_600, $this->config->int('RADAR_GEOCODER_CACHE_TTL_SECONDS', 604_800)));
        $expires = gmdate('Y-m-d H:i:s', time() + $ttl);
        $statement = $this->db->prepare(
            'INSERT INTO radar_geocoding_cache (query_hash,response_json,expires_at) VALUES (?,?,?) '
            . 'ON DUPLICATE KEY UPDATE response_json=VALUES(response_json),expires_at=VALUES(expires_at)'
        );
        $statement->execute([$cacheKey, json_encode($suggestions, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $expires]);
    }

    /** @return list<array<string,mixed>> */
    private function normalize(mixed $decoded): array
    {
        if (!is_array($decoded) || !is_array($decoded['features'] ?? null)) {
            throw new HttpException(503, 'geocoder_unavailable', 'La recherche IGN a renvoyé une réponse invalide.');
        }
        $suggestions = [];
        foreach (array_slice($decoded['features'], 0, 6) as $feature) {
            $coordinates = $feature['geometry']['coordinates'] ?? null;
            $properties = $feature['properties'] ?? null;
            if (!is_array($coordinates) || count($coordinates) < 2 || !is_array($properties)) {
                continue;
            }
            $longitude = filter_var($coordinates[0], FILTER_VALIDATE_FLOAT);
            $latitude = filter_var($coordinates[1], FILTER_VALIDATE_FLOAT);
            if ($latitude === false || $longitude === false || $latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
                continue;
            }
            $context = array_map('trim', explode(',', (string) ($properties['context'] ?? '')));
            $suggestions[] = [
                'label' => mb_substr(Support::normalizeText($properties['label'] ?? ''), 0, 255),
                'latitude' => round((float) $latitude, 6),
                'longitude' => round((float) $longitude, 6),
                'city' => mb_substr(Support::normalizeText($properties['city'] ?? $properties['municipality'] ?? ''), 0, 120),
                'postalCode' => mb_substr((string) ($properties['postcode'] ?? ''), 0, 10),
                'departmentCode' => mb_substr((string) ($properties['depcode'] ?? ''), 0, 3),
                'department' => mb_substr((string) ($context[1] ?? ''), 0, 120),
                'region' => mb_substr((string) ($context[2] ?? ''), 0, 120),
                'type' => mb_substr((string) ($properties['type'] ?? ''), 0, 40),
                'source' => 'IGN Géoplateforme',
            ];
        }
        return $suggestions;
    }

    /** @return array{status:int,body:string} */
    private function fetch(string $url, int $timeout): array
    {
        $context = stream_context_create(['http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: F.A.T.-Radar/1.0\r\n",
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $context);
        $statusLine = $http_response_header[0] ?? '';
        if ($body === false || !preg_match('/\s(\d{3})\s/', $statusLine, $matches)) {
            throw new \RuntimeException('Service IGN indisponible.');
        }
        return ['status' => (int) $matches[1], 'body' => $body];
    }

    private function placeKey(string $value): string
    {
        $value = mb_strtolower(Support::normalizeText($value));
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        $value = is_string($ascii) ? $ascii : $value;
        return preg_replace('/[^a-z0-9]+/', '', $value) ?? $value;
    }

    /**
     * @param list<array<string,mixed>> $suggestions
     * @return array<string,array<string,mixed>>
     */
    private function expectedMatches(
        array $suggestions,
        string $city,
        ?string $postalCode,
        ?string $departmentCode,
    ): array {
        $expectedCity = $this->placeKey($city);
        $matches = [];
        foreach ($suggestions as $suggestion) {
            if (
                $this->placeKey((string) ($suggestion['city'] ?? '')) !== $expectedCity
                || ($postalCode !== null && (string) ($suggestion['postalCode'] ?? '') !== $postalCode)
                || ($departmentCode !== null && strtoupper((string) ($suggestion['departmentCode'] ?? '')) !== strtoupper($departmentCode))
            ) {
                continue;
            }
            $coordinateKey = sprintf(
                '%.6F,%.6F',
                (float) ($suggestion['latitude'] ?? 999),
                (float) ($suggestion['longitude'] ?? 999),
            );
            $matches[$coordinateKey] = $suggestion;
        }
        return $matches;
    }
}
