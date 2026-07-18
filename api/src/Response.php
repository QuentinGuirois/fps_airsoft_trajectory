<?php
declare(strict_types=1);

namespace Fat\Api;

final class Response
{
    /** @param array<string,mixed> $payload */
    public static function json(array $payload, int $status = 200, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, private, max-age=0');
        header('Pragma: no-cache');
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function noContent(int $status = 204): never
    {
        http_response_code($status);
        header('Cache-Control: no-store, private, max-age=0');
        exit;
    }

    public static function webp(string $path): never
    {
        if (!is_file($path)) {
            throw new HttpException(404, 'image_not_found', 'Image indisponible.');
        }
        http_response_code(200);
        header('Content-Type: image/webp');
        header('Content-Length: ' . (string) filesize($path));
        header('Cache-Control: private, no-store, max-age=0');
        readfile($path);
        exit;
    }
}
