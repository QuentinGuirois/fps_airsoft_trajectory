<?php
declare(strict_types=1);

namespace Fat\Api\Middleware;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;

final class Security
{
    public static function headers(Config $config): void
    {
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
        header('X-Frame-Options: DENY');
        if ($config->isProduction() && str_starts_with($config->get('APP_ORIGIN'), 'https://')) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }
    }

    public static function validateRequest(Request $request, Config $config): void
    {
        $origin = rtrim($config->get('APP_ORIGIN'), '/');
        $originParts = parse_url($origin);
        $expectedHost = strtolower((string) ($originParts['host'] ?? ''));
        $expectedPort = $originParts['port'] ?? null;
        if ($expectedPort !== null) {
            $expectedHost .= ':' . $expectedPort;
        }
        $trustedHost = strtolower($config->get('TRUSTED_HOST', $expectedHost));
        $host = strtolower(preg_replace('/\s+/', '', $request->header('host')) ?? '');
        if ($host === '' || !hash_equals($trustedHost, $host)) {
            throw new HttpException(400, 'invalid_host', 'Hôte de requête invalide.');
        }
        if (in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }
        $requestOrigin = rtrim($request->header('origin'), '/');
        if ($requestOrigin === '' || !hash_equals($origin, $requestOrigin)) {
            throw new HttpException(403, 'invalid_origin', 'Origine de requête invalide.');
        }
    }
}
