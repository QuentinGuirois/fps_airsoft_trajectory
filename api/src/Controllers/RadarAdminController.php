<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SessionService;
use Fat\Api\Validation\RadarValidator;
use Fat\Api\Validation\Validator;
use PDO;

final class RadarAdminController
{
    public function __construct(
        private readonly PDO $db,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
    ) {
    }

    public function events(Request $request): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->limits->hit('admin_radar_events', (string) $session['id'], 240, 3600);
        $query = $request->query();
        Validator::keys($query, ['sourceTier','verification','geocodeStatus','state','fixtures','limit']);
        $where = ["r.state<>'deleted'"];
        $parameters = [];
        if (($query['sourceTier'] ?? '') !== '') {
            $tier = RadarValidator::enum($query['sourceTier'], 'Le niveau de source', ['primary','secondary']);
            $where[] = 'EXISTS (SELECT 1 FROM radar_event_sources filter_source WHERE filter_source.event_id=r.id AND filter_source.source_tier=?)';
            $parameters[] = $tier;
        }
        if (($query['verification'] ?? '') !== '') {
            $verification = RadarValidator::enum($query['verification'], 'L’état de vérification', ['pending','verified']);
            $where[] = $verification === 'pending'
                ? 'r.requires_pre_publication_check=1'
                : 'r.requires_pre_publication_check=0';
        }
        if (($query['geocodeStatus'] ?? '') !== '') {
            $geocode = RadarValidator::enum(
                $query['geocodeStatus'],
                'L’état de géocodage',
                ['not_requested','validated','needs_review'],
            );
            $where[] = 'r.geocode_status=?';
            $parameters[] = $geocode;
        }
        if (($query['state'] ?? '') !== '') {
            $state = RadarValidator::enum(
                $query['state'],
                'Le statut',
                ['draft','published','cancelled','expired'],
            );
            $where[] = 'r.state=?';
            $parameters[] = $state;
        }
        $fixtures = $query['fixtures'] ?? 'exclude';
        if (!in_array($fixtures, ['exclude','only','include'], true)) {
            throw new HttpException(422, 'validation', 'Le filtre de fixtures est invalide.');
        }
        if ($fixtures !== 'include') {
            $where[] = $fixtures === 'only' ? 'r.is_fixture=1' : 'r.is_fixture=0';
        }
        $limit = isset($query['limit'])
            ? RadarValidator::optionalInteger($query['limit'], 'La limite', 1, 500)
            : 250;
        $statement = $this->db->prepare(
            'SELECT r.id,r.external_key,r.slug,r.state,r.moderation_state,r.record_visibility,r.title,r.organizer_name,'
            . 'r.event_type,r.terrain_type,r.venue_name,r.short_description,r.starts_at_utc,r.ends_at_utc,r.schedule_precision,'
            . 'r.max_capacity,r.price_min_cents,r.price_max_cents,r.toilets_available,r.latitude,r.longitude,'
            . 'r.location_visibility,r.location_precision,r.geocode_status,r.geocode_checked_at,r.public_location_label,'
            . 'r.city,r.postal_code,r.department_code,r.registration_url,r.requires_pre_publication_check,'
            . 'r.last_source_verified_at,r.pre_publication_checked_at,r.is_fixture,r.version,r.updated_at,u.pseudo AS owner_pseudo,'
            . '(SELECT s.source_tier FROM radar_event_sources s WHERE s.event_id=r.id ORDER BY s.updated_at DESC,s.id DESC LIMIT 1) AS source_tier,'
            . '(SELECT s.source_url FROM radar_event_sources s WHERE s.event_id=r.id ORDER BY s.updated_at DESC,s.id DESC LIMIT 1) AS source_url,'
            . '(SELECT s.source_locator FROM radar_event_sources s WHERE s.event_id=r.id ORDER BY s.updated_at DESC,s.id DESC LIMIT 1) AS source_locator '
            . 'FROM radar_events r JOIN users u ON u.id=r.user_id WHERE ' . implode(' AND ', $where)
            . ' ORDER BY r.is_fixture ASC,r.starts_at_utc ASC,r.updated_at DESC LIMIT ' . (int) $limit
        );
        $statement->execute($parameters);
        Response::json(['events' => array_map(fn(array $row): array => $this->presentEvent($row), $statement->fetchAll())]);
    }

    public function review(Request $request, array $params): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_radar_review', (string) $session['id'], 120, 3600);
        $body = $request->json();
        Validator::keys(
            $body,
            ['version','confirmSource','confirmDate','confirmLocation','confirmRules'],
            ['version','confirmSource','confirmDate','confirmLocation','confirmRules'],
        );
        foreach (['confirmSource','confirmDate','confirmLocation','confirmRules'] as $confirmation) {
            Validator::boolTrue($body[$confirmation], 'Chaque point de contrôle');
        }
        $version = Validator::version($body['version']);
        $current = $this->eventForUpdate($params['id']);
        if ((int) $current['is_fixture'] === 1) {
            throw new HttpException(409, 'radar_fixture_private', 'Une fixture locale ne peut jamais être validée pour publication.');
        }
        if ($current['state'] !== 'draft' || $current['record_visibility'] !== 'admin_preview_only') {
            throw new HttpException(409, 'radar_review_conflict', 'Seul un brouillon importé peut suivre ce contrôle.');
        }
        $source = $this->db->prepare('SELECT COUNT(*) FROM radar_event_sources WHERE event_id=?');
        $source->execute([$params['id']]);
        if ((int) $source->fetchColumn() < 1) {
            throw new HttpException(422, 'radar_source_missing', 'La fiche ne possède aucune source vérifiable.');
        }
        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare(
                'UPDATE radar_events SET requires_pre_publication_check=0,last_source_verified_at=UTC_TIMESTAMP(),'
                . 'pre_publication_checked_by=?,pre_publication_checked_at=UTC_TIMESTAMP(),version=version+1 '
                . "WHERE id=? AND version=? AND state='draft' AND record_visibility='admin_preview_only' AND is_fixture=0"
            );
            $statement->execute([$session['id'], $params['id'], $version]);
            if ($statement->rowCount() !== 1) {
                throw new HttpException(409, 'version_conflict', 'La fiche a été modifiée ailleurs. Recharge-la avant de confirmer.');
            }
            $sources = $this->db->prepare(
                'UPDATE radar_event_sources SET requires_pre_publication_check=0,last_verified_at=UTC_TIMESTAMP() WHERE event_id=?'
            );
            $sources->execute([$params['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
        $this->audit->write($request->requestId, $session['id'], 'admin.radar.review', 'radar_event', $params['id']);
        Response::json(['id' => $params['id'], 'verified' => true, 'version' => $version + 1]);
    }

    public function publish(Request $request, array $params): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_radar_publish', (string) $session['id'], 30, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','confirmation'], ['version','confirmation']);
        if ($body['confirmation'] !== 'PUBLIER') {
            throw new HttpException(422, 'radar_publish_confirmation', 'Saisis PUBLIER pour confirmer cette publication.');
        }
        $version = Validator::version($body['version']);
        $event = $this->eventForUpdate($params['id']);
        if ((int) $event['is_fixture'] === 1) {
            throw new HttpException(409, 'radar_fixture_private', 'Une fixture locale ne peut jamais être publiée.');
        }
        if ($event['state'] !== 'draft' || (int) $event['requires_pre_publication_check'] !== 0) {
            throw new HttpException(409, 'radar_review_required', 'Le contrôle administratif doit être terminé avant publication.');
        }
        $missing = [];
        foreach ([
            'starts_at_utc' => 'date de début',
            'ends_at_utc' => 'date de fin',
            'registration_url' => 'URL d’inscription/contact',
            'public_location_label' => 'libellé public du lieu',
            'last_source_verified_at' => 'source vérifiée',
            'pre_publication_checked_at' => 'contrôle administratif',
        ] as $column => $label) {
            if ($event[$column] === null || $event[$column] === '') {
                $missing[] = $label;
            }
        }
        if ((string) $event['ends_at_utc'] <= gmdate('Y-m-d H:i:s')) {
            $missing[] = 'date future';
        }
        if ($event['location_precision'] === 'undisclosed') {
            if ($event['latitude'] !== null || $event['longitude'] !== null) {
                $missing[] = 'absence de coordonnées pour le lieu non communiqué';
            }
        } elseif (
            $event['geocode_status'] !== 'validated'
            || $event['latitude'] === null
            || $event['longitude'] === null
            || $event['location_confirmed_at'] === null
        ) {
            $missing[] = 'position validée';
        }
        if ($missing) {
            throw new HttpException(422, 'radar_incomplete', 'La fiche ne peut pas encore être publiée.', ['missing' => $missing]);
        }
        $statement = $this->db->prepare(
            "UPDATE radar_events SET state='published',record_visibility='public',published_at=UTC_TIMESTAMP(),"
            . 'expires_at=ends_at_utc,version=version+1 '
            . "WHERE id=? AND version=? AND state='draft' AND requires_pre_publication_check=0 AND is_fixture=0"
        );
        $statement->execute([$params['id'], $version]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'La fiche a été modifiée ailleurs. Recharge-la avant de publier.');
        }
        $this->audit->write($request->requestId, $session['id'], 'admin.radar.publish', 'radar_event', $params['id']);
        Response::json(['id' => $params['id'], 'state' => 'published', 'version' => $version + 1]);
    }

    public function reports(Request $request): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->limits->hit('admin_radar_reports', (string) $session['id'], 120, 3600);
        $query = $request->query();
        Validator::keys($query, ['status']);
        $status = $query['status'] ?? 'open';
        if (!in_array($status, ['open','reviewed','dismissed'], true)) {
            throw new HttpException(422, 'validation', 'Le statut de signalement est invalide.');
        }
        $statement = $this->db->prepare(
            'SELECT p.id,p.reason,p.message,p.status,p.created_at,p.reviewed_at,r.id AS event_id,r.slug,r.title,'
            . 'r.state,r.moderation_state,r.version,r.published_at,r.cancelled_at,r.expires_at,r.hidden_at,'
            . 'r.restored_at,r.hidden_reason,r.updated_at,u.pseudo AS owner_pseudo '
            . 'FROM radar_event_reports p JOIN radar_events r ON r.id=p.event_id JOIN users u ON u.id=r.user_id '
            . 'WHERE p.status=? ORDER BY p.created_at ASC LIMIT 200'
        );
        $statement->execute([$status]);
        Response::json(['reports' => array_map(static fn(array $row): array => [
            'id' => $row['id'],
            'reason' => $row['reason'],
            'message' => $row['message'],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
            'reviewedAt' => $row['reviewed_at'],
            'event' => [
                'id' => $row['event_id'],
                'slug' => $row['slug'],
                'title' => $row['title'],
                'state' => $row['state'],
                'moderationState' => $row['moderation_state'],
                'version' => (int) $row['version'],
                'ownerPseudo' => $row['owner_pseudo'],
                'history' => [
                    'publishedAt' => $row['published_at'],
                    'cancelledAt' => $row['cancelled_at'],
                    'expiresAt' => $row['expires_at'],
                    'hiddenAt' => $row['hidden_at'],
                    'restoredAt' => $row['restored_at'],
                    'hiddenReason' => $row['hidden_reason'],
                    'updatedAt' => $row['updated_at'],
                ],
            ],
        ], $statement->fetchAll())]);
    }

    public function hide(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], true);
    }

    public function restore(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], false);
    }

    private function moderate(Request $request, string $id, bool $hide): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_radar_moderate', (string) $session['id'], 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','reason'], ['version']);
        $version = Validator::version($body['version']);
        $reason = $hide
            ? RadarValidator::optionalText($body['reason'] ?? null, 'Le motif de masquage', 500, 3)
            : null;
        if ($hide && $reason === null) {
            throw new HttpException(422, 'validation', 'Le motif de masquage est obligatoire.');
        }
        $statement = $hide
            ? $this->db->prepare(
                "UPDATE radar_events SET moderation_state='hidden',hidden_by=?,hidden_reason=?,hidden_at=UTC_TIMESTAMP(),"
                . "restored_at=NULL,version=version+1 WHERE id=? AND version=? AND moderation_state='visible' AND state<>'deleted'"
            )
            : $this->db->prepare(
                "UPDATE radar_events SET moderation_state='visible',hidden_by=NULL,hidden_reason=NULL,restored_at=UTC_TIMESTAMP(),"
                . "version=version+1 WHERE id=? AND version=? AND moderation_state='hidden' AND state<>'deleted'"
            );
        $arguments = $hide
            ? [$session['id'], $reason, $id, $version]
            : [$id, $version];
        $statement->execute($arguments);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'radar_moderation_conflict', 'La partie n’est plus modérable avec cette version.');
        }
        $reports = $this->db->prepare(
            "UPDATE radar_event_reports SET status='reviewed',reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE event_id=? AND status='open'"
        );
        $reports->execute([$session['id'], $id]);
        $this->audit->write(
            $request->requestId,
            $session['id'],
            $hide ? 'admin.radar.hide' : 'admin.radar.restore',
            'radar_event',
            $id,
        );
        Response::json(['id' => $id, 'moderationState' => $hide ? 'hidden' : 'visible']);
    }

    /** @return array<string,mixed> */
    private function eventForUpdate(string $id): array
    {
        $statement = $this->db->prepare("SELECT * FROM radar_events WHERE id=? AND state<>'deleted' LIMIT 1");
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpException(404, 'radar_not_found', 'Partie introuvable.');
        }
        return $row;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function presentEvent(array $row): array
    {
        return [
            'id' => $row['id'],
            'externalKey' => $row['external_key'],
            'slug' => $row['slug'],
            'state' => $row['state'],
            'moderationState' => $row['moderation_state'],
            'recordVisibility' => $row['record_visibility'],
            'title' => $row['title'],
            'organizerName' => $row['organizer_name'],
            'eventType' => $row['event_type'],
            'terrainType' => $row['terrain_type'],
            'venueName' => $row['venue_name'],
            'description' => $row['short_description'],
            'startsAt' => $row['starts_at_utc'],
            'endsAt' => $row['ends_at_utc'],
            'schedulePrecision' => $row['schedule_precision'],
            'maxCapacity' => $row['max_capacity'] === null ? null : (int) $row['max_capacity'],
            'priceMinCents' => $row['price_min_cents'] === null ? null : (int) $row['price_min_cents'],
            'priceMaxCents' => $row['price_max_cents'] === null ? null : (int) $row['price_max_cents'],
            'toiletsAvailable' => $row['toilets_available'] === null ? null : (bool) $row['toilets_available'],
            'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'],
            'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'],
            'locationVisibility' => $row['location_visibility'],
            'locationPrecision' => $row['location_precision'],
            'geocodeStatus' => $row['geocode_status'],
            'geocodeCheckedAt' => $row['geocode_checked_at'],
            'locationLabel' => $row['public_location_label'],
            'city' => $row['city'],
            'postalCode' => $row['postal_code'],
            'departmentCode' => $row['department_code'],
            'registrationUrl' => $row['registration_url'],
            'requiresPrePublicationCheck' => (bool) $row['requires_pre_publication_check'],
            'lastSourceVerifiedAt' => $row['last_source_verified_at'],
            'prePublicationCheckedAt' => $row['pre_publication_checked_at'],
            'source' => $row['source_tier'] === null ? null : [
                'tier' => $row['source_tier'],
                'url' => $row['source_url'],
                'locator' => $row['source_locator'],
            ],
            'isFixture' => (bool) $row['is_fixture'],
            'version' => (int) $row['version'],
            'updatedAt' => $row['updated_at'],
            'owner' => ['pseudo' => $row['owner_pseudo']],
            'publicUrl' => '/parties-airsoft/' . $row['slug'] . '/',
        ];
    }
}
