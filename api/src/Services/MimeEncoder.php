<?php
declare(strict_types=1);

namespace Fat\Api\Services;

final class MimeEncoder
{
    public static function multipartAlternative(EmailMessage $message, string $boundary): string
    {
        if (!preg_match('/^[A-Za-z0-9._-]{16,70}$/', $boundary)) {
            throw new \InvalidArgumentException('Frontière MIME invalide.');
        }

        $parts = [
            '--' . $boundary,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            quoted_printable_encode(self::crlf($message->textBody)),
            '--' . $boundary,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            quoted_printable_encode(self::crlf($message->htmlBody)),
            '--' . $boundary . '--',
            '',
        ];

        return implode("\r\n", $parts);
    }

    private static function crlf(string $value): string
    {
        return preg_replace('/\r\n|\r|\n/', "\r\n", $value) ?? $value;
    }
}
