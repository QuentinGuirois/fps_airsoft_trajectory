<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Support;
use PDO;

final class SessionService
{
    public function __construct(private readonly PDO $db, private readonly Config $config)
    {
    }

    /** @return array<string,mixed>|null */
    public function current(Request $request): ?array
    {
        $token = $this->cookie($request, $this->config->get('SESSION_COOKIE', 'fat_session'));
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            return null;
        }
        $statement = $this->db->prepare(
            'SELECT s.id AS session_id,s.csrf_token,s.expires_at,u.id,u.email,u.pseudo,u.role,u.email_verified_at,u.deletion_requested_at,u.version '
            . 'FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() LIMIT 1'
        );
        $statement->execute([Support::tokenHash($token)]);
        $session = $statement->fetch();
        if (!$session || $session['deletion_requested_at'] !== null) {
            return null;
        }
        $touch = $this->db->prepare('UPDATE sessions SET last_seen_at=UTC_TIMESTAMP() WHERE id=? AND last_seen_at<UTC_TIMESTAMP()-INTERVAL 5 MINUTE');
        $touch->execute([$session['session_id']]);
        return $session;
    }

    /** @return array<string,mixed> */
    public function require(Request $request, ?string $role = null): array
    {
        $session = $this->current($request);
        if ($session === null) {
            throw new HttpException(401, 'unauthorized', 'Connexion requise.');
        }
        if ($role !== null && $session['role'] !== $role) {
            throw new HttpException(403, 'forbidden', 'Permission insuffisante.');
        }
        return $session;
    }

    /** @param array<string,mixed> $session */
    public function requireCsrf(Request $request, array $session): void
    {
        $token = $request->header('x-csrf-token');
        if ($token === '' || !hash_equals((string) $session['csrf_token'], $token)) {
            throw new HttpException(403, 'csrf', 'Jeton CSRF invalide.');
        }
    }

    /** @return array{token:string,csrfToken:string} */
    public function create(string $userId, Request $request): array
    {
        $token = Support::token();
        $csrf = Support::token();
        $ttl = min(2_592_000, max(3_600, $this->config->int('SESSION_TTL_SECONDS', 1_209_600)));
        $expires = gmdate('Y-m-d H:i:s', time() + $ttl);
        $userAgentHash = $request->header('user-agent') === '' ? null : hash('sha256', $request->header('user-agent'), true);
        $statement = $this->db->prepare('INSERT INTO sessions (id,user_id,token_hash,csrf_token,user_agent_hash,expires_at) VALUES (?,?,?,?,?,?)');
        $statement->execute([Support::uuid(), $userId, Support::tokenHash($token), $csrf, $userAgentHash, $expires]);
        setcookie($this->config->get('SESSION_COOKIE', 'fat_session'), $token, [
            'expires' => time() + $ttl,
            'path' => '/api/v1',
            'secure' => $this->config->isProduction(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        return ['token' => $token, 'csrfToken' => $csrf];
    }

    /** @param array<string,mixed> $session */
    public function destroy(array $session): void
    {
        $statement = $this->db->prepare('DELETE FROM sessions WHERE id=? AND user_id=?');
        $statement->execute([$session['session_id'], $session['id']]);
        $this->clearCookie();
    }

    public function destroyAll(string $userId): void
    {
        $statement = $this->db->prepare('DELETE FROM sessions WHERE user_id=?');
        $statement->execute([$userId]);
        $this->clearCookie();
    }

    private function clearCookie(): void
    {
        setcookie($this->config->get('SESSION_COOKIE', 'fat_session'), '', [
            'expires' => 1,
            'path' => '/api/v1',
            'secure' => $this->config->isProduction(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    private function cookie(Request $request, string $name): string
    {
        foreach (explode(';', $request->header('cookie')) as $part) {
            [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($key === $name) {
                return rawurldecode($value);
            }
        }
        return '';
    }
}
