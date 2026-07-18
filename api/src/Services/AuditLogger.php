<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use PDO;

final class AuditLogger
{
    public function __construct(private readonly PDO $db)
    {
    }

    /** @param array<string,string|int|float|bool|null> $metadata */
    public function write(string $requestId, ?string $userId, string $action, ?string $resourceType = null, ?string $resourceId = null, array $metadata = []): void
    {
        $statement = $this->db->prepare('INSERT INTO audit_log (request_id,user_id,action,resource_type,resource_id,metadata_json) VALUES (?,?,?,?,?,?)');
        $statement->execute([$requestId, $userId, $action, $resourceType, $resourceId, $metadata ? json_encode($metadata, JSON_THROW_ON_ERROR) : null]);
    }
}
