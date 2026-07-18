<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SessionService;
use Fat\Api\Validation\Validator;
use PDO;

final class AdminController
{
    public function __construct(
        private readonly PDO $db,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
    ) {
    }

    public function list(Request $request): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->limits->hit('admin_list', $session['id'], 120, 3600);
        $statement = $this->db->query(
            "SELECT r.id,r.model_name,r.replica_type,r.mass_g,r.energy_j,r.useful_range_m,r.maximum_range_m,r.state,r.image_status,r.version,r.created_at,u.pseudo "
            . "FROM replica_posts r JOIN users u ON u.id=r.user_id WHERE r.state='pending' ORDER BY r.created_at ASC LIMIT 100"
        );
        Response::json(['replicas' => $statement->fetchAll()]);
    }

    public function publish(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], true);
    }

    public function reject(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], false);
    }

    private function moderate(Request $request, string $id, bool $publish): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_moderate', $session['id'], 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','note'], ['version']);
        $version = Validator::version($body['version']);
        $note = $publish ? null : Validator::text($body['note'] ?? '', 'Le motif de rejet', 3, 500);
        $state = $publish ? 'published' : 'rejected';
        $statement = $this->db->prepare(
            "UPDATE replica_posts SET state=?,moderation_note=?,moderated_by=?,moderated_at=UTC_TIMESTAMP(),version=version+1 "
            . "WHERE id=? AND version=? AND state='pending' AND image_status='ready'"
        );
        $statement->execute([$state, $note, $session['id'], $id, $version]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'moderation_conflict', 'La card n’est plus modérable avec cette version.');
        }
        $this->audit->write($request->requestId, $session['id'], 'admin.replica.' . $state, 'replica', $id);
        Response::json(['id' => $id, 'state' => $state]);
    }
}
