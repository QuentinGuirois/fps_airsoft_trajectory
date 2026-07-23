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
}
