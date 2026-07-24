<?php
declare(strict_types=1);

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\HttpException;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\GeocodingService;
use Fat\Api\Support;
use Fat\Api\Validation\RadarSeedValidator;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

/** @return never */
function fail(string $message, int $code = 2): never
{
    fwrite(STDERR, "Erreur : {$message}\n");
    exit($code);
}

/** @return array{path:string,dryRun:bool,geocode:bool,ownerEnv:string,preview:string,qaReport:?string} */
function options(array $arguments, string $root): array
{
    array_shift($arguments);
    $result = [
        'path' => '',
        'dryRun' => false,
        'geocode' => false,
        'ownerEnv' => '',
        'preview' => '',
        'qaReport' => null,
    ];
    foreach ($arguments as $argument) {
        if ($argument === '--dry-run') {
            $result['dryRun'] = true;
        } elseif ($argument === '--geocode') {
            $result['geocode'] = true;
        } elseif (str_starts_with($argument, '--owner-email-env=')) {
            $result['ownerEnv'] = substr($argument, strlen('--owner-email-env='));
        } elseif (str_starts_with($argument, '--preview=')) {
            $result['preview'] = substr($argument, strlen('--preview='));
        } elseif (str_starts_with($argument, '--qa-report=')) {
            $result['qaReport'] = substr($argument, strlen('--qa-report='));
        } elseif (!str_starts_with($argument, '-') && $result['path'] === '') {
            $result['path'] = $argument;
        } else {
            fail("option inconnue « {$argument} ».");
        }
    }
    if ($result['path'] === '') {
        fail('indique le chemin du JSON de semences.');
    }
    if ($result['ownerEnv'] !== 'FAT_RADAR_SEED_OWNER_EMAIL') {
        fail('utilise --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL.');
    }
    if ($result['preview'] !== 'admin') {
        fail('utilise le mode explicite --preview=admin. Aucun mode de publication n’est accepté.');
    }
    $knownDirectories = array_values(array_filter([
        realpath($root . '/docs/fat-radar'),
        realpath($root . '/database/seeds'),
    ], 'is_string'));
    $path = realpath($result['path']);
    if (
        $path === false
        || !in_array(dirname($path), $knownDirectories, true)
        || !preg_match(
            '/^fat-radar-events-(?:seed-\d{4}-\d{2}-\d{2}(?:\.importable-v1)?|enriched-\d{4}-\d{2}-\d{2})\.json(?:\.php)?$/D',
            basename($path),
        )
    ) {
        fail('le fichier doit être un JSON de semences Radar connu.');
    }
    $result['path'] = $path;
    if ($result['qaReport'] !== null) {
        $knownDirectory = realpath($root . '/docs/fat-radar');
        $reportDirectory = realpath(dirname($result['qaReport']));
        if (
            $knownDirectory === false
            ||
            $reportDirectory !== $knownDirectory
            || !preg_match('/^fat-radar-geocoding-qa-\d{4}-\d{2}-\d{2}\.json$/D', basename($result['qaReport']))
        ) {
            fail('le rapport QA doit être un JSON connu dans docs/fat-radar.');
        }
        $result['qaReport'] = $reportDirectory . '/' . basename($result['qaReport']);
    }
    return $result;
}

/** @param array<string,mixed> $event */
function importSlug(array $event): string
{
    return mb_substr((string) $event['externalKey'], 0, 150) . '-' . substr(hash('sha256', (string) $event['externalKey']), 0, 8);
}

/** @return array{id:string,role:string} */
function resolveOwner(PDO $db, string $environmentName): array
{
    $email = getenv($environmentName);
    if (!is_string($email) || trim($email) === '') {
        fail("la variable {$environmentName} est absente.", 3);
    }
    $statement = $db->prepare(
        'SELECT id,role FROM users WHERE email=? AND deletion_requested_at IS NULL LIMIT 2'
    );
    $statement->execute([mb_strtolower(trim($email))]);
    $owners = $statement->fetchAll();
    if (count($owners) !== 1 || $owners[0]['role'] !== 'admin') {
        fail('le propriétaire doit correspondre à un unique compte administrateur actif.', 3);
    }
    return ['id' => (string) $owners[0]['id'], 'role' => (string) $owners[0]['role']];
}

try {
    $options = options($argv, $root);
    $raw = str_ends_with($options['path'], '.json.php')
        ? require $options['path']
        : file_get_contents($options['path']);
    if (!is_string($raw) || strlen($raw) > 5_000_000) {
        fail('le JSON est illisible ou trop volumineux.');
    }
    try {
        $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fail('le JSON est invalide.');
    }
    if (!is_array($decoded) || array_is_list($decoded)) {
        fail('la racine JSON doit être un objet.');
    }
    $dataset = RadarSeedValidator::document($decoded);
    $config = Config::load($root);
    $db = Database::connect($config);
    $owner = resolveOwner($db, $options['ownerEnv']);
    $geocoder = new GeocodingService($db, $config);
    $audit = new AuditLogger($db);
    $requestId = 'cli-radar-' . substr(hash('sha256', microtime(true) . random_bytes(16)), 0, 14);
    $batchKey = 'fat-radar-seed-' . substr((string) $dataset['generatedAt'], 0, 10);
    $summary = [
        'created' => 0,
        'updated' => 0,
        'skipped' => 0,
        'validationErrors' => 0,
        'geocoded' => 0,
        'exact' => 0,
        'approximate' => 0,
        'ambiguous' => 0,
        'rejected' => 0,
        'needsReview' => 0,
        'withoutPublicPin' => 0,
    ];
    $geocodeAudit = [];

    if (!$options['dryRun']) {
        $db->beginTransaction();
    }
    try {
        $geocodeRequestCount = 0;
        foreach ($dataset['events'] as $event) {
            $existingStatement = $db->prepare(
                'SELECT id,user_id,state,record_visibility,requires_pre_publication_check,is_fixture,latitude,longitude,'
                . 'location_method,location_confirmed_at,geocode_status,geocode_checked_at '
                . 'FROM radar_events WHERE external_key=? LIMIT 1'
            );
            $existingStatement->execute([$event['externalKey']]);
            $existing = $existingStatement->fetch();
            $action = 'created';
            $eventId = Support::uuid();
            if ($existing) {
                if ((string) $existing['user_id'] !== $owner['id']) {
                    throw new RuntimeException("collision de propriétaire pour {$event['externalKey']}.");
                }
                if (
                    $existing['state'] !== 'draft'
                    || $existing['record_visibility'] !== 'admin_preview_only'
                    || (int) $existing['requires_pre_publication_check'] !== 1
                    || (int) $existing['is_fixture'] !== 0
                ) {
                    $summary['skipped']++;
                    fwrite(STDOUT, "{$event['externalKey']} : ignoré (fiche déjà revue ou hors lot)\n");
                    continue;
                }
                $eventId = (string) $existing['id'];
                $action = 'updated';
            }

            $latitude = $existing && !$options['geocode'] && $existing['latitude'] !== null
                ? (float) $existing['latitude']
                : null;
            $longitude = $existing && !$options['geocode'] && $existing['longitude'] !== null
                ? (float) $existing['longitude']
                : null;
            $locationMethod = $existing && !$options['geocode'] ? $existing['location_method'] : null;
            $confirmedAt = $existing && !$options['geocode'] ? $existing['location_confirmed_at'] : null;
            $geocodeCheckedAt = $existing && !$options['geocode'] ? $existing['geocode_checked_at'] : null;
            $geocodeStatus = $existing && !$options['geocode']
                ? (string) $existing['geocode_status']
                : ($event['locationPrecision'] === 'undisclosed' ? 'needs_review' : 'not_requested');
            $locationPrecision = $event['locationPrecision'];
            $visibility = in_array($locationPrecision, ['city', 'undisclosed'], true) ? 'approximate' : 'exact';

            if ($event['locationPrecision'] === 'undisclosed') {
                $latitude = $longitude = $locationMethod = $confirmedAt = null;
                $geocodeStatus = 'needs_review';
                $summary['rejected']++;
                $summary['needsReview']++;
                $geocodeAudit[] = [
                    'external_key' => $event['externalKey'],
                    'status' => 'rejected',
                    'precision' => 'undisclosed',
                    'query' => null,
                    'attempts' => [],
                ];
            } elseif ($options['geocode']) {
                if ($geocodeRequestCount > 0) {
                    usleep(150_000);
                }
                $geocodeRequestCount++;
                try {
                    $resolved = $geocoder->resolveExpectedLocation(
                        $event['address'],
                        (string) $event['city'],
                        $event['postalCode'],
                        (string) $event['departmentCode'],
                        !$options['dryRun'],
                    );
                    $geocodeCheckedAt = gmdate('Y-m-d H:i:s');
                    if (in_array($resolved['status'], ['exact', 'approximate'], true) && $resolved['suggestion'] !== null) {
                        $latitude = round((float) $resolved['suggestion']['latitude'], 6);
                        $longitude = round((float) $resolved['suggestion']['longitude'], 6);
                        $locationMethod = 'geocoded';
                        $confirmedAt = $geocodeCheckedAt;
                        $geocodeStatus = 'validated';
                        $locationPrecision = $resolved['status'] === 'exact' ? 'street' : 'city';
                        $visibility = $resolved['status'] === 'exact' ? 'exact' : 'approximate';
                        $summary['geocoded']++;
                        $summary[$resolved['status']]++;
                    } else {
                        $latitude = $longitude = $locationMethod = $confirmedAt = null;
                        $geocodeStatus = 'needs_review';
                        $summary[$resolved['status']]++;
                        $summary['needsReview']++;
                    }
                    $geocodeAudit[] = [
                        'external_key' => $event['externalKey'],
                        'status' => $resolved['status'],
                        'precision' => $locationPrecision,
                        'query' => $resolved['query'],
                        'attempts' => $resolved['attempts'],
                    ];
                } catch (HttpException $error) {
                    $latitude = $longitude = $locationMethod = $confirmedAt = null;
                    $geocodeStatus = 'needs_review';
                    $geocodeCheckedAt = gmdate('Y-m-d H:i:s');
                    $summary['rejected']++;
                    $summary['needsReview']++;
                    $geocodeAudit[] = [
                        'external_key' => $event['externalKey'],
                        'status' => 'rejected',
                        'precision' => $locationPrecision,
                        'query' => null,
                        'attempts' => [],
                        'error' => $error->errorCode,
                    ];
                }
            } elseif ($geocodeStatus === 'needs_review') {
                $summary['needsReview']++;
            }
            if ($latitude === null || $longitude === null || $locationPrecision === 'undisclosed') {
                $summary['withoutPublicPin']++;
            }

            if (!$options['dryRun']) {
                $priceCents = $event['priceMinCents'] !== null && $event['priceMinCents'] === $event['priceMaxCents']
                    ? $event['priceMinCents']
                    : null;
                if ($action === 'created') {
                    $statement = $db->prepare(
                        'INSERT INTO radar_events (id,user_id,external_key,slug,state,moderation_state,record_visibility,claim_state,'
                        . 'title,organizer_name,organizer_type,event_type,terrain_type,venue_name,short_description,starts_at_utc,ends_at_utc,'
                        . 'timezone,schedule_precision,max_capacity,price_cents,price_min_cents,price_max_cents,latitude,longitude,'
                        . 'location_method,location_confirmed_at,location_visibility,location_precision,geocode_status,geocode_checked_at,'
                        . 'exact_address,public_location_label,city,postal_code,department_code,registration_url,'
                        . 'requires_pre_publication_check,is_fixture,import_batch_key) '
                        . "VALUES (?,?,?,?,'draft','visible','admin_preview_only','unclaimed',"
                        . "?,?,?,?,?,?,?,?,?,'Europe/Paris',"
                        . "?,?,?,?,?,?,?,?,?,"
                        . "?,?,?,?,?,?,?,?,?,?,1,0,?)"
                    );
                    $statement->execute([
                        $eventId, $owner['id'], $event['externalKey'], importSlug($event),
                        $event['title'], $event['organizer'], $event['organizerType'], $event['eventType'], $event['terrainType'],
                        $event['locationLabel'], $event['summary'], $event['startsAtUtc'], $event['endsAtUtc'],
                        $event['schedulePrecision'], $event['capacity'], $priceCents, $event['priceMinCents'], $event['priceMaxCents'],
                        $latitude, $longitude, $locationMethod, $confirmedAt, $visibility, $locationPrecision,
                        $geocodeStatus, $geocodeCheckedAt, $event['address'], $event['locationLabel'], $event['city'],
                        $event['postalCode'], $event['departmentCode'], $event['registrationUrl'], $batchKey,
                    ]);
                } else {
                    $statement = $db->prepare(
                        "UPDATE radar_events SET title=?,organizer_name=?,organizer_type=?,event_type=?,terrain_type=?,venue_name=?,"
                        . "short_description=?,starts_at_utc=?,ends_at_utc=?,schedule_precision=?,max_capacity=?,price_cents=?,"
                        . "price_min_cents=?,price_max_cents=?,latitude=?,longitude=?,location_method=?,location_confirmed_at=?,"
                        . "location_visibility=?,location_precision=?,geocode_status=?,geocode_checked_at=?,exact_address=?,"
                        . "public_location_label=?,city=?,postal_code=?,department_code=?,registration_url=?,"
                        . "record_visibility='admin_preview_only',claim_state='unclaimed',requires_pre_publication_check=1,"
                        . "is_fixture=0,import_batch_key=?,version=version+1 WHERE id=?"
                    );
                    $statement->execute([
                        $event['title'], $event['organizer'], $event['organizerType'], $event['eventType'], $event['terrainType'],
                        $event['locationLabel'], $event['summary'], $event['startsAtUtc'], $event['endsAtUtc'],
                        $event['schedulePrecision'], $event['capacity'], $priceCents, $event['priceMinCents'], $event['priceMaxCents'],
                        $latitude, $longitude, $locationMethod, $confirmedAt, $visibility, $locationPrecision,
                        $geocodeStatus, $geocodeCheckedAt, $event['address'], $event['locationLabel'], $event['city'],
                        $event['postalCode'], $event['departmentCode'], $event['registrationUrl'], $batchKey, $eventId,
                    ]);
                }

                $rule = $db->prepare(
                    'INSERT INTO radar_event_rules (event_id,rule_type,rule_state,joules,details,'
                    . 'evidence_url,evidence_locator,evidence_excerpt,evidence_scope,evidence_checked_at) '
                    . 'VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE '
                    . "joules=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',joules,VALUES(joules)),"
                    . "details=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',details,VALUES(details)),"
                    . "evidence_url=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',evidence_url,VALUES(evidence_url)),"
                    . "evidence_locator=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',evidence_locator,VALUES(evidence_locator)),"
                    . "evidence_excerpt=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',evidence_excerpt,VALUES(evidence_excerpt)),"
                    . "evidence_scope=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',evidence_scope,VALUES(evidence_scope)),"
                    . "evidence_checked_at=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',evidence_checked_at,VALUES(evidence_checked_at)),"
                    . "rule_state=IF(VALUES(rule_state)='not_communicated' AND rule_state<>'not_communicated',rule_state,VALUES(rule_state))"
                );
                foreach ($event['rules'] as $eventRule) {
                    $evidence = $eventRule['evidence'];
                    $rule->execute([
                        $eventId,
                        $eventRule['type'],
                        $eventRule['state'],
                        $eventRule['joules'],
                        $eventRule['details'],
                        $evidence['url'] ?? null,
                        $evidence['locator'] ?? null,
                        $evidence['excerpt'] ?? null,
                        $evidence['scope'] ?? null,
                        $evidence['checkedAtUtc'] ?? null,
                    ]);
                }
                $deleteImportedLinks = $db->prepare(
                    "DELETE FROM radar_event_links WHERE event_id=? AND link_type IN ('organizer','registration')"
                );
                $deleteImportedLinks->execute([$eventId]);
                $eventLink = $db->prepare(
                    'INSERT INTO radar_event_links (id,event_id,link_type,url,sort_order) VALUES (?,?,?,?,?)'
                );
                $eventLink->execute([Support::uuid(), $eventId, 'organizer', $event['sourceUrl'], 0]);
                if ($event['registrationUrl'] !== null) {
                    $eventLink->execute([Support::uuid(), $eventId, 'registration', $event['registrationUrl'], 1]);
                }
                $fingerprint = hash('sha256', $event['sourceUrl'], true);
                $source = $db->prepare(
                    'INSERT INTO radar_event_sources (id,event_id,source_url,registration_url,source_tier,source_locator,'
                    . 'source_fingerprint,requires_pre_publication_check) VALUES (?,?,?,?,?,?,?,1) '
                    . 'ON DUPLICATE KEY UPDATE registration_url=VALUES(registration_url),source_tier=VALUES(source_tier),'
                    . 'source_locator=VALUES(source_locator),requires_pre_publication_check=1'
                );
                $source->execute([
                    Support::uuid(), $eventId, $event['sourceUrl'], $event['registrationUrl'],
                    $event['sourceTier'], $event['sourceLocator'], $fingerprint,
                ]);
                $audit->write(
                    $requestId,
                    $owner['id'],
                    $action === 'created' ? 'radar.import.create' : 'radar.import.update',
                    'radar_event',
                    $eventId,
                    ['externalKey' => $event['externalKey'], 'sourceTier' => $event['sourceTier'], 'batch' => $batchKey],
                );
            }
            $summary[$action]++;
            fwrite(STDOUT, "{$event['externalKey']} : " . ($options['dryRun'] ? "simulation {$action}" : $action) . "\n");
        }
        if (!$options['dryRun']) {
            $db->commit();
        }
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }

    $mode = $options['dryRun'] ? 'SIMULATION — aucune écriture' : 'IMPORT EN BROUILLON ADMIN';
    if ($options['qaReport'] !== null) {
        file_put_contents(
            $options['qaReport'],
            json_encode([
                'schema_version' => '1.0.0',
                'generated_at' => gmdate('c'),
                'dataset' => basename($options['path']),
                'dry_run' => $options['dryRun'],
                'summary' => [
                    'exact' => $summary['exact'],
                    'approximate' => $summary['approximate'],
                    'ambiguous' => $summary['ambiguous'],
                    'rejected' => $summary['rejected'],
                ],
                'events' => $geocodeAudit,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
            LOCK_EX,
        );
    }
    fwrite(STDOUT, "\n{$mode}\n");
    fwrite(STDOUT, json_encode($summary, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
} catch (HttpException $error) {
    fail($error->getMessage(), 4);
} catch (Throwable $error) {
    fail($error->getMessage(), 5);
}
