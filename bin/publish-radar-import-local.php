<?php
declare(strict_types=1);

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Validation\RadarSeedValidator;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

/** @return never */
function localPublishFail(string $message, int $code = 2): never
{
    fwrite(STDERR, "Erreur : {$message}\n");
    exit($code);
}

/** @return array{seed:string,sourceReport:string,geocodeReport:string,report:string,dryRun:bool} */
function localPublishOptions(array $arguments, string $root): array
{
    array_shift($arguments);
    $options = [
        'seed' => '',
        'sourceReport' => '',
        'geocodeReport' => '',
        'report' => '',
        'dryRun' => false,
    ];
    foreach ($arguments as $argument) {
        if ($argument === '--dry-run') {
            $options['dryRun'] = true;
        } elseif (str_starts_with($argument, '--source-report=')) {
            $options['sourceReport'] = substr($argument, strlen('--source-report='));
        } elseif (str_starts_with($argument, '--geocode-report=')) {
            $options['geocodeReport'] = substr($argument, strlen('--geocode-report='));
        } elseif (str_starts_with($argument, '--report=')) {
            $options['report'] = substr($argument, strlen('--report='));
        } elseif (!str_starts_with($argument, '-') && $options['seed'] === '') {
            $options['seed'] = $argument;
        } else {
            localPublishFail("option inconnue « {$argument} ».");
        }
    }
    if (in_array('', [$options['seed'], $options['sourceReport'], $options['geocodeReport'], $options['report']], true)) {
        localPublishFail('indique le lot enrichi et les trois rapports locaux.');
    }
    $docs = realpath($root . '/docs/fat-radar');
    if ($docs === false) {
        localPublishFail('le dossier docs/fat-radar est absent.');
    }
    foreach (['seed','sourceReport','geocodeReport'] as $key) {
        $path = realpath($options[$key]);
        if ($path === false || dirname($path) !== $docs) {
            localPublishFail("le fichier {$key} doit être un document connu de docs/fat-radar.");
        }
        $options[$key] = $path;
    }
    $reportDirectory = realpath(dirname($options['report']));
    if (
        $reportDirectory !== $docs
        || !preg_match('/^fat-radar-local-publication-qa-\d{4}-\d{2}-\d{2}\.json$/D', basename($options['report']))
    ) {
        localPublishFail('le rapport final doit rester dans docs/fat-radar.');
    }
    $options['report'] = $reportDirectory . '/' . basename($options['report']);
    return $options;
}

/** @return array<string,mixed> */
function localPublishJson(string $path): array
{
    $raw = file_get_contents($path);
    if ($raw === false || strlen($raw) > 10_000_000) {
        localPublishFail("le fichier « {$path} » est illisible.");
    }
    try {
        $value = json_decode($raw, true, 96, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        localPublishFail("le fichier « {$path} » est invalide.");
    }
    if (!is_array($value) || array_is_list($value)) {
        localPublishFail("le fichier « {$path} » doit contenir un objet.");
    }
    return $value;
}

function assertLocalDatabase(Config $config): void
{
    if ($config->isProduction() || $config->get('APP_ENV', '') !== 'local') {
        localPublishFail('cette commande est strictement locale.', 3);
    }
    $dsn = strtolower($config->get('DB_DSN', ''));
    if (
        !preg_match('/host=(?:127\.0\.0\.1|localhost)(?:;|$)/', $dsn)
        || !preg_match('/dbname=[^;]*(?:test|local)[^;]*(?:;|$)/', $dsn)
    ) {
        localPublishFail('la base doit être locale et explicitement de test.', 3);
    }
}

try {
    $options = localPublishOptions($argv, $root);
    $seedDocument = localPublishJson($options['seed']);
    $dataset = RadarSeedValidator::document($seedDocument);
    if ($dataset['schemaVersion'] !== '1.1.0' || count($dataset['events']) !== 40) {
        localPublishFail('le lot final doit être un contrat 1.1.0 de 40 événements.');
    }
    $sourceReport = localPublishJson($options['sourceReport']);
    $geocodeReport = localPublishJson($options['geocodeReport']);
    $sourceByKey = [];
    foreach (($sourceReport['event_audit'] ?? []) as $event) {
        $sourceByKey[(string) ($event['external_key'] ?? '')] = $event;
    }
    $geocodeByKey = [];
    foreach (($geocodeReport['events'] ?? []) as $event) {
        $geocodeByKey[(string) ($event['external_key'] ?? '')] = $event;
    }

    $config = Config::load($root);
    assertLocalDatabase($config);
    $db = Database::connect($config);
    $eligible = [];
    $rejected = [];
    foreach ($dataset['events'] as $event) {
        $key = (string) $event['externalKey'];
        $reasons = [];
        if ($event['postalCode'] === null) {
            $reasons[] = 'code_postal_absent';
        }
        if ($event['sourceUrl'] === '') {
            $reasons[] = 'lien_source_absent';
        }
        $sourceAudit = $sourceByKey[$key] ?? null;
        if (!is_array($sourceAudit)) {
            $reasons[] = 'audit_source_absent';
        }
        $geocode = $geocodeByKey[$key] ?? null;
        if (!is_array($geocode) || !in_array($geocode['status'] ?? null, ['exact','approximate'], true)) {
            $reasons[] = 'geocodage_non_valide';
        }
        if (count($event['rules']) !== 7) {
            $reasons[] = 'matrice_regles_incomplete';
        }
        foreach ($event['rules'] as $rule) {
            if ($rule['state'] !== 'not_communicated' && $rule['evidence'] === null) {
                $reasons[] = 'regle_connue_sans_preuve';
                break;
            }
        }
        $statement = $db->prepare(
            "SELECT COUNT(*) FROM radar_events r WHERE r.external_key=? AND r.is_fixture=0 "
            . "AND r.geocode_status='validated' AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL "
            . "AND EXISTS (SELECT 1 FROM radar_event_links l WHERE l.event_id=r.id AND l.link_type='organizer' AND l.url=?) "
            . "AND (SELECT COUNT(*) FROM radar_event_rules rr WHERE rr.event_id=r.id)=7"
        );
        $statement->execute([$key, $event['sourceUrl']]);
        if ((int) $statement->fetchColumn() !== 1) {
            $reasons[] = 'import_local_incomplet';
        }
        $reasons = array_values(array_unique($reasons));
        if ($reasons === []) {
            $eligible[] = $key;
        } else {
            $rejected[$key] = $reasons;
        }
    }

    $allImported = $db->query(
        "SELECT external_key FROM radar_events WHERE external_key IS NOT NULL AND is_fixture=0 ORDER BY external_key"
    )->fetchAll(PDO::FETCH_COLUMN);
    $deleteKeys = array_values(array_diff(array_map('strval', $allImported), $eligible));
    if (!$options['dryRun']) {
        $db->beginTransaction();
        try {
            if ($deleteKeys !== []) {
                $placeholders = implode(',', array_fill(0, count($deleteKeys), '?'));
                $delete = $db->prepare("DELETE FROM radar_events WHERE external_key IN ({$placeholders}) AND is_fixture=0");
                $delete->execute($deleteKeys);
            }
            if ($eligible !== []) {
                $placeholders = implode(',', array_fill(0, count($eligible), '?'));
                $publish = $db->prepare(
                    "UPDATE radar_events SET state='published',record_visibility='public',"
                    . "requires_pre_publication_check=0,published_at=COALESCE(published_at,UTC_TIMESTAMP()),"
                    . "expires_at=ends_at_utc,version=version+1 "
                    . "WHERE external_key IN ({$placeholders}) AND is_fixture=0 AND state='draft'"
                );
                $publish->execute($eligible);
                $sources = $db->prepare(
                    "UPDATE radar_event_sources s JOIN radar_events r ON r.id=s.event_id "
                    . "SET s.requires_pre_publication_check=0 "
                    . "WHERE r.external_key IN ({$placeholders}) AND r.is_fixture=0"
                );
                $sources->execute($eligible);
            }
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
    }

    $report = [
        'schema_version' => '1.0.0',
        'generated_at' => gmdate('c'),
        'local_only' => true,
        'dry_run' => $options['dryRun'],
        'input_events' => 40,
        'published' => count($eligible),
        'deleted' => count($deleteKeys),
        'published_external_keys' => $eligible,
        'deleted_external_keys' => $deleteKeys,
        'rejected' => $rejected,
    ];
    file_put_contents(
        $options['report'],
        json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        LOCK_EX,
    );
    fwrite(STDOUT, json_encode([
        'mode' => $options['dryRun'] ? 'SIMULATION LOCALE' : 'PUBLICATION LOCALE',
        'published' => count($eligible),
        'deleted' => count($deleteKeys),
        'report' => basename($options['report']),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
} catch (Throwable $error) {
    localPublishFail($error->getMessage(), 5);
}
