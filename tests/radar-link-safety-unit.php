<?php
declare(strict_types=1);

require dirname(__DIR__) . '/api/src/autoload.php';

use Fat\Api\HttpException;
use Fat\Api\Services\RadarLinkSafety;

$safety = new RadarLinkSafety();
$safe = [
    ['organizer', 'https://association-airsoft.example.org/evenements/operation-aube'],
    ['registration', 'https://www.helloasso.com/associations/equipe-airsoft/evenements/operation-aube'],
    ['website', 'https://association.example.org/parties/operation-aube'],
    ['facebook', 'https://www.facebook.com/events/123456789'],
    ['helloasso', 'https://www.helloasso.com/associations/equipe-airsoft'],
    ['discord', 'https://discord.gg/airsoftfrance'],
    ['instagram', 'https://www.instagram.com/equipe_airsoft/'],
];
foreach ($safe as [$type, $url]) {
    $safety->assertAllowed($type, $url);
}

$dangerous = [
    ['website', 'http://association.example.org/partie'],
    ['website', 'https://user:password@association.example.org/partie'],
    ['website', 'https://127.0.0.1/partie'],
    ['website', 'https://192.168.1.20/partie'],
    ['website', 'https://localhost/partie'],
    ['website', 'https://organisateur.internal/partie'],
    ['website', 'https://association.example.org:8443/partie'],
    ['website', 'https://éxample.org/partie'],
    ['website', 'https://xn--exmple-cua.org/partie'],
    ['website', 'https://bit.ly/operation-aube'],
    ['website', 'https://casino.example.org/operation-aube'],
    ['website', 'https://association.example.org/crypto/operation-aube'],
    ['website', 'https://amazon.fr/product/operation-aube'],
    ['website', 'https://association.example.org/boutique/operation-aube'],
    ['website', 'https://association.example.org/partie?affiliate=123'],
    ['facebook', 'https://fake-facebook.example.org/events/123'],
    ['helloasso', 'https://example.org/helloasso/operation-aube'],
    ['discord', 'https://example.org/invitation-discord'],
    ['instagram', 'https://example.org/instagram/equipe-airsoft'],
];
foreach ($dangerous as [$type, $url]) {
    try {
        $safety->assertAllowed($type, $url);
        throw new RuntimeException("Lien dangereux accepté : {$url}");
    } catch (HttpException $error) {
        if (
            $error->status !== 422
            || $error->errorCode !== 'radar_link_rejected'
            || $error->getMessage() !== RadarLinkSafety::REJECTION_MESSAGE
        ) {
            throw $error;
        }
    }
}

echo "RadarLinkSafety " . RadarLinkSafety::POLICY_VERSION . " : cas sûrs et dangereux validés.\n";
