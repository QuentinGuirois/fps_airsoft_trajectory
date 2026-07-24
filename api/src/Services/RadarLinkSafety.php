<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\HttpException;

final class RadarLinkSafety
{
    public const POLICY_VERSION = '2026-07-24.1';
    public const REJECTION_MESSAGE = 'Ce lien externe n’est pas accepté pour une partie. Utilise un lien organisateur, inscription ou réseau social officiel.';

    private const SHORTENERS = [
        'bit.ly', 'buff.ly', 'cutt.ly', 'is.gd', 'lnkd.in', 'rebrand.ly', 'shorturl.at',
        't.co', 'tiny.cc', 'tinyurl.com', 'urlz.fr', 'rb.gy',
    ];

    private const RESERVED_HOST_SUFFIXES = [
        '.example', '.home', '.internal', '.invalid', '.lan', '.local', '.localhost', '.onion', '.test',
    ];

    private const BLOCKED_HOST_TOKENS = [
        'adult', 'casino', 'credit', 'crypto', 'cryptocurrency', 'escort', 'gambling',
        'loan', 'malware', 'payday', 'phishing', 'porn', 'porno', 'pret', 'sexcam',
        'sportsbook', 'viagra', 'xxx',
    ];

    private const BLOCKED_PATH_SEGMENTS = [
        'adult', 'bet', 'casino', 'credit', 'crypto', 'escort', 'gambling', 'loan',
        'malware', 'payday', 'phishing', 'porno', 'porn', 'pret', 'sportsbook', 'xxx',
    ];

    private const MERCHANT_HOSTS = [
        'aliexpress.com', 'amazon.com', 'amazon.fr', 'cdiscount.com', 'ebay.com',
        'ebay.fr', 'etsy.com', 'fnac.com', 'rakuten.com', 'shopify.com', 'temu.com',
    ];

    private const MERCHANT_PATH_SEGMENTS = [
        'affiliate', 'affiliation', 'boutique', 'cart', 'checkout', 'code-promo',
        'coupon', 'marketplace', 'panier', 'product', 'produit', 'promo', 'shop', 'store',
    ];

    private const SOCIAL_HOSTS = [
        'facebook' => ['facebook.com', 'fb.com'],
        'helloasso' => ['helloasso.com'],
        'instagram' => ['instagram.com'],
        'discord' => ['discord.com', 'discord.gg'],
    ];

    /** @param list<array{type:string,url:string}> $links */
    public function assertEventLinks(?string $registrationUrl, array $links): void
    {
        if ($registrationUrl !== null) {
            $this->assertAllowed('registration', $registrationUrl);
        }
        foreach ($links as $link) {
            $this->assertAllowed($link['type'], $link['url']);
        }
    }

    public function assertAllowed(string $type, string $url): void
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            $this->reject();
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $port = $parts['port'] ?? null;
        if (
            $scheme !== 'https'
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || ($port !== null && (int) $port !== 443)
            || $host === 'localhost'
            || str_ends_with($host, '.localhost')
            || $this->endsWithAny($host, self::RESERVED_HOST_SUFFIXES)
            || filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) !== false
            || preg_match('/[^\x21-\x7E]/', $host)
            || preg_match('/(^|\.)xn--/i', $host)
        ) {
            $this->reject();
        }

        if ($this->hostMatchesAny($host, self::SHORTENERS)) {
            $this->reject();
        }
        if (isset(self::SOCIAL_HOSTS[$type]) && !$this->hostMatchesAny($host, self::SOCIAL_HOSTS[$type])) {
            $this->reject();
        }

        $hostTokens = preg_split('/[^a-z0-9]+/', $host) ?: [];
        if (array_intersect($hostTokens, self::BLOCKED_HOST_TOKENS)) {
            $this->reject();
        }
        if (array_intersect($hostTokens, self::MERCHANT_PATH_SEGMENTS)) {
            $this->reject();
        }
        if ($this->hostMatchesAny($host, self::MERCHANT_HOSTS)) {
            $this->reject();
        }

        $path = strtolower(rawurldecode((string) ($parts['path'] ?? '')));
        $segments = array_values(array_filter(preg_split('#[/._-]+#', $path) ?: []));
        if (array_intersect($segments, self::BLOCKED_PATH_SEGMENTS)) {
            $this->reject();
        }
        if (array_intersect($segments, self::MERCHANT_PATH_SEGMENTS)) {
            $this->reject();
        }

        parse_str((string) ($parts['query'] ?? ''), $query);
        $queryKeys = array_map('strtolower', array_keys($query));
        if (array_intersect($queryKeys, ['aff', 'affiliate', 'affiliation', 'coupon', 'promo', 'promocode'])) {
            $this->reject();
        }
    }

    /** @param list<string> $domains */
    private function hostMatchesAny(string $host, array $domains): bool
    {
        foreach ($domains as $domain) {
            if ($host === $domain || str_ends_with($host, '.' . $domain)) {
                return true;
            }
        }
        return false;
    }

    /** @param list<string> $suffixes */
    private function endsWithAny(string $host, array $suffixes): bool
    {
        foreach ($suffixes as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return true;
            }
        }
        return false;
    }

    private function reject(): never
    {
        throw new HttpException(422, 'radar_link_rejected', self::REJECTION_MESSAGE);
    }
}
