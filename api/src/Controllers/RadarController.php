<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use DateTimeImmutable;
use DateTimeZone;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\GeocodingService;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SensitiveData;
use Fat\Api\Services\SessionService;
use Fat\Api\Services\TurnstileVerifier;
use Fat\Api\Support;
use Fat\Api\Validation\RadarValidator;
use Fat\Api\Validation\Validator;
use PDO;

final class RadarController
{
    private const EDITABLE_FIELDS = [
        'title','venueName','description','startLocal','endLocal','scenario','level','beginnersWelcome',
        'maxCapacity','priceCents','minimumAge','rentalDetails','cateringDetails','toiletsAvailable',
        'latitude','longitude','locationMethod','locationConfirmed','locationVisibility',
        'exactAddress','publicLocationLabel','city','postalCode','departmentCode','department','region',
        'registrationUrl','contactEmail','rules','links','version',
    ];

    public function __construct(
        private readonly PDO $db,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
        private readonly TurnstileVerifier $turnstile,
        private readonly SensitiveData $sensitive,
        private readonly GeocodingService $geocoder,
    ) {
    }

    public function list(Request $request): never
    {
        $session = $this->sessions->require($request);
        $statement = $this->db->prepare(
            "SELECT * FROM radar_events WHERE user_id=? AND state<>'deleted' ORDER BY updated_at DESC LIMIT 100"
        );
        $statement->execute([$session['id']]);
        Response::json(['events' => array_map(fn(array $row): array => $this->present($row), $statement->fetchAll())]);
    }

    public function create(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_create', (string) $session['id'], 30, 3600);
        $this->limits->hit('radar_create_ip', $request->ip(), 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['title']);
        $count = $this->db->prepare("SELECT COUNT(*) FROM radar_events WHERE user_id=? AND state<>'deleted'");
        $count->execute([$session['id']]);
        if ((int) $count->fetchColumn() >= 100) {
            throw new HttpException(409, 'radar_quota', 'Ton espace contient déjà 100 parties. Supprime un ancien brouillon avant d’en créer une.');
        }
        $title = array_key_exists('title', $body)
            ? Validator::text($body['title'], 'Le titre', 3, 120)
            : 'Brouillon sans titre';
        $id = Support::uuid();
        $slug = $this->slug($title, $id);
        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare('INSERT INTO radar_events (id,user_id,slug,title) VALUES (?,?,?,?)');
            $statement->execute([$id, $session['id'], $slug, $title]);
            $rule = $this->db->prepare(
                "INSERT INTO radar_event_rules (event_id,rule_type,rule_state) VALUES (?,?,'not_communicated')"
            );
            foreach (RadarValidator::RULE_TYPES as $type) {
                $rule->execute([$id, $type]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.create', 'radar_event', $id);
        Response::json(['event' => $this->present($this->owned($id, (string) $session['id']))], 201);
    }

    public function get(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        Response::json(['event' => $this->present($this->owned($params['id'], (string) $session['id']))]);
    }

    public function update(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_update', (string) $session['id'], 240, 3600);
        $this->limits->hit('radar_update_ip', $request->ip(), 480, 3600);
        $body = $request->json();
        Validator::keys($body, self::EDITABLE_FIELDS, ['version']);
        $current = $this->owned($params['id'], (string) $session['id']);
        if (in_array($current['state'], ['cancelled','expired','deleted'], true)) {
            throw new HttpException(409, 'radar_not_editable', 'Cette partie n’est plus modifiable. Duplique-la pour créer une nouvelle édition.');
        }
        $version = Validator::version($body['version']);
        $values = $this->mergedValues($current, $body);
        $rules = array_key_exists('rules', $body) ? RadarValidator::rules($body['rules']) : $this->rules($params['id']);
        $links = array_key_exists('links', $body) ? RadarValidator::links($body['links']) : $this->links($params['id']);
        if ($current['state'] === 'published') {
            $this->assertPublishable($values, $rules);
        }
        $slug = $current['state'] === 'draft' && array_key_exists('title', $body)
            ? $this->slug($values['title'], (string) $current['id'])
            : $current['slug'];

        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare(
                'UPDATE radar_events SET slug=?,title=?,venue_name=?,short_description=?,starts_at_utc=?,ends_at_utc=?,'
                . 'scenario=?,level_label=?,beginners_welcome=?,max_capacity=?,price_cents=?,minimum_age=?,'
                . 'rental_details=?,catering_details=?,toilets_available=?,latitude=?,longitude=?,location_method=?,'
                . 'location_confirmed_at=?,location_visibility=?,exact_address=?,public_location_label=?,city=?,postal_code=?,'
                . 'department_code=?,department=?,region=?,registration_url=?,contact_email_ciphertext=?,version=version+1 '
                . 'WHERE id=? AND user_id=? AND version=?'
            );
            $statement->execute([
                $slug, $values['title'], $values['venueName'], $values['description'], $values['startsAtUtc'], $values['endsAtUtc'],
                $values['scenario'], $values['level'], $values['beginnersWelcome'] ? 1 : 0, $values['maxCapacity'],
                $values['priceCents'], $values['minimumAge'], $values['rentalDetails'], $values['cateringDetails'],
                $values['toiletsAvailable'] === null ? null : ($values['toiletsAvailable'] ? 1 : 0),
                $values['latitude'], $values['longitude'],
                $values['locationMethod'], $values['locationConfirmedAt'], $values['locationVisibility'],
                $values['exactAddress'], $values['publicLocationLabel'], $values['city'], $values['postalCode'],
                $values['departmentCode'], $values['department'], $values['region'], $values['registrationUrl'],
                $values['contactEmailCiphertext'], $params['id'], $session['id'], $version,
            ]);
            if ($statement->rowCount() !== 1) {
                throw new HttpException(409, 'version_conflict', 'La partie a été modifiée ailleurs. Recharge-la avant de continuer.');
            }
            if (array_key_exists('rules', $body)) {
                $this->replaceRules($params['id'], $rules);
            }
            if (array_key_exists('links', $body)) {
                $this->replaceLinks($params['id'], $links);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.update', 'radar_event', $params['id']);
        Response::json(['event' => $this->present($this->owned($params['id'], (string) $session['id']))]);
    }

    public function publish(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_publish', (string) $session['id'], 20, 3600);
        $this->limits->hit('radar_publish_ip', $request->ip(), 40, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','turnstileToken'], ['version','turnstileToken']);
        $this->turnstile->verify($body['turnstileToken'], 'radar_publish', $request);
        $row = $this->owned($params['id'], (string) $session['id']);
        if ($row['state'] !== 'draft') {
            throw new HttpException(409, 'radar_publish_conflict', 'Seul un brouillon peut être publié.');
        }
        $values = $this->mergedValues($row, []);
        $rules = $this->rules($params['id']);
        $this->assertPublishable($values, $rules);
        $statement = $this->db->prepare(
            "UPDATE radar_events SET state='published',published_at=UTC_TIMESTAMP(),expires_at=ends_at_utc,version=version+1 "
            . "WHERE id=? AND user_id=? AND version=? AND state='draft'"
        );
        $statement->execute([$params['id'], $session['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'Le brouillon a été modifié ailleurs. Recharge-le avant de publier.');
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.publish', 'radar_event', $params['id']);
        Response::json(['event' => $this->present($this->owned($params['id'], (string) $session['id']))]);
    }

    public function cancel(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_cancel', (string) $session['id'], 30, 3600);
        $this->limits->hit('radar_cancel_ip', $request->ip(), 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','turnstileToken'], ['version','turnstileToken']);
        $this->turnstile->verify($body['turnstileToken'], 'radar_cancel', $request);
        $statement = $this->db->prepare(
            "UPDATE radar_events SET state='cancelled',cancelled_at=UTC_TIMESTAMP(),version=version+1 "
            . "WHERE id=? AND user_id=? AND version=? AND state='published'"
        );
        $statement->execute([$params['id'], $session['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'radar_cancel_conflict', 'Cette partie n’est plus annulable avec cette version.');
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.cancel', 'radar_event', $params['id']);
        Response::json(['event' => $this->present($this->owned($params['id'], (string) $session['id']))]);
    }

    public function duplicate(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_duplicate', (string) $session['id'], 30, 3600);
        $this->limits->hit('radar_duplicate_ip', $request->ip(), 60, 3600);
        $body = $request->rawBody === '' ? [] : $request->json();
        Validator::keys($body, []);
        $current = $this->owned($params['id'], (string) $session['id']);
        $id = Support::uuid();
        $title = mb_substr('Copie — ' . (string) $current['title'], 0, 120);
        $slug = $this->slug($title, $id);
        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare(
                "INSERT INTO radar_events (id,user_id,slug,state,moderation_state,title,venue_name,"
                . "short_description,starts_at_utc,ends_at_utc,scenario,level_label,beginners_welcome,max_capacity,"
                . "price_cents,minimum_age,rental_details,catering_details,toilets_available,latitude,longitude,location_method,"
                . "location_confirmed_at,location_visibility,exact_address,public_location_label,city,postal_code,department_code,"
                . "department,region,registration_url,contact_email_ciphertext) "
                . "SELECT ?,user_id,?,'draft','visible',?,venue_name,short_description,starts_at_utc,ends_at_utc,"
                . "scenario,level_label,beginners_welcome,max_capacity,price_cents,minimum_age,rental_details,"
                . "catering_details,toilets_available,latitude,longitude,location_method,location_confirmed_at,location_visibility,exact_address,"
                . "public_location_label,city,postal_code,department_code,department,region,registration_url,contact_email_ciphertext "
                . "FROM radar_events WHERE id=? AND user_id=? AND state<>'deleted'"
            );
            $statement->execute([$id, $slug, $title, $params['id'], $session['id']]);
            if ($statement->rowCount() !== 1) {
                throw new HttpException(404, 'radar_not_found', 'Partie introuvable.');
            }
            $rules = $this->db->prepare(
                'INSERT INTO radar_event_rules (event_id,rule_type,rule_state,joules,details) '
                . 'SELECT ?,rule_type,rule_state,joules,details FROM radar_event_rules WHERE event_id=?'
            );
            $rules->execute([$id, $params['id']]);
            $links = $this->db->prepare(
                'INSERT INTO radar_event_links (id,event_id,link_type,url,sort_order) '
                . 'SELECT UUID(),?,link_type,url,sort_order FROM radar_event_links WHERE event_id=?'
            );
            $links->execute([$id, $params['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.duplicate', 'radar_event', $id, ['sourceId' => $params['id']]);
        Response::json(['event' => $this->present($this->owned($id, (string) $session['id']))], 201);
    }

    public function delete(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('radar_delete', (string) $session['id'], 30, 3600);
        $this->limits->hit('radar_delete_ip', $request->ip(), 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','turnstileToken'], ['version','turnstileToken']);
        $this->turnstile->verify($body['turnstileToken'], 'radar_delete', $request);
        $statement = $this->db->prepare(
            "UPDATE radar_events SET state='deleted',deleted_at=UTC_TIMESTAMP(),version=version+1 "
            . "WHERE id=? AND user_id=? AND version=? AND state<>'deleted'"
        );
        $statement->execute([$params['id'], $session['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'radar_delete_conflict', 'Cette partie n’est plus supprimable avec cette version.');
        }
        $this->audit->write($request->requestId, $session['id'], 'radar.delete', 'radar_event', $params['id']);
        Response::noContent();
    }

    public function geocode(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->limits->hit('radar_geocode', (string) $session['id'], 120, 3600);
        $this->limits->hit('radar_geocode_ip', $request->ip(), 240, 3600);
        $query = $request->query();
        Validator::keys($query, ['q'], ['q']);
        Response::json(['suggestions' => $this->geocoder->search($query['q'])]);
    }

    /** @return array<string,mixed> */
    private function owned(string $id, string $userId): array
    {
        $statement = $this->db->prepare('SELECT * FROM radar_events WHERE id=? AND user_id=? AND state<>\'deleted\' LIMIT 1');
        $statement->execute([$id, $userId]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpException(404, 'radar_not_found', 'Partie introuvable.');
        }
        return $row;
    }

    /** @param array<string,mixed> $current @param array<string,mixed> $body @return array<string,mixed> */
    private function mergedValues(array $current, array $body): array
    {
        $title = array_key_exists('title', $body)
            ? Validator::text($body['title'], 'Le titre', 3, 120)
            : (string) $current['title'];
        $start = array_key_exists('startLocal', $body)
            ? RadarValidator::localDate($body['startLocal'], 'La date de début')
            : $current['starts_at_utc'];
        $end = array_key_exists('endLocal', $body)
            ? RadarValidator::localDate($body['endLocal'], 'La date de fin')
            : $current['ends_at_utc'];
        if (($start === null) !== ($end === null) || ($start !== null && $end !== null && $end <= $start)) {
            throw new HttpException(422, 'validation', 'La fin doit être postérieure au début.');
        }
        $max = array_key_exists('maxCapacity', $body)
            ? RadarValidator::optionalInteger($body['maxCapacity'], 'La capacité', 1, 5000)
            : ($current['max_capacity'] === null ? null : (int) $current['max_capacity']);
        $toilets = $current['toilets_available'] === null ? null : (bool) $current['toilets_available'];
        if (array_key_exists('toiletsAvailable', $body)) {
            $toilets = $body['toiletsAvailable'] === null
                ? null
                : RadarValidator::boolean($body['toiletsAvailable'], 'La présence de toilettes');
        }

        $latitude = $current['latitude'] === null ? null : (float) $current['latitude'];
        $longitude = $current['longitude'] === null ? null : (float) $current['longitude'];
        $method = $current['location_method'];
        $confirmedAt = $current['location_confirmed_at'];
        if (array_key_exists('latitude', $body) || array_key_exists('longitude', $body)) {
            $rawLat = $body['latitude'] ?? $latitude;
            $rawLon = $body['longitude'] ?? $longitude;
            if ($rawLat === null && $rawLon === null) {
                $latitude = $longitude = $method = $confirmedAt = null;
            } else {
                [$latitude, $longitude] = RadarValidator::coordinates($rawLat, $rawLon);
                $method = array_key_exists('locationMethod', $body)
                    ? RadarValidator::enum($body['locationMethod'], 'La méthode de localisation', ['geocoded','manual'])
                    : ($method ?? 'manual');
                $confirmedAt = null;
            }
        } elseif (array_key_exists('locationMethod', $body)) {
            if ($latitude === null) {
                throw new HttpException(422, 'validation', 'Choisis des coordonnées avant leur méthode de localisation.');
            }
            $method = RadarValidator::enum($body['locationMethod'], 'La méthode de localisation', ['geocoded','manual']);
        }
        if (array_key_exists('locationConfirmed', $body)) {
            $confirmed = RadarValidator::boolean($body['locationConfirmed'], 'La confirmation de position');
            if ($confirmed && ($latitude === null || $longitude === null)) {
                throw new HttpException(422, 'validation', 'Place et confirme le point sur la carte.');
            }
            $confirmedAt = $confirmed ? gmdate('Y-m-d H:i:s') : null;
        }

        $emailCiphertext = $current['contact_email_ciphertext'];
        if (array_key_exists('contactEmail', $body)) {
            $email = trim((string) $body['contactEmail']);
            $emailCiphertext = $email === '' ? null : $this->sensitive->encrypt(Validator::email($email));
        }

        return [
            'title' => $title,
            'venueName' => $this->text($body, 'venueName', $current['venue_name'], 'Le nom du terrain', 120),
            'description' => $this->text($body, 'description', $current['short_description'], 'La description', 800),
            'startsAtUtc' => $start,
            'endsAtUtc' => $end,
            'scenario' => $this->text($body, 'scenario', $current['scenario'], 'Le scénario', 120),
            'level' => $this->text($body, 'level', $current['level_label'], 'Le niveau', 80),
            'beginnersWelcome' => array_key_exists('beginnersWelcome', $body)
                ? RadarValidator::boolean($body['beginnersWelcome'], 'L’accueil des débutants')
                : (bool) $current['beginners_welcome'],
            'maxCapacity' => $max,
            'priceCents' => array_key_exists('priceCents', $body)
                ? RadarValidator::optionalInteger($body['priceCents'], 'Le prix', 0, 1_000_000)
                : ($current['price_cents'] === null ? null : (int) $current['price_cents']),
            'minimumAge' => array_key_exists('minimumAge', $body)
                ? RadarValidator::optionalInteger($body['minimumAge'], 'L’âge minimum', 10, 99)
                : ($current['minimum_age'] === null ? null : (int) $current['minimum_age']),
            'rentalDetails' => $this->text($body, 'rentalDetails', $current['rental_details'], 'La location', 255),
            'cateringDetails' => $this->text($body, 'cateringDetails', $current['catering_details'], 'La restauration', 255),
            'toiletsAvailable' => $toilets,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'locationMethod' => $method,
            'locationConfirmedAt' => $confirmedAt,
            'locationVisibility' => array_key_exists('locationVisibility', $body)
                ? RadarValidator::enum($body['locationVisibility'], 'La précision publique', ['exact','approximate'])
                : $current['location_visibility'],
            'exactAddress' => $this->text($body, 'exactAddress', $current['exact_address'], 'L’adresse exacte', 255),
            'publicLocationLabel' => $this->text($body, 'publicLocationLabel', $current['public_location_label'], 'Le lieu public', 160),
            'city' => $this->text($body, 'city', $current['city'], 'La commune', 120),
            'postalCode' => $this->text($body, 'postalCode', $current['postal_code'], 'Le code postal', 10),
            'departmentCode' => $this->text($body, 'departmentCode', $current['department_code'], 'Le code département', 3),
            'department' => $this->text($body, 'department', $current['department'], 'Le département', 120),
            'region' => $this->text($body, 'region', $current['region'], 'La région', 120),
            'registrationUrl' => array_key_exists('registrationUrl', $body)
                ? RadarValidator::httpsUrl($body['registrationUrl'], 'Le lien d’inscription')
                : $current['registration_url'],
            'contactEmailCiphertext' => $emailCiphertext,
        ];
    }

    /** @param array<string,mixed> $body */
    private function text(array $body, string $key, mixed $current, string $label, int $max): ?string
    {
        return array_key_exists($key, $body)
            ? RadarValidator::optionalText($body[$key], $label, $max)
            : ($current === null ? null : (string) $current);
    }

    /** @param array<string,mixed> $values @param list<array<string,mixed>> $rules */
    private function assertPublishable(array $values, array $rules): void
    {
        $missing = [];
        foreach ([
            'title' => 'titre', 'venueName' => 'terrain', 'description' => 'description', 'startsAtUtc' => 'début',
            'endsAtUtc' => 'fin', 'scenario' => 'scénario', 'level' => 'niveau', 'maxCapacity' => 'capacité',
            'toiletsAvailable' => 'toilettes', 'latitude' => 'latitude', 'longitude' => 'longitude',
            'locationConfirmedAt' => 'confirmation du point', 'publicLocationLabel' => 'lieu public',
            'registrationUrl' => 'lien d’inscription',
        ] as $key => $label) {
            if ($values[$key] === null || $values[$key] === '') {
                $missing[] = $label;
            }
        }
        if (count($rules) !== count(RadarValidator::RULE_TYPES)) {
            $missing[] = 'matrice complète des règles';
        }
        if ($values['endsAtUtc'] !== null && $values['endsAtUtc'] <= gmdate('Y-m-d H:i:s')) {
            $missing[] = 'date future';
        }
        if ($missing) {
            throw new HttpException(422, 'radar_incomplete', 'Complète la fiche avant de la publier.', ['missing' => $missing]);
        }
    }

    /** @return list<array{type:string,state:string,joules:?float,details:?string}> */
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

    /** @return list<array{type:string,url:string}> */
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

    /** @param list<array<string,mixed>> $rules */
    private function replaceRules(string $eventId, array $rules): void
    {
        $delete = $this->db->prepare('DELETE FROM radar_event_rules WHERE event_id=?');
        $delete->execute([$eventId]);
        $insert = $this->db->prepare(
            'INSERT INTO radar_event_rules (event_id,rule_type,rule_state,joules,details) VALUES (?,?,?,?,?)'
        );
        foreach ($rules as $rule) {
            $insert->execute([$eventId, $rule['type'], $rule['state'], $rule['joules'], $rule['details']]);
        }
    }

    /** @param list<array<string,mixed>> $links */
    private function replaceLinks(string $eventId, array $links): void
    {
        $delete = $this->db->prepare('DELETE FROM radar_event_links WHERE event_id=?');
        $delete->execute([$eventId]);
        $insert = $this->db->prepare(
            'INSERT INTO radar_event_links (id,event_id,link_type,url,sort_order) VALUES (?,?,?,?,?)'
        );
        foreach ($links as $order => $link) {
            $insert->execute([Support::uuid(), $eventId, $link['type'], $link['url'], $order]);
        }
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function present(array $row): array
    {
        return [
            'id' => $row['id'],
            'slug' => $row['slug'],
            'state' => $row['state'],
            'moderationState' => $row['moderation_state'],
            'title' => $row['title'],
            'venueName' => $row['venue_name'],
            'description' => $row['short_description'],
            'startLocal' => $this->local((string) ($row['starts_at_utc'] ?? '')),
            'endLocal' => $this->local((string) ($row['ends_at_utc'] ?? '')),
            'scenario' => $row['scenario'],
            'level' => $row['level_label'],
            'beginnersWelcome' => (bool) $row['beginners_welcome'],
            'maxCapacity' => $row['max_capacity'] === null ? null : (int) $row['max_capacity'],
            'priceCents' => $row['price_cents'] === null ? null : (int) $row['price_cents'],
            'minimumAge' => $row['minimum_age'] === null ? null : (int) $row['minimum_age'],
            'rentalDetails' => $row['rental_details'],
            'cateringDetails' => $row['catering_details'],
            'toiletsAvailable' => $row['toilets_available'] === null ? null : (bool) $row['toilets_available'],
            'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'],
            'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'],
            'locationMethod' => $row['location_method'],
            'locationConfirmed' => $row['location_confirmed_at'] !== null,
            'locationVisibility' => $row['location_visibility'],
            'exactAddress' => $row['exact_address'],
            'publicLocationLabel' => $row['public_location_label'],
            'city' => $row['city'],
            'postalCode' => $row['postal_code'],
            'departmentCode' => $row['department_code'],
            'department' => $row['department'],
            'region' => $row['region'],
            'registrationUrl' => $row['registration_url'],
            'contactEmailConfigured' => $row['contact_email_ciphertext'] !== null,
            'rules' => $this->rules((string) $row['id']),
            'links' => $this->links((string) $row['id']),
            'version' => (int) $row['version'],
            'publishedAt' => $row['published_at'],
            'cancelledAt' => $row['cancelled_at'],
            'expiresAt' => $row['expires_at'],
            'updatedAt' => $row['updated_at'],
            'publicUrl' => '/parties-airsoft/' . $row['slug'] . '/',
        ];
    }

    private function local(string $utc): ?string
    {
        if ($utc === '') {
            return null;
        }
        return (new DateTimeImmutable($utc, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone('Europe/Paris'))
            ->format('Y-m-d\TH:i');
    }

    private function slug(string $title, string $id): string
    {
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', mb_strtolower($title)) ?: 'partie-airsoft';
        $slug = trim(preg_replace('/[^a-z0-9]+/', '-', $ascii) ?? '', '-');
        return substr($slug !== '' ? $slug : 'partie-airsoft', 0, 145) . '-' . substr(str_replace('-', '', $id), 0, 8);
    }
}
