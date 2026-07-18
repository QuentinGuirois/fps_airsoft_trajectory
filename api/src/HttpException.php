<?php
declare(strict_types=1);

namespace Fat\Api;

final class HttpException extends \RuntimeException
{
    /** @param array<string,mixed>|null $details */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly ?array $details = null,
    ) {
        parent::__construct($message);
    }
}
