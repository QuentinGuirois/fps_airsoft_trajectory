<?php
declare(strict_types=1);

namespace Fat\Api;

final class Config
{
    /** @param array<string,string> $values */
    private function __construct(private readonly array $values, public readonly string $projectRoot)
    {
    }

    public static function load(string $projectRoot): self
    {
        $values = [];
        $outsideDefault = dirname($projectRoot) . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'fat.env';
        $configFile = getenv('FAT_CONFIG_FILE') ?: $outsideDefault;
        if (is_file($configFile)) {
            foreach (file($configFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $trimmed = trim($line);
                if ($trimmed === '' || str_starts_with($trimmed, '#')) {
                    continue;
                }
                [$key, $value] = array_pad(explode('=', $trimmed, 2), 2, '');
                if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) {
                    throw new \RuntimeException('Clé de configuration invalide.');
                }
                $values[$key] = self::unquote(trim($value));
            }
        }
        $environment = getenv();
        foreach (array_keys(is_array($environment) ? $environment : ($_ENV + $_SERVER)) as $key) {
            if (is_string($key) && preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) {
                $value = getenv($key);
                if ($value !== false) {
                    $values[$key] = $value;
                }
            }
        }
        foreach (['APP_ENV','APP_ORIGIN','APP_KEY','DB_DSN','DB_USER','DB_PASSWORD','STORAGE_ROOT','TURNSTILE_ENABLED'] as $required) {
            if (!isset($values[$required]) || $values[$required] === '') {
                throw new \RuntimeException("Configuration manquante: {$required}");
            }
        }
        if (!preg_match('/^[a-f0-9]{64,}$/i', $values['APP_KEY'])) {
            throw new \RuntimeException('APP_KEY doit contenir au moins 256 bits hexadécimaux.');
        }
        $turnstileEnabled = filter_var($values['TURNSTILE_ENABLED'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($turnstileEnabled === null) {
            throw new \RuntimeException('TURNSTILE_ENABLED doit être un booléen explicite.');
        }
        $acceptTurnstileTestKeys = filter_var($values['TURNSTILE_ACCEPT_TEST_KEYS'] ?? 'false', FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($acceptTurnstileTestKeys === null) {
            throw new \RuntimeException('TURNSTILE_ACCEPT_TEST_KEYS doit être un booléen explicite.');
        }
        if (($values['APP_ENV'] ?? '') === 'production' && $acceptTurnstileTestKeys) {
            throw new \RuntimeException('Le mode de recette Turnstile est interdit en production.');
        }
        if ($turnstileEnabled) {
            foreach (['TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_EXPECTED_HOSTNAME'] as $required) {
                if (!isset($values[$required]) || trim($values[$required]) === '') {
                    throw new \RuntimeException("Configuration Turnstile manquante: {$required}");
                }
            }
            if (!preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i', $values['TURNSTILE_EXPECTED_HOSTNAME'])) {
                throw new \RuntimeException('TURNSTILE_EXPECTED_HOSTNAME invalide.');
            }
            if (($values['APP_ENV'] ?? '') === 'production') {
                $testKeys = [
                    '1x00000000000000000000AA', '2x00000000000000000000AB',
                    '1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA',
                    '3x0000000000000000000000000000000AA',
                ];
                if (in_array($values['TURNSTILE_SITE_KEY'], $testKeys, true) || in_array($values['TURNSTILE_SECRET_KEY'], $testKeys, true)) {
                    throw new \RuntimeException('Les clés de test Turnstile sont interdites en production.');
                }
            }
        }
        return new self($values, $projectRoot);
    }

    private static function unquote(string $value): string
    {
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            return substr($value, 1, -1);
        }
        return $value;
    }

    public function get(string $key, ?string $default = null): string
    {
        if (array_key_exists($key, $this->values)) {
            return $this->values[$key];
        }
        if ($default !== null) {
            return $default;
        }
        throw new \RuntimeException("Configuration manquante: {$key}");
    }

    public function int(string $key, int $default): int
    {
        $value = filter_var($this->get($key, (string) $default), FILTER_VALIDATE_INT);
        if ($value === false) {
            throw new \RuntimeException("Configuration entière invalide: {$key}");
        }
        return $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = filter_var($this->get($key, $default ? 'true' : 'false'), FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($value === null) {
            throw new \RuntimeException("Configuration booléenne invalide: {$key}");
        }
        return $value;
    }

    public function isProduction(): bool
    {
        return $this->get('APP_ENV') === 'production';
    }

    public function storagePath(string $suffix = ''): string
    {
        $root = $this->get('STORAGE_ROOT');
        if (!preg_match('/^(?:[A-Za-z]:[\\\\\/]|\/)/', $root)) {
            $root = $this->projectRoot . DIRECTORY_SEPARATOR . $root;
        }
        return rtrim($root, DIRECTORY_SEPARATOR) . ($suffix === '' ? '' : DIRECTORY_SEPARATOR . ltrim($suffix, DIRECTORY_SEPARATOR));
    }
}
