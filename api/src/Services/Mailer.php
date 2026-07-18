<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;

interface Mailer
{
    public function send(string $recipient, string $subject, string $body): void;
}

final class NativeMailer implements Mailer
{
    public function __construct(private readonly Config $config)
    {
    }

    public function send(string $recipient, string $subject, string $body): void
    {
        $from = $this->config->get('MAIL_FROM', 'noreply@fps-airsoft-trajectory.com');
        $headers = [
            'From: F.A.T. <' . $from . '>',
            'Content-Type: text/plain; charset=UTF-8',
            'X-Auto-Response-Suppress: All',
        ];
        if (!mail($recipient, $subject, $body, implode("\r\n", $headers))) {
            throw new \RuntimeException('Échec de remise au serveur de courrier.');
        }
    }
}

final class FileMailer implements Mailer
{
    public function __construct(private readonly Config $config)
    {
    }

    public function send(string $recipient, string $subject, string $body): void
    {
        if ($this->config->isProduction()) {
            throw new \RuntimeException('Le mailer de test est interdit en production.');
        }
        $directory = $this->config->storagePath('logs');
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new \RuntimeException('Impossible de créer le journal de mail local.');
        }
        $record = json_encode(['to' => $recipient, 'subject' => $subject, 'body' => $body], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
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
