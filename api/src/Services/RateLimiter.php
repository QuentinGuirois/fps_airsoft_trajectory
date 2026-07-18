<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use Fat\Api\HttpException;
use PDO;

final class RateLimiter
{
    public function __construct(private readonly PDO $db, private readonly Config $config)
    {
    }

    public function hit(string $scope, string $identifier, int $limit, int $windowSeconds): void
    {
        $window = intdiv(time(), $windowSeconds) * $windowSeconds;
        $start = gmdate('Y-m-d H:i:s', $window);
        $expiry = gmdate('Y-m-d H:i:s', $window + $windowSeconds + 60);
        $key = hash_hmac('sha256', $scope . "\0" . $identifier, $this->config->get('APP_KEY'), true);
        $statement = $this->db->prepare(
            'INSERT INTO rate_limits (scope,key_hash,window_start,attempt_count,expires_at) VALUES (?,?,?,?,?) '
            . 'ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1, expires_at = VALUES(expires_at)'
        );
        $statement->execute([$scope, $key, $start, 1, $expiry]);
        $read = $this->db->prepare('SELECT attempt_count FROM rate_limits WHERE scope=? AND key_hash=? AND window_start=?');
        $read->execute([$scope, $key, $start]);
        if ((int) $read->fetchColumn() > $limit) {
            throw new HttpException(429, 'rate_limited', 'Trop de tentatives. Réessaie plus tard.');
        }
    }
}
