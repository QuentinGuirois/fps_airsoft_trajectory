<?php
declare(strict_types=1);

namespace Fat\Api;

final class Request
{
    /** @param array<string,string> $headers @param array<string,mixed> $server @param array<string,mixed> $files */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $headers,
        public readonly string $rawBody,
        public readonly array $server,
        public readonly array $files,
        public readonly string $requestId,
    ) {
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach (getallheaders() ?: [] as $name => $value) {
            $headers[strtolower((string) $name)] = (string) $value;
        }
        $uri = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
        $prefix = '/api/v1';
        $path = str_starts_with($uri, $prefix) ? substr($uri, strlen($prefix)) : $uri;
        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            '/' . ltrim((string) $path, '/'),
            $headers,
            (string) file_get_contents('php://input'),
            $_SERVER,
            $_FILES,
            bin2hex(random_bytes(12)),
        );
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        $contentType = strtolower(explode(';', $this->headers['content-type'] ?? '')[0]);
        if ($contentType !== 'application/json') {
            throw new HttpException(415, 'content_type', 'Le corps doit être envoyé en JSON.');
        }
        try {
            $shape = json_decode($this->rawBody, false, 32, JSON_THROW_ON_ERROR);
            $value = json_decode($this->rawBody, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpException(400, 'invalid_json', 'Le JSON est invalide.');
        }
        if (!is_object($shape) || !is_array($value)) {
            throw new HttpException(400, 'invalid_json', 'Un objet JSON est attendu.');
        }
        return $value;
    }

    public function header(string $name): string
    {
        return $this->headers[strtolower($name)] ?? '';
    }

    /** @return array<string,string> */
    public function query(): array
    {
        $values = [];
        parse_str((string) ($this->server['QUERY_STRING'] ?? ''), $values);
        return array_filter($values, static fn(mixed $value): bool => is_string($value));
    }

    public function ip(): string
    {
        return (string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0');
    }
}
