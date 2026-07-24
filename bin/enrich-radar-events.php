<?php
declare(strict_types=1);

use Fat\Api\HttpException;
use Fat\Api\Support;
use Fat\Api\Validation\RadarSeedValidator;
use Fat\Api\Validation\Validator;

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

const RADAR_RULE_TYPES = [
    'assault', 'dmr', 'sniper', 'cqb',
    'detonating_grenades', 'co2_grenades', 'smoke_grenades',
];

/** @return never */
function enrichmentFail(string $message, int $code = 2): never
{
    fwrite(STDERR, "Erreur : {$message}\n");
    exit($code);
}

/** @return array{worklist:string,cache:string,output:string,offline:bool,refresh:bool,delayMs:int} */
function enrichmentOptions(array $arguments, string $root): array
{
    array_shift($arguments);
    $options = [
        'worklist' => '',
        'cache' => '',
        'output' => '',
        'offline' => false,
        'refresh' => false,
        'delayMs' => 250,
    ];
    foreach ($arguments as $argument) {
        if ($argument === '--offline') {
            $options['offline'] = true;
        } elseif ($argument === '--refresh') {
            $options['refresh'] = true;
        } elseif (str_starts_with($argument, '--offline-cache=')) {
            $options['cache'] = substr($argument, strlen('--offline-cache='));
        } elseif (str_starts_with($argument, '--output=')) {
            $options['output'] = substr($argument, strlen('--output='));
        } elseif (str_starts_with($argument, '--delay-ms=')) {
            $delay = filter_var(substr($argument, strlen('--delay-ms=')), FILTER_VALIDATE_INT);
            if ($delay === false || $delay < 100 || $delay > 5_000) {
                enrichmentFail('le délai doit être compris entre 100 et 5000 ms.');
            }
            $options['delayMs'] = $delay;
        } elseif (!str_starts_with($argument, '-') && $options['worklist'] === '') {
            $options['worklist'] = $argument;
        } else {
            enrichmentFail("option inconnue « {$argument} ».");
        }
    }
    if ($options['worklist'] === '' || $options['cache'] === '' || $options['output'] === '') {
        enrichmentFail('indique le worklist, --offline-cache et --output.');
    }
    $docs = realpath($root . '/docs/fat-radar');
    $worklist = realpath($options['worklist']);
    $outputDirectory = realpath(dirname($options['output']));
    if (
        $docs === false
        || $worklist === false
        || dirname($worklist) !== $docs
        || $outputDirectory !== $docs
        || !preg_match('/^fat-radar-events-enriched-\d{4}-\d{2}-\d{2}\.json$/D', basename($options['output']))
    ) {
        enrichmentFail('les entrées et la sortie doivent rester dans docs/fat-radar.');
    }
    $cache = $options['cache'];
    if (!str_starts_with($cache, '/')) {
        $cache = $root . '/' . ltrim($cache, '/');
    }
    $options['worklist'] = $worklist;
    $options['cache'] = $cache;
    $options['output'] = $outputDirectory . '/' . basename($options['output']);
    return $options;
}

/** @return array<string,mixed> */
function readJsonFile(string $path): array
{
    $raw = file_get_contents($path);
    if ($raw === false || strlen($raw) > 8_000_000) {
        enrichmentFail("le fichier « {$path} » est illisible ou trop volumineux.");
    }
    try {
        $value = json_decode($raw, true, 96, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        enrichmentFail("le fichier « {$path} » ne contient pas un JSON valide.");
    }
    if (!is_array($value) || array_is_list($value)) {
        enrichmentFail("le fichier « {$path} » doit contenir un objet JSON.");
    }
    return $value;
}

function cachePath(string $cacheDirectory, string $url): string
{
    return $cacheDirectory . '/' . hash('sha256', $url) . '.json';
}

/** @return array<string,mixed>|null */
function cachedSource(string $path, string $url): ?array
{
    if (!is_file($path)) {
        return null;
    }
    $cached = readJsonFile($path);
    return ($cached['url'] ?? null) === $url ? $cached : null;
}

/** @return array<string,mixed> */
function fetchOfficialSource(
    string $url,
    string $cacheDirectory,
    bool $offline,
    bool $refresh,
    int $delayMs,
    float &$lastFetchAt,
): array {
    $path = cachePath($cacheDirectory, $url);
    $cached = $refresh ? null : cachedSource($path, $url);
    if ($cached !== null) {
        $cached['cache'] = 'hit';
        return $cached;
    }
    if ($offline) {
        return [
            'url' => $url,
            'status' => 0,
            'content_type' => null,
            'checked_at' => gmdate('c'),
            'body' => '',
            'error' => 'offline_cache_miss',
            'cache' => 'miss',
        ];
    }
    $elapsedMs = (microtime(true) - $lastFetchAt) * 1000;
    if ($lastFetchAt > 0 && $elapsedMs < $delayMs) {
        usleep((int) (($delayMs - $elapsedMs) * 1000));
    }
    $context = stream_context_create(['http' => [
        'method' => 'GET',
        'header' => "Accept: text/html,application/xhtml+xml,application/pdf;q=0.8\r\n"
            . "User-Agent: F.A.T.-Radar/1.0 (+local QA; cached respectful research)\r\n",
        'timeout' => 12,
        'ignore_errors' => true,
        'follow_location' => 1,
        'max_redirects' => 4,
    ]]);
    $body = @file_get_contents($url, false, $context);
    $lastFetchAt = microtime(true);
    $headers = $http_response_header ?? [];
    $status = 0;
    $contentType = null;
    foreach ($headers as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/i', $header, $matches)) {
            $status = (int) $matches[1];
        } elseif (stripos($header, 'Content-Type:') === 0) {
            $contentType = trim(substr($header, strlen('Content-Type:')));
        }
    }
    $error = null;
    if ($body === false) {
        $body = '';
        $error = 'network_error';
    } elseif (strlen($body) > 2_000_000) {
        $body = substr($body, 0, 2_000_000);
        $error = 'body_truncated';
    }
    $result = [
        'url' => $url,
        'status' => $status,
        'content_type' => $contentType,
        'checked_at' => gmdate('c'),
        'body' => $body,
        'error' => $error,
        'cache' => 'miss',
    ];
    file_put_contents(
        $path,
        json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        LOCK_EX,
    );
    return $result;
}

function sourceText(array $source): string
{
    if (($source['status'] ?? 0) < 200 || ($source['status'] ?? 0) >= 300) {
        return '';
    }
    $contentType = strtolower((string) ($source['content_type'] ?? ''));
    if ($contentType !== '' && !str_contains($contentType, 'html') && !str_contains($contentType, 'text')) {
        return '';
    }
    $body = (string) ($source['body'] ?? '');
    $body = preg_replace('/<(script|style|noscript)\b[^>]*>.*?<\/\1>/isu', ' ', $body) ?? $body;
    $body = preg_replace('/<(?:br|\/p|\/li|\/div|\/h[1-6]|\/section|\/article)>/iu', "\n", $body) ?? $body;
    $text = html_entity_decode(strip_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/[ \t\x{00A0}]+/u', ' ', $text) ?? $text;
    $text = preg_replace('/\R{2,}/u', "\n", $text) ?? $text;
    return trim($text);
}

function normalizedResearchText(string $value): string
{
    $value = mb_strtolower(Support::normalizeText($value));
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    return is_string($ascii) ? $ascii : $value;
}

/** @return list<string> */
function evidenceSegments(string $text): array
{
    $segments = preg_split('/(?:\R+|(?<=[.!?;])\s+)/u', $text) ?: [];
    $result = [];
    foreach ($segments as $segment) {
        $segment = Support::normalizeText($segment);
        if (mb_strlen($segment) < 8 || mb_strlen($segment) > 800) {
            continue;
        }
        $result[] = $segment;
    }
    return array_slice($result, 0, 10_000);
}

function segmentMatchesRule(string $normalized, string $type): bool
{
    return match ($type) {
        'assault' => (bool) preg_match('/\b(?:assaut|aeg|fusil d.?assaut)\b/u', $normalized),
        'dmr' => (bool) preg_match('/\b(?:dmr|anti[- ]?snipe|contre[- ]?snipe)\b/u', $normalized),
        'sniper' => (bool) preg_match('/\b(?:sniper|bolt|fusil de precision)\b/u', $normalized),
        'cqb' => (bool) preg_match('/\bcqb\b/u', $normalized),
        'detonating_grenades' => (bool) preg_match('/\bgrenade\w*\b.*\b(?:deton|sonor|explos|pyro)/u', $normalized)
            || (bool) preg_match('/\b(?:deton|sonor|explos|pyro)\w*\b.*\bgrenade/u', $normalized),
        'co2_grenades' => str_contains($normalized, 'grenade') && (bool) preg_match('/\bco2\b/u', $normalized),
        'smoke_grenades' => (bool) preg_match('/\b(?:fumigene|fumigenes|smoke)\b/u', $normalized),
        default => false,
    };
}

/** @return array{state:string,joules:?float}|null */
function classifyRuleSegment(string $segment): ?array
{
    $normalized = normalizedResearchText($segment);
    $forbidden = (bool) preg_match('/\b(?:interdit|interdite|interdits|interdites|prohibe|refuse|non autorise)\b/u', $normalized);
    $allowed = (bool) preg_match('/\b(?:autorise|autorisee|autorises|autorisees|accepte|acceptee|admis|permise?|tolere)\b/u', $normalized);
    $specific = (bool) preg_match(
        '/\b(?:uniquement|maximum|maxi|limite|semi|full|rafale|distance|engagement|metres?|joules?|[0-9]+[,.]?[0-9]*\s*j\b|fps)\b/u',
        $normalized,
    );
    if (!$forbidden && !$allowed && !$specific) {
        return null;
    }
    $state = $forbidden ? 'forbidden' : ($specific ? 'specific' : 'allowed');
    $joules = null;
    preg_match_all(
        '/\b([0-9](?:[,.][0-9]{1,2})?)\s*(?:j|joules?)\b/u',
        $normalized,
        $matches,
    );
    $explicitJoules = array_values(array_unique($matches[1] ?? []));
    if (count($explicitJoules) === 1) {
        $candidate = (float) str_replace(',', '.', $explicitJoules[0]);
        if ($candidate >= 0.01 && $candidate <= 10) {
            $joules = round($candidate, 2);
        }
    }
    return ['state' => $state, 'joules' => $joules];
}

/** @return array<string,mixed> */
function unknownRule(string $type): array
{
    return [
        'type' => $type,
        'state' => 'not_communicated',
        'joules' => null,
        'details' => 'NC',
        'evidence' => null,
    ];
}

/**
 * @param list<array{source:array<string,mixed>,scope:string,locator:string,relevant:bool}> $documents
 * @return array{rules:list<array<string,mixed>>,conflicts:list<string>}
 */
function enrichRules(array $documents): array
{
    $rules = [];
    $conflicts = [];
    foreach (RADAR_RULE_TYPES as $type) {
        $candidates = [];
        foreach ($documents as $document) {
            if (!$document['relevant']) {
                continue;
            }
            foreach (evidenceSegments(sourceText($document['source'])) as $segment) {
                $normalized = normalizedResearchText($segment);
                if (!segmentMatchesRule($normalized, $type)) {
                    continue;
                }
                $classification = classifyRuleSegment($segment);
                if ($classification === null) {
                    continue;
                }
                $candidates[] = [
                    'type' => $type,
                    'state' => $classification['state'],
                    'joules' => $classification['joules'],
                    'details' => mb_substr($segment, 0, 240),
                    'evidence' => [
                        'url' => $document['source']['url'],
                        'locator' => mb_substr($document['locator'], 0, 500),
                        'excerpt' => mb_substr($segment, 0, 500),
                        'scope' => $document['scope'],
                        'checked_at' => $document['source']['checked_at'],
                    ],
                ];
            }
        }
        $states = array_values(array_unique(array_column($candidates, 'state')));
        if (count($states) > 1) {
            $conflicts[] = $type;
            $rules[] = unknownRule($type);
            continue;
        }
        usort($candidates, static function (array $left, array $right): int {
            $scope = ['event' => 0, 'organizer_general' => 1];
            return ($scope[$left['evidence']['scope']] ?? 2) <=> ($scope[$right['evidence']['scope']] ?? 2);
        });
        $rules[] = $candidates[0] ?? unknownRule($type);
    }
    return ['rules' => $rules, 'conflicts' => $conflicts];
}

function pageRelevantToEvent(string $text, array $event): bool
{
    if ($text === '') {
        return false;
    }
    $haystack = normalizedResearchText($text);
    foreach ([$event['title'], $event['source']['source_locator']] as $needle) {
        $needle = normalizedResearchText((string) $needle);
        if (mb_strlen($needle) >= 10 && str_contains($haystack, $needle)) {
            return true;
        }
    }
    return false;
}

/** @return array<string,mixed> */
function validateWorklist(array $document): array
{
    Validator::keys($document, [
        'schema_version','document_type','generated_at','source_seed',
        'required_rule_types','policy','events',
    ], [
        'schema_version','document_type','generated_at','source_seed',
        'required_rule_types','policy','events',
    ]);
    if (
        $document['schema_version'] !== '1.0.0'
        || $document['document_type'] !== 'fat_radar_official_rule_enrichment_worklist'
        || $document['required_rule_types'] !== RADAR_RULE_TYPES
        || !is_array($document['events'])
        || !array_is_list($document['events'])
        || count($document['events']) !== 40
    ) {
        enrichmentFail('le contrat du worklist est invalide.');
    }
    return $document;
}

try {
    $options = enrichmentOptions($argv, $root);
    if (!is_dir($options['cache']) && !mkdir($options['cache'], 0770, true) && !is_dir($options['cache'])) {
        enrichmentFail('impossible de créer le cache de sources.');
    }
    $worklist = validateWorklist(readJsonFile($options['worklist']));
    $seedPath = dirname($options['worklist']) . '/' . basename((string) $worklist['source_seed']);
    $seedDocument = readJsonFile($seedPath);
    $validatedSeed = RadarSeedValidator::document($seedDocument);
    if (count($validatedSeed['events']) !== 40) {
        enrichmentFail('le lot source doit contenir exactement 40 événements.');
    }
    $seedByKey = [];
    foreach ($seedDocument['events'] as $event) {
        $seedByKey[$event['external_key']] = $event;
    }

    $lastFetchAt = 0.0;
    $sourceCache = [];
    $auditEvents = [];
    $outputEvents = [];
    $coverage = array_fill_keys(RADAR_RULE_TYPES, [
        'known' => 0, 'NC' => 0, 'allowed' => 0, 'specific' => 0, 'forbidden' => 0,
    ]);
    foreach ($worklist['events'] as $index => $workEvent) {
        if (!is_array($workEvent) || array_is_list($workEvent)) {
            enrichmentFail('une entrée du worklist est invalide.');
        }
        $externalKey = (string) ($workEvent['external_key'] ?? '');
        $seedEvent = $seedByKey[$externalKey] ?? null;
        if (!is_array($seedEvent)) {
            enrichmentFail("la fiche {$externalKey} est absente du lot source.");
        }
        $officialSource = (string) ($workEvent['source']['official_source_url'] ?? '');
        $officialRegistration = $workEvent['source']['official_registration_url'] ?? null;
        if ($officialSource !== $seedEvent['source_url'] || $officialRegistration !== $seedEvent['registration_url']) {
            enrichmentFail("les liens officiels divergent pour {$externalKey}.");
        }
        $urls = array_values(array_unique(array_filter([$officialSource, $officialRegistration])));
        $documents = [];
        $sourceResults = [];
        foreach ($urls as $url) {
            if (!isset($sourceCache[$url])) {
                $sourceCache[$url] = fetchOfficialSource(
                    $url,
                    $options['cache'],
                    $options['offline'],
                    $options['refresh'],
                    $options['delayMs'],
                    $lastFetchAt,
                );
            }
            $source = $sourceCache[$url];
            $eventScope = $officialRegistration !== null && $url === $officialRegistration;
            if (!$eventScope) {
                $path = strtolower((string) (parse_url($url, PHP_URL_PATH) ?? ''));
                $eventScope = (bool) preg_match('#/(?:evenements?|events?|produit)/#', $path);
            }
            $text = sourceText($source);
            $documents[] = [
                'source' => $source,
                'scope' => $eventScope ? 'event' : 'organizer_general',
                'locator' => (string) ($workEvent['source']['source_locator'] ?? 'Source officielle'),
                'relevant' => $eventScope || pageRelevantToEvent($text, $workEvent),
            ];
            $sourceResults[] = [
                'url' => $url,
                'status' => $source['status'],
                'cache' => $source['cache'],
                'error' => $source['error'],
                'usable_text' => $text !== '',
            ];
        }
        $enriched = enrichRules($documents);
        $seedEvent['rules'] = $enriched['rules'];
        $outputEvents[] = $seedEvent;
        $known = 0;
        foreach ($enriched['rules'] as $rule) {
            if ($rule['state'] === 'not_communicated') {
                $coverage[$rule['type']]['NC']++;
            } else {
                $known++;
                $coverage[$rule['type']]['known']++;
                $coverage[$rule['type']][$rule['state']]++;
            }
        }
        $auditEvents[] = [
            'external_key' => $externalKey,
            'title' => $seedEvent['title'],
            'official_source_url' => $officialSource,
            'official_registration_url' => $officialRegistration,
            'sources' => $sourceResults,
            'known_rules' => $known,
            'conflicts_to_nc' => $enriched['conflicts'],
        ];
        fwrite(STDOUT, sprintf(
            "[%02d/40] %s — %d règle(s) connue(s)\n",
            $index + 1,
            $externalKey,
            $known,
        ));
    }

    $output = $seedDocument;
    $output['schema_version'] = '1.1.0';
    $output['dataset'] = (string) $seedDocument['dataset'] . ' — enrichissement officiel';
    $output['purpose'] = (string) $seedDocument['purpose']
        . ' Matrice de règles enrichie exclusivement depuis les sources officielles accessibles.';
    $output['events'] = $outputEvents;
    RadarSeedValidator::document($output);
    file_put_contents(
        $options['output'],
        json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        LOCK_EX,
    );

    $report = [
        'schema_version' => '1.0.0',
        'generated_at' => gmdate('c'),
        'input' => basename($options['worklist']),
        'output' => basename($options['output']),
        'mode' => $options['offline'] ? 'offline_cache' : 'network_with_cache',
        'events' => count($outputEvents),
        'rules' => count($outputEvents) * count(RADAR_RULE_TYPES),
        'unique_official_urls' => count($sourceCache),
        'coverage' => $coverage,
        'event_audit' => $auditEvents,
    ];
    $reportPath = preg_replace('/\.json$/', '.report.json', $options['output']);
    $markdownPath = preg_replace('/\.json$/', '.report.md', $options['output']);
    file_put_contents(
        $reportPath,
        json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        LOCK_EX,
    );
    $markdown = [
        '# Rapport d’enrichissement Radar',
        '',
        '- Événements : 40',
        '- Règles : 280',
        '- Sources officielles uniques : ' . count($sourceCache),
        '- Mode : ' . $report['mode'],
        '',
        '| Règle | Connues | NC | Autorisé | Spécifique | Interdit |',
        '|---|---:|---:|---:|---:|---:|',
    ];
    foreach ($coverage as $type => $counts) {
        $markdown[] = sprintf(
            '| %s | %d | %d | %d | %d | %d |',
            $type,
            $counts['known'],
            $counts['NC'],
            $counts['allowed'],
            $counts['specific'],
            $counts['forbidden'],
        );
    }
    $markdown[] = '';
    $markdown[] = 'Les pages inaccessibles ou protégées par un anti-bot restent NC. Aucun contournement ni déduction.';
    $markdown[] = '';
    $markdown[] = '## Sources officielles contrôlées';
    $markdown[] = '';
    $markdown[] = '| Événement | Type | HTTP | URL |';
    $markdown[] = '|---|---|---:|---|';
    foreach ($auditEvents as $eventAudit) {
        foreach ($eventAudit['sources'] as $sourceAudit) {
            $isSource = $sourceAudit['url'] === $eventAudit['official_source_url'];
            $isRegistration = $sourceAudit['url'] === $eventAudit['official_registration_url'];
            $type = $isSource && $isRegistration
                ? 'source + inscription'
                : ($isRegistration ? 'inscription' : 'source');
            $title = str_replace('|', '\|', (string) $eventAudit['title']);
            $markdown[] = sprintf(
                '| %s | %s | %d | <%s> |',
                $title,
                $type,
                (int) $sourceAudit['status'],
                $sourceAudit['url'],
            );
        }
    }
    file_put_contents($markdownPath, implode("\n", $markdown) . "\n", LOCK_EX);
    fwrite(STDOUT, "\n" . json_encode([
        'events' => 40,
        'rules' => 280,
        'sources' => count($sourceCache),
        'output' => basename($options['output']),
        'report' => basename($reportPath),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
} catch (HttpException $error) {
    enrichmentFail($error->getMessage(), 4);
} catch (Throwable $error) {
    enrichmentFail($error->getMessage(), 5);
}
