<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;

final class SensitiveData
{
    private const VERSION = "\x01";
    private const AAD = 'fat-radar-contact-v1';

    public function __construct(private readonly Config $config)
    {
    }

    public function encrypt(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $value,
            'aes-256-gcm',
            $this->key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            self::AAD,
            16,
        );
        if (!is_string($ciphertext) || strlen($tag) !== 16) {
            throw new \RuntimeException('Chiffrement de la donnée sensible impossible.');
        }
        return self::VERSION . $iv . $tag . $ciphertext;
    }

    public function decrypt(?string $payload): ?string
    {
        if ($payload === null || $payload === '') {
            return null;
        }
        if (strlen($payload) < 30 || $payload[0] !== self::VERSION) {
            throw new \RuntimeException('Donnée sensible invalide.');
        }
        $value = openssl_decrypt(
            substr($payload, 29),
            'aes-256-gcm',
            $this->key(),
            OPENSSL_RAW_DATA,
            substr($payload, 1, 12),
            substr($payload, 13, 16),
            self::AAD,
        );
        if (!is_string($value)) {
            throw new \RuntimeException('Déchiffrement de la donnée sensible impossible.');
        }
        return $value;
    }

    private function key(): string
    {
        $key = hex2bin(substr($this->config->get('APP_KEY'), 0, 64));
        if (!is_string($key) || strlen($key) !== 32) {
            throw new \RuntimeException('APP_KEY ne permet pas le chiffrement.');
        }
        return $key;
    }
}
