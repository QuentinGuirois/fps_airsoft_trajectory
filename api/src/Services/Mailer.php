<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;

interface Mailer
{
    public function send(string $recipient, EmailMessage $message): void;
}

final class NativeMailer implements Mailer
{
    public function __construct(private readonly Config $config)
    {
    }

    public function send(string $recipient, EmailMessage $message): void
    {
        $from = $this->config->get('MAIL_FROM', 'noreply@fps-airsoft-trajectory.com');
        $replyTo = $this->config->get('MAIL_REPLY_TO', 'contact@fps-airsoft-trajectory.com');
        self::assertMailbox($recipient, 'destinataire');
        self::assertMailbox($from, 'expéditeur');
        self::assertMailbox($replyTo, 'adresse de réponse');
        $boundary = 'fat_' . bin2hex(random_bytes(18));
        $host = parse_url($this->config->get('APP_ORIGIN'), PHP_URL_HOST);
        $messageHost = is_string($host) && preg_match('/^[A-Za-z0-9.-]+$/', $host) ? $host : 'fps-airsoft-trajectory.com';
        $headers = [
            'From: F.A.T. <' . $from . '>',
            'Reply-To: ' . $replyTo,
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
            'Date: ' . gmdate('D, d M Y H:i:s +0000'),
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $messageHost . '>',
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
        ];
        $subject = mb_encode_mimeheader($message->subject, 'UTF-8', 'B', "\r\n");
        $body = MimeEncoder::multipartAlternative($message, $boundary);
        // Align the envelope sender with the visible From domain for SPF/DMARC.
        // The value is safe here because assertMailbox() rejects CR/LF and non-email input.
        if (!mail($recipient, $subject, $body, implode("\r\n", $headers), '-f' . $from)) {
            throw new \RuntimeException('Échec de remise au serveur de courrier.');
        }
    }

    private static function assertMailbox(string $value, string $label): void
    {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $value)) {
            throw new \RuntimeException("Adresse {$label} invalide.");
        }
    }
}

final class FileMailer implements Mailer
{
    public function __construct(private readonly Config $config)
    {
    }

    public function send(string $recipient, EmailMessage $message): void
    {
        if ($this->config->isProduction()) {
            throw new \RuntimeException('Le mailer de test est interdit en production.');
        }
        $directory = $this->config->storagePath('logs');
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new \RuntimeException('Impossible de créer le journal de mail local.');
        }
        $record = json_encode([
            'to' => $recipient,
            'subject' => $message->subject,
            'body' => $message->textBody,
            'html' => $message->htmlBody,
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        file_put_contents($directory . DIRECTORY_SEPARATOR . 'mail-test.jsonl', $record . PHP_EOL, FILE_APPEND | LOCK_EX);
    }
}

final class MailerFactory
{
    public static function create(Config $config): Mailer
    {
        return $config->get('MAIL_MODE', $config->isProduction() ? 'native' : 'log') === 'native'
            ? new NativeMailer($config)
            : new FileMailer($config);
    }
}
