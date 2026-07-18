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
        foreach (['APP_ENV','APP_ORIGIN','APP_KEY','DB_DSN','DB_USER','DB_PASSWORD','STORAGE_ROOT'] as $required) {
            if (!isset($values[$required]) || $values[$required] === '') {
                throw new \RuntimeException("Configuration manquante: {$required}");
            }
        }
        if (!preg_match('/^[a-f0-9]{64,}$/i', $values['APP_KEY'])) {
            throw new \RuntimeException('APP_KEY doit contenir au moins 256 bits hexadécimaux.');
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
