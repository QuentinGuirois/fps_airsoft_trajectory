<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Services\RateLimiter;
use Fat\Api\Services\SessionService;
use Fat\Api\Services\UploadService;
use Fat\Api\Support;
use Fat\Api\Validation\CurveThumbnail;
use Fat\Api\Validation\SimulationUrl;
use Fat\Api\Validation\Validator;
use PDO;

final class ReplicaController
{
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
        private readonly UploadService $uploads,
    ) {
    }

    public function list(Request $request): never
    {
        $session = $this->sessions->require($request);
        $statement = $this->db->prepare('SELECT * FROM replica_posts WHERE user_id=? ORDER BY created_at DESC');
        $statement->execute([$session['id']]);
        Response::json(['replicas' => array_map(fn(array $row): array => $this->present($row, $session), $statement->fetchAll())]);
    }

    public function get(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        Response::json(['replica' => $this->owned($params['id'], $session)]);
    }

    public function create(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('replica_create', $session['id'], 20, 3600);
        $body = $request->json();
        Validator::keys($body, ['modelName','type','simulationUrl','massG','energyJ','usefulRangeM','maximumRangeM','youtubeUrl','curveThumbnailSvg','rightsConfirmed'], ['modelName','type','simulationUrl','rightsConfirmed']);
        Validator::boolTrue($body['rightsConfirmed'], 'La confirmation des droits');
        $simulation = SimulationUrl::parse($body['simulationUrl'], $this->config);
        $this->assertMeasurementMatch($body, $simulation);
        $name = Validator::text($body['modelName'], 'Le nom de la réplique', 2, 80);
        $type = Validator::text($body['type'], 'Le type de réplique', 2, 24);
        $youtube = $this->youtube($body['youtubeUrl'] ?? null);
        $curve = CurveThumbnail::sanitize($body['curveThumbnailSvg'] ?? null);
        [$usefulRange, $maximumRange] = $this->ranges($body['usefulRangeM'] ?? null, $body['maximumRangeM'] ?? null);
        $id = Support::uuid();
        $slug = substr(str_replace('-', '', $id), 0, 20);
        $statement = $this->db->prepare('INSERT INTO replica_posts (id,user_id,slug,model_name,replica_type,mass_g,energy_j,useful_range_m,maximum_range_m,simulation_url,youtube_url,curve_thumbnail_svg,rights_confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())');
        $statement->execute([$id, $session['id'], $slug, $name, $type, $simulation['massG'], $simulation['energyJ'], $usefulRange, $maximumRange, $simulation['url'], $youtube, $curve]);
        $this->audit->write($request->requestId, $session['id'], 'replica.create', 'replica', $id);
        Response::json(['replica' => $this->owned($id, $session)], 201);
    }

    public function update(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $body = $request->json();
        Validator::keys($body, ['modelName','type','simulationUrl','massG','energyJ','usefulRangeM','maximumRangeM','youtubeUrl','curveThumbnailSvg','restore','version'], ['version']);
        $current = $this->ownedRow($params['id'], $session);
        $version = Validator::version($body['version']);
        $values = [
            'modelName' => $current['model_name'],
            'type' => $current['replica_type'],
            'simulationUrl' => $current['simulation_url'],
            'massG' => (float) $current['mass_g'],
            'energyJ' => (float) $current['energy_j'],
            'usefulRangeM' => $current['useful_range_m'] === null ? null : (float) $current['useful_range_m'],
            'maximumRangeM' => $current['maximum_range_m'] === null ? null : (float) $current['maximum_range_m'],
            'youtubeUrl' => $current['youtube_url'],
            'curveThumbnailSvg' => $current['curve_thumbnail_svg'],
        ];
        foreach ($values as $key => $value) {
            if (array_key_exists($key, $body)) {
                $values[$key] = $body[$key];
            }
        }
        $simulation = SimulationUrl::parse($values['simulationUrl'], $this->config);
        $this->assertMeasurementMatch($values, $simulation);
        [$usefulRange, $maximumRange] = $this->ranges($values['usefulRangeM'], $values['maximumRangeM']);
        $sensitive = $simulation['url'] !== $current['simulation_url']
            || abs($simulation['massG'] - (float) $current['mass_g']) > 0.0001
            || abs($simulation['energyJ'] - (float) $current['energy_j']) > 0.0001
            || Validator::text($values['modelName'], 'Le nom de la réplique', 2, 80) !== $current['model_name']
            || Validator::text($values['type'], 'Le type de réplique', 2, 24) !== $current['replica_type']
            || $usefulRange !== ($current['useful_range_m'] === null ? null : (float) $current['useful_range_m'])
            || $maximumRange !== ($current['maximum_range_m'] === null ? null : (float) $current['maximum_range_m'])
            || CurveThumbnail::sanitize($values['curveThumbnailSvg']) !== $current['curve_thumbnail_svg'];
        $state = $current['state'];
        if (($body['restore'] ?? false) === true && $state === 'archived') {
            $state = 'draft';
        } elseif ($sensitive && $state === 'published') {
            $state = 'pending';
        }
        $statement = $this->db->prepare('UPDATE replica_posts SET model_name=?,replica_type=?,mass_g=?,energy_j=?,useful_range_m=?,maximum_range_m=?,simulation_url=?,youtube_url=?,curve_thumbnail_svg=?,state=?,archived_at=IF(?="archived",archived_at,NULL),version=version+1 WHERE id=? AND user_id=? AND version=?');
        $statement->execute([
            Validator::text($values['modelName'], 'Le nom de la réplique', 2, 80),
            Validator::text($values['type'], 'Le type de réplique', 2, 24),
            $simulation['massG'], $simulation['energyJ'], $usefulRange, $maximumRange, $simulation['url'],
            $this->youtube($values['youtubeUrl']), CurveThumbnail::sanitize($values['curveThumbnailSvg']),
            $state, $state, $params['id'], $session['id'], $version,
        ]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'La card a été modifiée ailleurs. Recharge la page.');
        }
        $this->audit->write($request->requestId, $session['id'], 'replica.update', 'replica', $params['id'], ['pending' => $state === 'pending']);
        Response::json(['replica' => $this->owned($params['id'], $session)]);
    }

    public function archive(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $current = $this->ownedRow($params['id'], $session);
        $body = $request->rawBody === '' ? [] : $request->json();
        Validator::keys($body, ['version']);
        $version = isset($body['version']) ? Validator::version($body['version']) : (int) $current['version'];
        $statement = $this->db->prepare("UPDATE replica_posts SET state='archived',archived_at=UTC_TIMESTAMP(),version=version+1 WHERE id=? AND user_id=? AND version=?");
        $statement->execute([$params['id'], $session['id'], $version]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'La card a été modifiée ailleurs.');
        }
        $this->audit->write($request->requestId, $session['id'], 'replica.archive', 'replica', $params['id']);
        Response::json(['replica' => $this->owned($params['id'], $session)]);
    }

    public function uploadPhoto(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('photo_upload', $session['id'], 12, 3600);
        $result = $this->uploads->queue($session['id'], $params['id'], $request->files['photo'] ?? []);
        $this->audit->write($request->requestId, $session['id'], 'replica.photo_queued', 'replica', $params['id'], ['jobId' => $result['jobId']]);
        Response::json($result, 202);
    }

    public function processingStatus(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $replica = $this->ownedRow($params['id'], $session);
        $job = $this->db->prepare('SELECT id,status,last_error_code,queued_at,started_at,finished_at FROM image_jobs WHERE replica_id=? ORDER BY created_at DESC LIMIT 1');
        $job->execute([$params['id']]);
        Response::json(['imageStatus' => $replica['image_status'], 'job' => $job->fetch() ?: null]);
    }

    public function submit(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $body = $request->json();
        Validator::keys($body, ['version'], ['version']);
        $statement = $this->db->prepare("UPDATE replica_posts SET state='pending',moderation_note=NULL,version=version+1 WHERE id=? AND user_id=? AND version=? AND image_status='ready' AND state IN ('draft','rejected')");
        $statement->execute([$params['id'], $session['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'submit_conflict', 'La card doit être en brouillon, posséder une photo prête et utiliser sa version actuelle.');
        }
        $this->audit->write($request->requestId, $session['id'], 'replica.submit', 'replica', $params['id']);
        Response::json(['replica' => $this->owned($params['id'], $session)]);
    }

    public function image(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $row = $this->ownedRow($params['id'], $session);
        if ($row['image_status'] !== 'ready' || !preg_match('/^[a-f0-9]{24}\.webp$/', (string) $row['image_path'])) {
            throw new HttpException(404, 'image_not_found', 'Image indisponible.');
        }
        Response::webp($this->config->storagePath('images' . DIRECTORY_SEPARATOR . $row['image_path']));
    }

    /** @param array<string,mixed> $session @return array<string,mixed> */
    private function owned(string $id, array $session): array
    {
        return $this->present($this->ownedRow($id, $session), $session);
    }

    /** @param array<string,mixed> $session @return array<string,mixed> */
    private function ownedRow(string $id, array $session): array
    {
        $statement = $this->db->prepare('SELECT * FROM replica_posts WHERE id=? AND user_id=? LIMIT 1');
        $statement->execute([$id, $session['id']]);
        $row = $statement->fetch();
        if (!$row) {
            throw new HttpException(404, 'replica_not_found', 'Réplique introuvable.');
        }
        return $row;
    }

    /** @param array<string,mixed> $row @param array<string,mixed> $session @return array<string,mixed> */
    private function present(array $row, array $session): array
    {
        return [
            'id' => $row['id'], 'name' => $row['model_name'], 'type' => $row['replica_type'],
            'state' => $row['state'], 'imageStatus' => $row['image_status'],
            'photoUrl' => $row['image_status'] === 'ready' ? '/api/v1/replicas/' . $row['id'] . '/image.webp' : '',
            'massG' => (float) $row['mass_g'], 'energyJ' => (float) $row['energy_j'],
            'usefulRangeM' => $row['useful_range_m'] === null ? null : (float) $row['useful_range_m'],
            'maximumRangeM' => $row['maximum_range_m'] === null ? null : (float) $row['maximum_range_m'],
            'curveThumbSvg' => $row['curve_thumbnail_svg'] ?? '', 'simUrl' => $row['simulation_url'],
            'version' => (int) $row['version'], 'moderationNote' => $row['moderation_note'],
            'user' => ['pseudo' => $session['pseudo'], 'chrony' => false, 'youtubeUrl' => $row['youtube_url'] ?? ''],
        ];
    }

    /** @param array<string,mixed> $body @param array{url:string,massG:float,energyJ:float} $simulation */
    private function assertMeasurementMatch(array $body, array $simulation): void
    {
        if (isset($body['massG']) && abs((float) $body['massG'] - $simulation['massG']) > 0.0001) {
            throw new HttpException(422, 'measurement_mismatch', 'Le grammage diverge du lien F.A.T.');
        }
        if (isset($body['energyJ']) && abs((float) $body['energyJ'] - $simulation['energyJ']) > 0.0001) {
            throw new HttpException(422, 'measurement_mismatch', 'L’énergie diverge du lien F.A.T.');
        }
    }

    private function youtube(mixed $value): ?string
    {
        $url = trim((string) $value);
        if ($url === '') {
            return null;
        }
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $host = preg_replace('/^www\./', '', $host) ?? $host;
        if (($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) || !in_array($host, ['youtube.com','m.youtube.com','youtu.be'], true)) {
            throw new HttpException(422, 'youtube_url', 'Le lien optionnel doit être une URL YouTube HTTPS.');
        }
        return $url;
    }

    /** @return array{?float,?float} */
    private function ranges(mixed $useful, mixed $maximum): array
    {
        $parse = static function (mixed $value, string $label): ?float {
            if ($value === null || $value === '') {
                return null;
            }
            if (!is_int($value) && !is_float($value) && !is_string($value)) {
                throw new HttpException(422, 'validation', "{$label} est invalide.");
            }
            $number = filter_var($value, FILTER_VALIDATE_FLOAT);
            if ($number === false || !is_finite((float) $number) || $number < 0 || $number > 1000) {
                throw new HttpException(422, 'validation', "{$label} est invalide.");
            }
            return round((float) $number, 2);
        };
        $usefulValue = $parse($useful, 'La portée utile');
        $maximumValue = $parse($maximum, 'La portée maximale');
        if ($usefulValue !== null && $maximumValue !== null && $usefulValue > $maximumValue) {
            throw new HttpException(422, 'validation', 'La portée utile ne peut pas dépasser la portée maximale.');
        }
        return [$usefulValue, $maximumValue];
    }
}
