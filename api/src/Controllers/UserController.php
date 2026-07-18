<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\SessionService;
use Fat\Api\Validation\Validator;
use PDO;

final class UserController
{
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly SessionService $sessions,
        private readonly AuditLogger $audit,
    ) {
    }

    public function me(Request $request): never
    {
        $session = $this->sessions->current($request);
        if ($session === null) {
            Response::json(['authenticated' => false]);
        }
        Response::json(['authenticated' => true, 'csrfToken' => $session['csrf_token'], 'user' => $this->user($session)]);
    }

    public function update(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $body = $request->json();
        Validator::keys($body, ['pseudo','version'], ['pseudo','version']);
        $pseudo = Validator::text($body['pseudo'], 'Le pseudo', 2, 32);
        $version = Validator::version($body['version']);
        try {
            $statement = $this->db->prepare('UPDATE users SET pseudo=?,version=version+1 WHERE id=? AND version=?');
            $statement->execute([$pseudo, $session['id'], $version]);
        } catch (\PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'pseudo_exists', 'Ce pseudo est déjà utilisé.');
            }
            throw $error;
        }
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'Le compte a été modifié ailleurs. Recharge la page.');
        }
        $this->audit->write($request->requestId, $session['id'], 'user.update', 'user', $session['id']);
        $fresh = $this->db->prepare('SELECT id,email,pseudo,role,email_verified_at,version FROM users WHERE id=?');
        $fresh->execute([$session['id']]);
        Response::json(['user' => $this->user($fresh->fetch())]);
    }

    public function export(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $replicas = $this->db->prepare('SELECT id,model_name,replica_type,mass_g,energy_j,simulation_url,youtube_url,state,image_status,created_at,updated_at FROM replica_posts WHERE user_id=? ORDER BY created_at');
        $replicas->execute([$session['id']]);
        $this->audit->write($request->requestId, $session['id'], 'user.export', 'user', $session['id']);
        Response::json([
            'exportedAt' => gmdate(DATE_ATOM),
            'user' => $this->user($session),
            'replicas' => $replicas->fetchAll(),
        ], 200, ['Content-Disposition' => 'attachment; filename="fat-export.json"']);
    }

    public function requestDeletion(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $body = $request->json();
        Validator::keys($body, ['confirm'], ['confirm']);
        Validator::boolTrue($body['confirm'], 'La suppression différée');
        $days = min(30, max(7, $this->config->int('DELETE_GRACE_DAYS', 14)));
        $statement = $this->db->prepare("UPDATE users SET deletion_requested_at=UTC_TIMESTAMP()+INTERVAL {$days} DAY,version=version+1 WHERE id=?");
        $statement->execute([$session['id']]);
        $this->audit->write($request->requestId, $session['id'], 'user.delete_requested', 'user', $session['id'], ['graceDays' => $days]);
        $this->sessions->destroyAll($session['id']);
        Response::json(['scheduled' => true, 'graceDays' => $days], 202);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function user(array $row): array
    {
        return [
            'id' => $row['id'],
            'email' => $row['email'],
            'pseudo' => $row['pseudo'],
            'role' => $row['role'],
            'verified' => $row['email_verified_at'] !== null,
            'version' => (int) $row['version'],
        ];
    }
}
