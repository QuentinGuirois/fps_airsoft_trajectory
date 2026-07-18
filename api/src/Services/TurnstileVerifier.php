<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Support;

final class TurnstileVerifier
{
    private const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    /** @var \Closure(array<string,string>,int):array<string,mixed> */
    private readonly \Closure $transport;

    /** @param (\Closure(array<string,string>,int):array<string,mixed>)|null $transport */
    public function __construct(private readonly Config $config, ?\Closure $transport = null)
    {
        $this->transport = $transport ?? fn(array $payload, int $timeout): array => $this->post($payload, $timeout);
    }

    /** @return array{enabled:bool,siteKey:string} */
    public function publicConfig(): array
    {
        $enabled = $this->config->bool('TURNSTILE_ENABLED');
        return [
            'enabled' => $enabled,
            'siteKey' => $enabled ? $this->config->get('TURNSTILE_SITE_KEY') : '',
        ];
    }

    public function verify(mixed $tokenValue, string $expectedAction, Request $request): void
    {
        if (!$this->config->bool('TURNSTILE_ENABLED')) {
            throw new HttpException(503, 'turnstile_unavailable', 'La vérification anti-robot est temporairement indisponible.');
        }
        if (!preg_match('/^[a-z0-9_]{1,32}$/', $expectedAction)) {
            throw new \LogicException('Action Turnstile invalide.');
        }

        $token = trim((string) $tokenValue);
        if ($token === '' || strlen($token) > 2048) {
            throw new HttpException(422, 'turnstile_required', 'Termine la vérification anti-robot puis réessaie.');
        }

        try {
            $result = ($this->transport)([
                'secret' => $this->config->get('TURNSTILE_SECRET_KEY'),
                'response' => $token,
                'remoteip' => $request->ip(),
                'idempotency_key' => Support::uuid(),
            ], min(8, max(2, $this->config->int('TURNSTILE_TIMEOUT_SECONDS', 4))));
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            throw new HttpException(503, 'turnstile_unavailable', 'La vérification anti-robot est temporairement indisponible.');
        }

        $success = ($result['success'] ?? false) === true;
        $hostname = strtolower(trim((string) ($result['hostname'] ?? '')));
        $action = (string) ($result['action'] ?? '');
        $challengeTime = strtotime((string) ($result['challenge_ts'] ?? ''));
        $now = time();
        $fresh = $challengeTime !== false && $challengeTime >= $now - 330 && $challengeTime <= $now + 30;
        $expectedHostname = strtolower($this->config->get('TURNSTILE_EXPECTED_HOSTNAME'));

        if (!$success || !$fresh || !hash_equals($expectedHostname, $hostname) || !hash_equals($expectedAction, $action)) {
            throw new HttpException(422, 'turnstile_invalid', 'La vérification anti-robot a expiré ou n’est pas valide. Recommence le contrôle.');
        }
    }

    /** @param array<string,string> $payload @return array<string,mixed> */
    private function post(array $payload, int $timeout): array
    {
        $url = $this->config->get('TURNSTILE_SITEVERIFY_URL', self::SITEVERIFY_URL);
        if ($this->config->isProduction() && !hash_equals(self::SITEVERIFY_URL, $url)) {
            throw new \RuntimeException('URL Siteverify non officielle en production.');
        }
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json\r\n",
            'content' => http_build_query($payload, '', '&', PHP_QUERY_RFC3986),
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $context);
        $statusLine = $http_response_header[0] ?? '';
        if ($raw === false || !preg_match('/\s2\d\d\s/', $statusLine)) {
            throw new \RuntimeException('Siteverify indisponible.');
        }
        try {
            $decoded = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \RuntimeException('Réponse Siteverify invalide.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new \RuntimeException('Réponse Siteverify invalide.');
        }
        return $decoded;
    }
}
