<?php
declare(strict_types=1);

namespace Fat\Api;

use Fat\Api\Controllers\AdminController;
use Fat\Api\Controllers\AuthController;
use Fat\Api\Controllers\ReplicaController;
use Fat\Api\Controllers\UserController;
use Fat\Api\Middleware\Security;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\MailerFactory;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SessionService;
use Fat\Api\Services\UploadService;
use PDO;

final class Application
{
    public function __construct(private readonly Config $config, private readonly PDO $db)
    {
    }

    public function run(Request $request): never
    {
        Security::headers($this->config);
        try {
            Security::validateRequest($request, $this->config);
            $this->router()->dispatch($request);
            throw new HttpException(500, 'invalid_handler', 'Réponse invalide.');
        } catch (HttpException $error) {
            $payload = ['code' => $error->errorCode, 'message' => $error->getMessage(), 'requestId' => $request->requestId];
            if ($error->details !== null) {
                $payload['errors'] = $error->details;
            }
            Response::json($payload, $error->status);
        } catch (\Throwable $error) {
            error_log('FAT API ' . $request->requestId . ' ' . get_class($error));
            $payload = [
                'code' => 'internal_error',
                'message' => $this->config->isProduction() ? 'Une erreur interne est survenue.' : $error->getMessage(),
                'requestId' => $request->requestId,
            ];
            Response::json($payload, 500);
        }
    }

    private function router(): Router
    {
        $sessions = new SessionService($this->db, $this->config);
        $limits = new RateLimiter($this->db, $this->config);
        $audit = new AuditLogger($this->db);
        $auth = new AuthController($this->db, $this->config, $sessions, $limits, $audit, MailerFactory::create($this->config));
        $user = new UserController($this->db, $this->config, $sessions, $audit);
        $replicas = new ReplicaController($this->db, $this->config, $sessions, $limits, $audit, new UploadService($this->db, $this->config));
        $admin = new AdminController($this->db, $sessions, $limits, $audit);
        $router = new Router();
        $router->add('GET', '/health', static fn(): never => Response::json(['status' => 'ok']));
        $router->add('POST', '/auth/register', [$auth, 'register']);
        $router->add('POST', '/auth/verify-email', [$auth, 'verifyEmail']);
        $router->add('POST', '/auth/login', [$auth, 'login']);
        $router->add('POST', '/auth/logout', [$auth, 'logout']);
        $router->add('POST', '/auth/forgot-password', [$auth, 'forgotPassword']);
        $router->add('POST', '/auth/reset-password', [$auth, 'resetPassword']);
        $router->add('GET', '/me', [$user, 'me']);
        $router->add('PATCH', '/me', [$user, 'update']);
        $router->add('POST', '/me/export', [$user, 'export']);
        $router->add('DELETE', '/me', [$user, 'requestDeletion']);
        $router->add('GET', '/replicas', [$replicas, 'list']);
        $router->add('POST', '/replicas', [$replicas, 'create']);
        $router->add('GET', '/replicas/{id}', [$replicas, 'get']);
        $router->add('PATCH', '/replicas/{id}', [$replicas, 'update']);
        $router->add('DELETE', '/replicas/{id}', [$replicas, 'archive']);
        $router->add('POST', '/replicas/{id}/photo', [$replicas, 'uploadPhoto']);
        $router->add('GET', '/replicas/{id}/processing-status', [$replicas, 'processingStatus']);
        $router->add('POST', '/replicas/{id}/submit', [$replicas, 'submit']);
        $router->add('GET', '/replicas/{id}/image.webp', [$replicas, 'image']);
        $router->add('GET', '/admin/replicas', [$admin, 'list']);
        $router->add('POST', '/admin/replicas/{id}/publish', [$admin, 'publish']);
        $router->add('POST', '/admin/replicas/{id}/reject', [$admin, 'reject']);
        return $router;
    }
}
