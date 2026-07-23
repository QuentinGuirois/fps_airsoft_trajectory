<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use DateTimeImmutable;
use DateTimeZone;
use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\TurnstileVerifier;
use Fat\Api\Support;
use Fat\Api\Validation\RadarValidator;
use Fat\Api\Validation\Validator;
use PDO;

final class PublicRadarController
{
    private const REPORT_REASONS = ['outdated','wrong_location','wrong_rules','duplicate','unsafe','other'];

    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly RateLimiter $limits,
        private readonly TurnstileVerifier $turnstile,
    ) {
    }

    public function list(Request $request): never
    {
        $query = $request->query();
        Validator::keys($query, [
            'from','to','city','department','region','beginner','rental','rules',
            'bbox','latitude','longitude','radiusKm','limit',
        ]);
        $where = ["r.state='published'", "r.moderation_state='visible'", 'r.ends_at_utc>UTC_TIMESTAMP()'];
        $parameters = [];
        if (($query['from'] ?? '') !== '') {
            $where[] = 'r.starts_at_utc>=?';
            $parameters[] = $this->dateBoundary($query['from'], false);
        }
        if (($query['to'] ?? '') !== '') {
            $where[] = 'r.starts_at_utc<=?';
            $parameters[] = $this->dateBoundary($query['to'], true);
        }
        foreach ([
            'city' => ['r.city', 'La commune'],
            'department' => ['r.department_code', 'Le département'],
            'region' => ['r.region', 'La région'],
        ] as $key => [$column, $label]) {
            if (($query[$key] ?? '') !== '') {
                $where[] = $column . '=?';
                $parameters[] = RadarValidator::optionalText($query[$key], $label, 120);
            }
        }
        if (($query['beginner'] ?? '') === '1') {
            $where[] = 'r.beginners_welcome=1';
        } elseif (($query['beginner'] ?? '') !== '' && $query['beginner'] !== '0') {
            throw new HttpException(422, 'validation', 'Le filtre débutants est invalide.');
        }
        if (($query['rental'] ?? '') === '1') {
            $where[] = "r.rental_details IS NOT NULL AND r.rental_details<>''";
        } elseif (($query['rental'] ?? '') !== '' && $query['rental'] !== '0') {
            throw new HttpException(422, 'validation', 'Le filtre location est invalide.');
        }
        if (($query['rules'] ?? '') !== '') {
            $types = array_values(array_unique(array_filter(explode(',', $query['rules']))));
            if ($types === [] || array_diff($types, RadarValidator::RULE_TYPES)) {
                throw new HttpException(422, 'validation', 'Le filtre de règles est invalide.');
            }
            foreach ($types as $type) {
                $where[] = "EXISTS (SELECT 1 FROM radar_event_rules rr WHERE rr.event_id=r.id AND rr.rule_type=? AND rr.rule_state IN ('allowed','specific'))";
                $parameters[] = $type;
            }
        }
        if (($query['bbox'] ?? '') !== '') {
            [$west, $south, $east, $north] = $this->floatList($query['bbox'], 4, 'La zone de carte');
            if ($west >= $east || $south >= $north || $south < -90 || $north > 90 || $west < -180 || $east > 180) {
                throw new HttpException(422, 'validation', 'La zone de carte est invalide.');
            }
            $where[] = "r.location_visibility='exact' AND r.longitude BETWEEN ? AND ? AND r.latitude BETWEEN ? AND ?";
            array_push($parameters, $west, $east, $south, $north);
        }
        $limit = isset($query['limit'])
            ? RadarValidator::optionalInteger($query['limit'], 'La limite', 1, 250)
            : 250;
        $statement = $this->db->prepare(
            'SELECT r.*,u.pseudo AS owner_pseudo FROM radar_events r JOIN users u ON u.id=r.user_id WHERE '
            . implode(' AND ', $where) . ' ORDER BY r.starts_at_utc ASC,r.id ASC LIMIT ' . (int) $limit
        );
        $statement->execute($parameters);
        $events = array_map(fn(array $row): array => $this->present($row), $statement->fetchAll());

        if (($query['radiusKm'] ?? '') !== '' || ($query['latitude'] ?? '') !== '' || ($query['longitude'] ?? '') !== '') {
            if (($query['radiusKm'] ?? '') === '' || ($query['latitude'] ?? '') === '' || ($query['longitude'] ?? '') === '') {
                throw new HttpException(422, 'validation', 'Le rayon exige latitude, longitude et distance.');
            }
            [$latitude, $longitude] = RadarValidator::coordinates($query['latitude'], $query['longitude']);
            $radius = filter_var($query['radiusKm'], FILTER_VALIDATE_FLOAT);
            if ($radius === false || $radius < 1 || $radius > 500) {
                throw new HttpException(422, 'validation', 'Le rayon doit être compris entre 1 et 500 km.');
            }
            $events = array_values(array_filter($events, function (array $event) use ($latitude, $longitude, $radius): bool {
                return $event['latitude'] !== null
                    && $this->distance($latitude, $longitude, $event['latitude'], $event['longitude']) <= (float) $radius;
            }));
        }
        Response::json(['events' => $events, 'count' => count($events)], 200, [
            'Cache-Control' => 'public, max-age=30, stale-while-revalidate=120',
            'Pragma' => '',
        ]);
    }

    public function get(Request $request, array $params): never
    {
        $statement = $this->db->prepare(
            "SELECT r.*,u.pseudo AS owner_pseudo FROM radar_events r JOIN users u ON u.id=r.user_id "
            . "WHERE r.slug=? AND r.state IN ('published','cancelled') AND r.moderation_state='visible' LIMIT 1"
        );
        $statement->execute([$params['slug']]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpException(404, 'radar_not_found', 'Partie introuvable.');
        }
        Response::json(['event' => $this->present($row)], 200, [
            'Cache-Control' => 'public, max-age=30, stale-while-revalidate=120',
            'Pragma' => '',
        ]);
    }

    public function report(Request $request, array $params): never
    {
        $this->limits->hit('radar_report_ip', $request->ip(), 10, 3600);
        $body = $request->json();
        Validator::keys($body, ['reason','message','website','turnstileToken'], ['reason','turnstileToken']);
        $this->turnstile->verify($body['turnstileToken'], 'radar_report', $request);
        if (trim((string) ($body['website'] ?? '')) !== '') {
            Response::json(['received' => true], 202);
        }
        $reason = RadarValidator::enum($body['reason'], 'Le motif de signalement', self::REPORT_REASONS);
        $message = RadarValidator::optionalText($body['message'] ?? null, 'Le détail du signalement', 1000);
        $event = $this->db->prepare(
            "SELECT id FROM radar_events WHERE slug=? AND state IN ('published','cancelled') AND moderation_state='visible' LIMIT 1"
        );
        $event->execute([$params['slug']]);
        $eventId = $event->fetchColumn();
        if (is_string($eventId)) {
            $reporter = hash_hmac(
                'sha256',
                $request->ip() . "\0" . $request->header('user-agent'),
                $this->config->get('APP_KEY'),
                true,
            );
            $statement = $this->db->prepare(
                'INSERT INTO radar_event_reports (id,event_id,reason,message,reporter_key_hash) VALUES (?,?,?,?,?)'
            );
            $statement->execute([Support::uuid(), $eventId, $reason, $message, $reporter]);
        }
        Response::json(['received' => true], 202);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function present(array $row): array
    {
        $exact = $row['location_visibility'] === 'exact';
        return [
            'id' => $row['slug'],
            'slug' => $row['slug'],
            'state' => $row['state'],
            'title' => $row['title'],
            'venueName' => $row['venue_name'],
            'description' => $row['short_description'],
            'startsAt' => $this->atom($row['starts_at_utc']),
            'endsAt' => $this->atom($row['ends_at_utc']),
            'updatedAt' => $this->atom($row['updated_at']),
            'timezone' => 'Europe/Paris',
            'scenario' => $row['scenario'],
            'level' => $row['level_label'],
            'beginnersWelcome' => (bool) $row['beginners_welcome'],
            'maxCapacity' => $row['max_capacity'] === null ? null : (int) $row['max_capacity'],
            'priceCents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
            'minimumAge' => $row['minimum_age'] === null ? null : (int) $row['minimum_age'],
            'rentalDetails' => $row['rental_details'],
            'cateringDetails' => $row['catering_details'],
            'toiletsAvailable' => $row['toilets_available'] === null ? null : (bool) $row['toilets_available'],
            'locationVisibility' => $row['location_visibility'],
            'latitude' => $exact && $row['latitude'] !== null ? (float) $row['latitude'] : null,
            'longitude' => $exact && $row['longitude'] !== null ? (float) $row['longitude'] : null,
            'locationLabel' => $row['public_location_label'],
            'city' => $row['city'],
            'postalCode' => $row['postal_code'],
            'departmentCode' => $row['department_code'],
            'department' => $row['department'],
            'region' => $row['region'],
            'registrationUrl' => $row['registration_url'],
            'rules' => $this->rules((string) $row['id']),
            'links' => $this->links((string) $row['id']),
            'organizer' => ['pseudo' => $row['owner_pseudo']],
            'publicUrl' => '/parties-airsoft/' . $row['slug'] . '/',
        ];
    }

    /** @return list<array<string,mixed>> */
    private function rules(string $eventId): array
    {
        $statement = $this->db->prepare(
            'SELECT rule_type,rule_state,joules,details FROM radar_event_rules WHERE event_id=? ORDER BY FIELD(rule_type,'
            . "'assault','dmr','sniper','cqb','detonating_grenades','co2_grenades','smoke_grenades')"
        );
        $statement->execute([$eventId]);
        return array_map(static fn(array $row): array => [
            'type' => $row['rule_type'],
            'state' => $row['rule_state'],
            'joules' => $row['joules'] === null ? null : (float) $row['joules'],
            'details' => $row['details'],
        ], $statement->fetchAll());
    }

    /** @return list<array<string,string>> */
    private function links(string $eventId): array
    {
        $statement = $this->db->prepare(
            'SELECT link_type,url FROM radar_event_links WHERE event_id=? ORDER BY sort_order,id'
        );
        $statement->execute([$eventId]);
        return array_map(static fn(array $row): array => [
            'type' => $row['link_type'], 'url' => $row['url'],
        ], $statement->fetchAll());
    }

    private function atom(mixed $utc): ?string
    {
        if (!is_string($utc) || $utc === '') {
            return null;
        }
        return (new DateTimeImmutable($utc, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
    }

    private function dateBoundary(string $value, bool $endOfDay): string
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
            throw new HttpException(422, 'validation', 'La date de filtre est invalide.');
        }
        $utc = RadarValidator::localDate($value . ($endOfDay ? 'T23:59' : 'T00:00'), 'La date de filtre');
        if ($utc === null) {
            throw new HttpException(422, 'validation', 'La date de filtre est invalide.');
        }
        return $utc;
    }

    /** @return list<float> */
    private function floatList(string $value, int $count, string $label): array
    {
        $parts = explode(',', $value);
        if (count($parts) !== $count) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        $values = [];
        foreach ($parts as $part) {
            $number = filter_var($part, FILTER_VALIDATE_FLOAT);
            if ($number === false || !is_finite((float) $number)) {
                throw new HttpException(422, 'validation', "{$label} est invalide.");
            }
            $values[] = (float) $number;
        }
        return $values;
    }

    private function distance(float $latA, float $lonA, float $latB, float $lonB): float
    {
        $latitude = deg2rad($latB - $latA);
        $longitude = deg2rad($lonB - $lonA);
        $a = sin($latitude / 2) ** 2
            + cos(deg2rad($latA)) * cos(deg2rad($latB)) * sin($longitude / 2) ** 2;
        return 6371.0088 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
