<?php
declare(strict_types=1);

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Services\TurnstileVerifier;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

function configureTurnstile(bool $enabled = true, string $environment = 'local', bool $acceptTestKeys = false): Config
{
    global $root;
    $values = [
        'FAT_CONFIG_FILE' => $root . '/tests/fixtures/absent-turnstile.env',
        'APP_ENV' => $environment,
        'APP_ORIGIN' => 'http://127.0.0.1:8082',
        'APP_KEY' => str_repeat('a1', 32),
        'DB_DSN' => 'sqlite::memory:',
        'DB_USER' => 'test',
        'DB_PASSWORD' => 'test',
        'STORAGE_ROOT' => $root . '/storage',
        'TURNSTILE_ENABLED' => $enabled ? 'true' : 'false',
        'TURNSTILE_SITE_KEY' => '1x00000000000000000000AA',
        'TURNSTILE_SECRET_KEY' => '1x0000000000000000000000000000000AA',
        'TURNSTILE_EXPECTED_HOSTNAME' => '127.0.0.1',
        'TURNSTILE_TIMEOUT_SECONDS' => '4',
        'TURNSTILE_ACCEPT_TEST_KEYS' => $acceptTestKeys ? 'true' : 'false',
    ];
    foreach ($values as $key => $value) {
        putenv("{$key}={$value}");
    }
    return Config::load($root);
}

function turnstileRequest(): Request
{
    return new Request('POST', '/auth/login', [], '{}', ['REMOTE_ADDR' => '127.0.0.1'], [], 'turnstile-test');
}

/** @param callable():void $callback */
function expectTurnstileError(string $code, int $status, callable $callback): void
{
    try {
        $callback();
    } catch (HttpException $error) {
        if ($error->errorCode !== $code || $error->status !== $status) {
            throw new RuntimeException("Erreur inattendue: {$error->status}/{$error->errorCode}");
        }
        return;
    }
    throw new RuntimeException("Erreur attendue absente: {$code}");
}

function validTurnstileResult(string $action = 'login', string $hostname = '127.0.0.1', ?string $timestamp = null): array
{
    return [
        'success' => true,
        'hostname' => $hostname,
        'action' => $action,
        'challenge_ts' => $timestamp ?? gmdate(DATE_ATOM),
    ];
}

$config = configureTurnstile();
$request = turnstileRequest();
$captured = [];
$verifier = new TurnstileVerifier($config, function (array $payload, int $timeout) use (&$captured): array {
    $captured = ['payload' => $payload, 'timeout' => $timeout];
    return validTurnstileResult();
});
$verifier->verify('valid-token', 'login', $request);
if (($captured['payload']['response'] ?? '') !== 'valid-token'
    || ($captured['payload']['remoteip'] ?? '') !== '127.0.0.1'
    || !isset($captured['payload']['idempotency_key'])
    || ($captured['timeout'] ?? 0) !== 4) {
    throw new RuntimeException('Payload Siteverify incomplet.');
}

expectTurnstileError('turnstile_required', 422, fn() => $verifier->verify('', 'login', $request));
expectTurnstileError('turnstile_invalid', 422, fn() => (new TurnstileVerifier($config, fn(): array => validTurnstileResult('register')))->verify('token', 'login', $request));
expectTurnstileError('turnstile_invalid', 422, fn() => (new TurnstileVerifier($config, fn(): array => validTurnstileResult('login', 'example.test')))->verify('token', 'login', $request));
expectTurnstileError('turnstile_invalid', 422, fn() => (new TurnstileVerifier($config, fn(): array => validTurnstileResult('login', '127.0.0.1', gmdate(DATE_ATOM, time() - 400))))->verify('token', 'login', $request));
expectTurnstileError('turnstile_invalid', 422, fn() => (new TurnstileVerifier($config, fn(): array => ['success' => false]))->verify('token', 'login', $request));
expectTurnstileError('turnstile_unavailable', 503, fn() => (new TurnstileVerifier($config, function (): never { throw new RuntimeException('offline'); }))->verify('token', 'login', $request));

$testKeyConfig = configureTurnstile(true, 'local', true);
$testKeyResult = [
    'success' => true,
    'challenge_ts' => gmdate(DATE_ATOM),
    'hostname' => 'example.com',
    'metadata' => ['result_with_testing_key' => true],
];
(new TurnstileVerifier($testKeyConfig, fn(): array => $testKeyResult))->verify('testing-token', 'radar_publish', $request);

$calls = 0;
$singleUse = new TurnstileVerifier($config, function () use (&$calls): array {
    $calls += 1;
    return $calls === 1 ? validTurnstileResult() : ['success' => false, 'error-codes' => ['timeout-or-duplicate']];
});
$singleUse->verify('single-use', 'login', $request);
expectTurnstileError('turnstile_invalid', 422, fn() => $singleUse->verify('single-use', 'login', $request));

$disabled = configureTurnstile(false);
expectTurnstileError('turnstile_unavailable', 503, fn() => (new TurnstileVerifier($disabled, fn(): array => validTurnstileResult()))->verify('token', 'login', $request));

try {
    configureTurnstile(true, 'production');
    throw new RuntimeException('Les clés de test Turnstile ont été acceptées en production.');
} catch (RuntimeException $error) {
    if (!str_contains($error->getMessage(), 'clés de test Turnstile')) {
        throw $error;
    }
}

fwrite(STDOUT, "Turnstile PHP: succès, absence, expiration, rejeu, hostname, action et indisponibilité validés.\n");
