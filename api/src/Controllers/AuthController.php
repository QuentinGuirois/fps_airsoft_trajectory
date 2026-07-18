<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\Mailer;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SessionService;
use Fat\Api\Services\TurnstileVerifier;
use Fat\Api\Support;
use Fat\Api\Validation\Validator;
use PDO;
use PDOException;

final class AuthController
{
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
        private readonly TurnstileVerifier $turnstile,
    ) {
    }

    public function register(Request $request): never
    {
        $body = $request->json();
        Validator::keys($body, ['pseudo','email','password','turnstileToken'], ['pseudo','email','password','turnstileToken']);
        $this->limits->hit('register', $request->ip(), 4, 3600);
        $this->turnstile->verify($body['turnstileToken'], 'register', $request);
        $pseudo = Validator::text($body['pseudo'], 'Le pseudo', 2, 32);
        $email = Validator::email($body['email']);
        $password = Validator::password($body['password']);
        $userId = Support::uuid();
        $token = Support::token();
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        try {
            $this->db->beginTransaction();
            $insert = $this->db->prepare('INSERT INTO users (id,email,pseudo,password_hash) VALUES (?,?,?,?)');
            $insert->execute([$userId, $email, $pseudo, password_hash($password, $algorithm)]);
            $verify = $this->db->prepare('INSERT INTO email_verification_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,UTC_TIMESTAMP()+INTERVAL 24 HOUR)');
            $verify->execute([Support::uuid(), $userId, Support::tokenHash($token)]);
            $this->db->commit();
        } catch (PDOException $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'account_exists', 'Ce pseudo ou cet email est déjà utilisé.');
            }
            throw $error;
        }
        $link = $this->config->get('APP_ORIGIN') . '/compte/?verify=' . $token;
        $this->mailer->send($email, 'Vérifie ton compte F.A.T.', "Confirme ton adresse dans les 24 heures :\n{$link}\n");
        $this->audit->write($request->requestId, $userId, 'auth.register', 'user', $userId);
        Response::json(['created' => true, 'message' => 'Compte créé. Vérifie maintenant ton email.'], 201);
    }

    public function verifyEmail(Request $request): never
    {
        $body = $request->json();
        Validator::keys($body, ['token'], ['token']);
        $token = (string) $body['token'];
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw new HttpException(422, 'token', 'Jeton invalide.');
        }
        $this->db->beginTransaction();
        $select = $this->db->prepare('SELECT id,user_id FROM email_verification_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE');
        $select->execute([Support::tokenHash($token)]);
        $row = $select->fetch();
        if (!$row) {
            $this->db->rollBack();
            throw new HttpException(422, 'token', 'Jeton invalide ou expiré.');
        }
        $this->db->prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at,UTC_TIMESTAMP()),version=version+1 WHERE id=?')->execute([$row['user_id']]);
        $this->db->prepare('UPDATE email_verification_tokens SET consumed_at=UTC_TIMESTAMP() WHERE id=?')->execute([$row['id']]);
        $this->db->commit();
        $this->audit->write($request->requestId, $row['user_id'], 'auth.verify_email', 'user', $row['user_id']);
        Response::json(['verified' => true]);
    }

    public function login(Request $request): never
    {
        $body = $request->json();
        Validator::keys($body, ['identity','password','turnstileToken'], ['identity','password','turnstileToken']);
        $identity = mb_strtolower(trim((string) $body['identity']));
        $this->limits->hit('login', $request->ip() . "\0" . $identity, 8, 900);
        $this->turnstile->verify($body['turnstileToken'], 'login', $request);
        $statement = $this->db->prepare('SELECT * FROM users WHERE (email=? OR LOWER(pseudo)=?) AND deletion_requested_at IS NULL LIMIT 1');
        $statement->execute([$identity, $identity]);
        $user = $statement->fetch();
        if (!$user || !password_verify((string) $body['password'], $user['password_hash'])) {
            password_verify((string) $body['password'], '$2y$10$5R8vDgEt3M9X4L8Wzx5LpewFpyi6L5RY84AetjK6Hj.1YtYgI3p9C');
            throw new HttpException(401, 'invalid_credentials', 'Identifiants invalides.');
        }
        if ($user['email_verified_at'] === null) {
            throw new HttpException(403, 'email_unverified', 'Vérifie ton email avant de te connecter.');
        }
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        if (password_needs_rehash($user['password_hash'], $algorithm)) {
            $rehash = $this->db->prepare('UPDATE users SET password_hash=? WHERE id=?');
            $rehash->execute([password_hash((string) $body['password'], $algorithm), $user['id']]);
        }
        $session = $this->sessions->create($user['id'], $request);
        $this->audit->write($request->requestId, $user['id'], 'auth.login', 'user', $user['id']);
        Response::json(['authenticated' => true, 'csrfToken' => $session['csrfToken'], 'user' => $this->publicUser($user)]);
    }

    public function logout(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->sessions->destroy($session);
        $this->audit->write($request->requestId, $session['id'], 'auth.logout', 'user', $session['id']);
        Response::noContent();
    }

    public function forgotPassword(Request $request): never
    {
        $body = $request->json();
        Validator::keys($body, ['email','turnstileToken'], ['email','turnstileToken']);
        $email = Validator::email($body['email']);
        $this->limits->hit('forgot_password', $request->ip() . "\0" . $email, 4, 3600);
        $this->turnstile->verify($body['turnstileToken'], 'forgot_password', $request);
        $statement = $this->db->prepare('SELECT id FROM users WHERE email=? AND deletion_requested_at IS NULL LIMIT 1');
        $statement->execute([$email]);
        $userId = $statement->fetchColumn();
        if (is_string($userId)) {
            $token = Support::token();
            $this->db->prepare('UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL')->execute([$userId]);
            $this->db->prepare('INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,UTC_TIMESTAMP()+INTERVAL 30 MINUTE)')
                ->execute([Support::uuid(), $userId, Support::tokenHash($token)]);
            $link = $this->config->get('APP_ORIGIN') . '/compte/?reset=' . $token;
            $this->mailer->send($email, 'Réinitialise ton mot de passe F.A.T.', "Ce lien expire dans 30 minutes :\n{$link}\n");
        }
        Response::json(['accepted' => true, 'message' => 'Si ce compte existe, un email a été envoyé.'], 202);
    }

    public function resetPassword(Request $request): never
    {
        $body = $request->json();
        Validator::keys($body, ['token','password'], ['token','password']);
        $this->limits->hit('reset_password', $request->ip(), 6, 3600);
        $token = (string) $body['token'];
        $password = Validator::password($body['password']);
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw new HttpException(422, 'token', 'Jeton invalide.');
        }
        $this->db->beginTransaction();
        $select = $this->db->prepare('SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE');
        $select->execute([Support::tokenHash($token)]);
        $row = $select->fetch();
        if (!$row) {
            $this->db->rollBack();
            throw new HttpException(422, 'token', 'Jeton invalide ou expiré.');
        }
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        $this->db->prepare('UPDATE users SET password_hash=?,version=version+1 WHERE id=?')->execute([password_hash($password, $algorithm), $row['user_id']]);
        $this->db->prepare('UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE id=?')->execute([$row['id']]);
        $this->db->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$row['user_id']]);
        $this->db->commit();
        $this->audit->write($request->requestId, $row['user_id'], 'auth.reset_password', 'user', $row['user_id']);
        Response::json(['reset' => true]);
    }

    public function turnstileConfig(): never
    {
        Response::json(['turnstile' => $this->turnstile->publicConfig()]);
    }

    /** @param array<string,mixed> $user @return array<string,mixed> */
    private function publicUser(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'pseudo' => $user['pseudo'],
            'role' => $user['role'],
            'verified' => $user['email_verified_at'] !== null,
            'version' => (int) $user['version'],
        ];
    }
}
