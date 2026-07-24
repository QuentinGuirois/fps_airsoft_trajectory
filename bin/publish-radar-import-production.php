<?php
declare(strict_types=1);

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Support;
use Fat\Api\Validation\RadarSeedValidator;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

const RADAR_PRODUCTION_SEED = 'fat-radar-events-enriched-2026-07-24.json';
const RADAR_PRODUCTION_SEED_SHA256 = 'a1d2d8773e032fca8c3b55506229bcdc9f53484136be44d1bb4951d1e76c52d7';
const RADAR_PRODUCTION_BATCH = 'fat-radar-seed-2026-07-24';

/** @return never */
function productionPublishFail(string $message, int $code = 2): never
{
    throw new RuntimeException($message, $code);
}

/** @return array{seed:string,mode:string,confirmation:string} */
function productionPublishOptions(array $arguments, string $root): array
{
    array_shift($arguments);
    $options = ['seed' => '', 'mode' => '', 'confirmation' => ''];
    foreach ($arguments as $argument) {
        if ($argument === '--preflight') {
            $options['mode'] = $options['mode'] === '' ? 'preflight' : 'invalid';
        } elseif ($argument === '--apply') {
            $options['mode'] = $options['mode'] === '' ? 'apply' : 'invalid';
        } elseif (str_starts_with($argument, '--confirm-sha256=')) {
            $options['confirmation'] = strtolower(substr($argument, strlen('--confirm-sha256=')));
        } elseif (!str_starts_with($argument, '-') && $options['seed'] === '') {
            $options['seed'] = $argument;
        } else {
            productionPublishFail("option inconnue « {$argument} ».");
        }
    }
    if ($options['seed'] === '' || !in_array($options['mode'], ['preflight', 'apply'], true)) {
        productionPublishFail('indique le lot, puis exactement --preflight ou --apply.');
    }
    if (!hash_equals(RADAR_PRODUCTION_SEED_SHA256, $options['confirmation'])) {
        productionPublishFail('la confirmation SHA-256 du lot est absente ou invalide.', 3);
    }

    $seed = realpath($options['seed']);
    $allowedDirectories = array_values(array_filter([
        realpath($root . '/docs/fat-radar'),
        realpath($root . '/database/seeds'),
    ], 'is_string'));
    if (
        $seed === false
        || !in_array(basename($seed), [RADAR_PRODUCTION_SEED, RADAR_PRODUCTION_SEED . '.php'], true)
        || !in_array(dirname($seed), $allowedDirectories, true)
    ) {
        productionPublishFail('le lot de production n’est pas le document Radar attendu.');
    }
    $seedContents = str_ends_with($seed, '.json.php') ? require $seed : file_get_contents($seed);
    $actualHash = is_string($seedContents) ? hash('sha256', $seedContents) : null;
    if ($actualHash === null || !hash_equals(RADAR_PRODUCTION_SEED_SHA256, strtolower($actualHash))) {
        productionPublishFail('l’empreinte du lot de production ne correspond pas.', 3);
    }
    $options['seed'] = $seed;
    return $options;
}

/** @return array<string,mixed> */
function productionPublishJson(string $path): array
{
    $raw = str_ends_with($path, '.json.php') ? require $path : file_get_contents($path);
    if (!is_string($raw) || strlen($raw) > 5_000_000) {
        productionPublishFail('le JSON de production est illisible ou trop volumineux.');
    }
    try {
        $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        productionPublishFail('le JSON de production est invalide.');
    }
    if (!is_array($decoded) || array_is_list($decoded)) {
        productionPublishFail('la racine JSON doit être un objet.');
    }
    return $decoded;
}

function productionIdentity(string $value): string
{
    $normalized = mb_strtolower(Support::normalizeText($value));
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $normalized);
    $normalized = is_string($ascii) ? $ascii : $normalized;
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $normalized) ?? $normalized);
}

/** @param array<string,mixed> $event */
function productionPlaceIdentity(array $event): string
{
    $postalCode = $event['postalCode'];
    return $postalCode !== null
        ? 'postal:' . $postalCode
        : 'city:' . productionIdentity((string) $event['city']);
}

/** @param list<array<string,mixed>> $events */
function assertProductionDataset(array $events): void
{
    if (count($events) !== 40) {
        productionPublishFail('le lot de production doit contenir exactement 40 événements.');
    }
    $signatures = [];
    $sourceDates = [];
    foreach ($events as $event) {
        if ($event['postalCode'] === null && $event['city'] === null) {
            productionPublishFail("{$event['externalKey']} : code postal ou ville obligatoire.");
        }
        if (!str_starts_with((string) $event['sourceUrl'], 'https://')) {
            productionPublishFail("{$event['externalKey']} : lien web HTTPS obligatoire.");
        }
        if (count($event['rules']) !== 7) {
            productionPublishFail("{$event['externalKey']} : matrice de règles incomplète.");
        }
        $date = substr((string) $event['startsAtUtc'], 0, 10);
        $signature = implode('|', [
            productionIdentity((string) $event['title']),
            productionIdentity((string) $event['organizer']),
            $date,
            productionPlaceIdentity($event),
        ]);
        if (isset($signatures[$signature])) {
            productionPublishFail(
                "{$event['externalKey']} : doublon interne avec {$signatures[$signature]}."
            );
        }
        $signatures[$signature] = $event['externalKey'];

        $sourceDate = strtolower(rtrim((string) $event['sourceUrl'], '/')) . '|' . $date;
        if (isset($sourceDates[$sourceDate])) {
            productionPublishFail(
                "{$event['externalKey']} : source et date déjà utilisées par {$sourceDates[$sourceDate]}."
            );
        }
        $sourceDates[$sourceDate] = $event['externalKey'];
    }
}

/**
 * Refuse un événement existant équivalent sous une autre clé externe.
 *
 * @param list<array<string,mixed>> $events
 */
function assertNoProductionDuplicates(PDO $db, array $events, bool $lock): void
{
    $candidateSql = "SELECT id,external_key,title,organizer_name,starts_at_utc,city,postal_code,import_batch_key "
        . "FROM radar_events WHERE state<>'deleted' AND DATE(starts_at_utc)=DATE(?) "
        . "AND ((? IS NOT NULL AND postal_code=?) OR (? IS NOT NULL AND city=?))";
    $sourceSql = "SELECT r.external_key FROM radar_event_sources s "
        . "JOIN radar_events r ON r.id=s.event_id "
        . "WHERE r.state<>'deleted' AND s.source_url=? AND DATE(r.starts_at_utc)=DATE(?) "
        . "AND (r.external_key IS NULL OR r.external_key<>?)";
    if ($lock) {
        $candidateSql .= ' FOR UPDATE';
        $sourceSql .= ' FOR UPDATE';
    }
    $candidates = $db->prepare($candidateSql);
    $sources = $db->prepare($sourceSql);
    $byExternalKey = $db->prepare(
        'SELECT id,external_key,import_batch_key FROM radar_events WHERE external_key=? LIMIT 2'
        . ($lock ? ' FOR UPDATE' : '')
    );

    foreach ($events as $event) {
        $key = (string) $event['externalKey'];
        $byExternalKey->execute([$key]);
        $sameKey = $byExternalKey->fetchAll();
        if (count($sameKey) > 1) {
            productionPublishFail("{$key} : plusieurs fiches utilisent la même clé externe.", 4);
        }
        if (
            count($sameKey) === 1
            && (string) ($sameKey[0]['import_batch_key'] ?? '') !== RADAR_PRODUCTION_BATCH
        ) {
            productionPublishFail("{$key} : collision avec une fiche étrangère au lot.", 4);
        }

        $city = $event['city'] === null ? null : (string) $event['city'];
        $postalCode = $event['postalCode'];
        $candidates->execute([
            $event['startsAtUtc'],
            $postalCode,
            $postalCode,
            $city,
            $city,
        ]);
        foreach ($candidates->fetchAll() as $candidate) {
            if ((string) ($candidate['external_key'] ?? '') === $key) {
                continue;
            }
            if (
                productionIdentity((string) $candidate['title']) === productionIdentity((string) $event['title'])
                && productionIdentity((string) ($candidate['organizer_name'] ?? '')) === productionIdentity((string) $event['organizer'])
            ) {
                productionPublishFail(
                    "{$key} : doublon en base avec la fiche " . (string) $candidate['id'] . '.',
                    4,
                );
            }
        }

        $sources->execute([$event['sourceUrl'], $event['startsAtUtc'], $key]);
        $sourceCollision = $sources->fetchColumn();
        if ($sourceCollision !== false) {
            productionPublishFail(
                "{$key} : la même source est déjà liée à un événement de cette date.",
                4,
            );
        }
    }
}

/** @param list<array<string,mixed>> $events */
function assertImportedProductionRows(PDO $db, array $events): array
{
    $eventStatement = $db->prepare(
        "SELECT r.*,u.role AS owner_role,u.email_verified_at AS owner_verified_at,"
        . "u.deletion_requested_at AS owner_deletion_requested_at "
        . 'FROM radar_events r JOIN users u ON u.id=r.user_id WHERE r.external_key=? LIMIT 2 FOR UPDATE'
    );
    $organizerLink = $db->prepare(
        "SELECT COUNT(*) FROM radar_event_links WHERE event_id=? AND link_type='organizer' AND url=?"
    );
    $ruleCount = $db->prepare('SELECT COUNT(*) FROM radar_event_rules WHERE event_id=?');
    $invalidKnownRule = $db->prepare(
        "SELECT COUNT(*) FROM radar_event_rules WHERE event_id=? AND rule_state<>'not_communicated' "
        . 'AND (evidence_url IS NULL OR evidence_locator IS NULL OR evidence_excerpt IS NULL '
        . 'OR evidence_scope IS NULL OR evidence_checked_at IS NULL)'
    );
    $rows = [];
    foreach ($events as $event) {
        $key = (string) $event['externalKey'];
        $eventStatement->execute([$key]);
        $matches = $eventStatement->fetchAll();
        if (count($matches) !== 1) {
            productionPublishFail("{$key} : import absent ou non unique.", 5);
        }
        $row = $matches[0];
        if (
            (string) ($row['import_batch_key'] ?? '') !== RADAR_PRODUCTION_BATCH
            || (int) $row['is_fixture'] !== 0
            || $row['owner_role'] !== 'admin'
            || $row['owner_verified_at'] === null
            || $row['owner_deletion_requested_at'] !== null
        ) {
            productionPublishFail("{$key} : propriétaire, provenance ou fixture invalide.", 5);
        }
        $alreadyPublic = $row['state'] === 'published'
            && $row['record_visibility'] === 'public'
            && (int) $row['requires_pre_publication_check'] === 0;
        $publishableDraft = $row['state'] === 'draft'
            && $row['record_visibility'] === 'admin_preview_only'
            && (int) $row['requires_pre_publication_check'] === 1;
        if (!$alreadyPublic && !$publishableDraft) {
            productionPublishFail("{$key} : état de cycle de vie inattendu.", 5);
        }
        if (
            $row['geocode_status'] !== 'validated'
            || $row['latitude'] === null
            || $row['longitude'] === null
            || $row['location_confirmed_at'] === null
            || $row['location_precision'] === 'undisclosed'
        ) {
            productionPublishFail("{$key} : géocodage non validé.", 5);
        }
        if (
            ($row['postal_code'] === null || trim((string) $row['postal_code']) === '')
            && ($row['city'] === null || trim((string) $row['city']) === '')
        ) {
            productionPublishFail("{$key} : code postal et ville absents après import.", 5);
        }
        $organizerLink->execute([$row['id'], $event['sourceUrl']]);
        if ((int) $organizerLink->fetchColumn() !== 1) {
            productionPublishFail("{$key} : lien organisateur absent après import.", 5);
        }
        $ruleCount->execute([$row['id']]);
        if ((int) $ruleCount->fetchColumn() !== 7) {
            productionPublishFail("{$key} : les sept règles ne sont pas présentes en base.", 5);
        }
        $invalidKnownRule->execute([$row['id']]);
        if ((int) $invalidKnownRule->fetchColumn() !== 0) {
            productionPublishFail("{$key} : une règle connue n’a pas de preuve complète.", 5);
        }
        $rows[$key] = $row;
    }
    return $rows;
}

try {
    if (PHP_SAPI !== 'cli') {
        productionPublishFail('commande disponible uniquement en CLI.', 3);
    }
    $options = productionPublishOptions($argv, $root);
    $document = productionPublishJson($options['seed']);
    $dataset = RadarSeedValidator::document($document);
    if ($dataset['schemaVersion'] !== '1.1.0') {
        productionPublishFail('le contrat enrichi 1.1.0 est obligatoire.');
    }
    assertProductionDataset($dataset['events']);

    $config = Config::load($root);
    if ($options['mode'] === 'apply' && !$config->isProduction()) {
        productionPublishFail('la publication est réservée à APP_ENV=production.', 3);
    }
    $db = Database::connect($config);

    if ($options['mode'] === 'preflight') {
        assertNoProductionDuplicates($db, $dataset['events'], false);
        fwrite(STDOUT, json_encode([
            'mode' => 'PREFLIGHT PRODUCTION',
            'events' => count($dataset['events']),
            'duplicates' => 0,
            'with_city_or_postal_code' => count($dataset['events']),
            'with_https_source' => count($dataset['events']),
            'sha256' => RADAR_PRODUCTION_SEED_SHA256,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        exit(0);
    }

    $db->beginTransaction();
    try {
        assertNoProductionDuplicates($db, $dataset['events'], true);
        $rows = assertImportedProductionRows($db, $dataset['events']);
        $publish = $db->prepare(
            "UPDATE radar_events SET state='published',record_visibility='public',"
            . 'requires_pre_publication_check=0,last_source_verified_at=UTC_TIMESTAMP(),'
            . 'pre_publication_checked_by=user_id,pre_publication_checked_at=UTC_TIMESTAMP(),'
            . 'published_at=COALESCE(published_at,UTC_TIMESTAMP()),expires_at=ends_at_utc,version=version+1 '
            . "WHERE id=? AND state='draft' AND record_visibility='admin_preview_only' "
            . 'AND requires_pre_publication_check=1 AND is_fixture=0'
        );
        $sources = $db->prepare(
            'UPDATE radar_event_sources SET requires_pre_publication_check=0,last_verified_at=UTC_TIMESTAMP() '
            . 'WHERE event_id=?'
        );
        $audit = new AuditLogger($db);
        $requestId = 'radar-prod-' . substr(hash('sha256', microtime(true) . random_bytes(16)), 0, 13);
        $published = 0;
        $alreadyPublic = 0;
        foreach ($dataset['events'] as $event) {
            $key = (string) $event['externalKey'];
            $row = $rows[$key];
            if ($row['state'] === 'published') {
                $alreadyPublic++;
                continue;
            }
            $publish->execute([$row['id']]);
            if ($publish->rowCount() !== 1) {
                productionPublishFail("{$key} : publication concurrente ou incomplète.", 5);
            }
            $sources->execute([$row['id']]);
            $audit->write(
                $requestId,
                (string) $row['user_id'],
                'radar.import.publish',
                'radar_event',
                (string) $row['id'],
                ['externalKey' => $key, 'batch' => RADAR_PRODUCTION_BATCH],
            );
            $published++;
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }

    fwrite(STDOUT, json_encode([
        'mode' => 'PUBLICATION PRODUCTION',
        'events' => count($dataset['events']),
        'published' => $published,
        'already_public' => $alreadyPublic,
        'duplicates' => 0,
        'sha256' => RADAR_PRODUCTION_SEED_SHA256,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Erreur : {$error->getMessage()}\n");
    $code = (int) $error->getCode();
    exit($code >= 2 && $code <= 5 ? $code : 5);
}
