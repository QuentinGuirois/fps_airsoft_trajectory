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
use Fat\Api\Validation\CurveThumbnail;
use Fat\Api\Validation\SimulationUrl;
use Fat\Api\Validation\Validator;
use PDO;

final class AdminController
{
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly SessionService $sessions,
        private readonly RateLimiter $limits,
        private readonly AuditLogger $audit,
    ) {
    }

    public function list(Request $request): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->limits->hit('admin_list', $session['id'], 120, 3600);
        $statement = $this->db->query(
            "SELECT r.*,u.pseudo AS owner_pseudo FROM replica_posts r JOIN users u ON u.id=r.user_id "
            . "WHERE r.state='pending' ORDER BY r.created_at ASC LIMIT 100"
        );
        Response::json(['replicas' => array_map(fn(array $row): array => $this->present($row), $statement->fetchAll())]);
    }

    public function published(Request $request): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->limits->hit('admin_published', $session['id'], 120, 3600);
        $statement = $this->db->query(
            "SELECT r.*,u.pseudo AS owner_pseudo FROM replica_posts r JOIN users u ON u.id=r.user_id "
            . "WHERE r.state='published' ORDER BY r.updated_at DESC LIMIT 250"
        );
        Response::json(['replicas' => array_map(fn(array $row): array => $this->present($row), $statement->fetchAll())]);
    }

    public function update(Request $request, array $params): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_update', $session['id'], 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['modelName','type','simulationUrl','massG','energyJ','usefulRangeM','maximumRangeM','youtubeUrl','curveThumbnailSvg','version'], ['version']);
        $current = $this->row($params['id']);
        $version = Validator::version($body['version']);
        $values = [
            'modelName' => $body['modelName'] ?? $current['model_name'],
            'type' => $body['type'] ?? $current['replica_type'],
            'simulationUrl' => $body['simulationUrl'] ?? $current['simulation_url'],
            'massG' => $body['massG'] ?? (float) $current['mass_g'],
            'energyJ' => $body['energyJ'] ?? (float) $current['energy_j'],
            'usefulRangeM' => $body['usefulRangeM'] ?? $current['useful_range_m'],
            'maximumRangeM' => $body['maximumRangeM'] ?? $current['maximum_range_m'],
            'youtubeUrl' => array_key_exists('youtubeUrl', $body) ? $body['youtubeUrl'] : $current['youtube_url'],
            'curveThumbnailSvg' => array_key_exists('curveThumbnailSvg', $body) ? $body['curveThumbnailSvg'] : $current['curve_thumbnail_svg'],
        ];
        $simulation = SimulationUrl::parse($values['simulationUrl'], $this->config);
        $this->assertMeasurementMatch($values, $simulation);
        $name = Validator::text($values['modelName'], 'Le nom de la réplique', 2, 80);
        $type = Validator::text($values['type'], 'Le type de réplique', 2, 24);
        $youtube = $this->youtube($values['youtubeUrl']);
        $curve = CurveThumbnail::sanitize($values['curveThumbnailSvg']);
        [$usefulRange, $maximumRange] = $this->ranges($values['usefulRangeM'], $values['maximumRangeM']);
        $changed = $name !== $current['model_name'] || $type !== $current['replica_type']
            || $simulation['url'] !== $current['simulation_url']
            || abs($simulation['massG'] - (float) $current['mass_g']) > 0.0001
            || abs($simulation['energyJ'] - (float) $current['energy_j']) > 0.0001
            || $usefulRange !== ($current['useful_range_m'] === null ? null : (float) $current['useful_range_m'])
            || $maximumRange !== ($current['maximum_range_m'] === null ? null : (float) $current['maximum_range_m'])
            || $youtube !== $current['youtube_url'] || $curve !== $current['curve_thumbnail_svg'];
        $state = $changed && $current['state'] === 'published' ? 'pending' : $current['state'];
        $statement = $this->db->prepare(
            "UPDATE replica_posts SET model_name=?,replica_type=?,mass_g=?,energy_j=?,useful_range_m=?,maximum_range_m=?,simulation_url=?,youtube_url=?,curve_thumbnail_svg=?,state=?,"
            . "moderation_note=IF(?='pending',NULL,moderation_note),moderated_by=IF(?='pending',NULL,moderated_by),moderated_at=IF(?='pending',NULL,moderated_at),version=version+1 WHERE id=? AND version=?"
        );
        $statement->execute([
            $name, $type, $simulation['massG'], $simulation['energyJ'], $usefulRange, $maximumRange,
            $simulation['url'], $youtube, $curve, $state, $state, $state, $state, $params['id'], $version,
        ]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'version_conflict', 'La card a été modifiée ailleurs. Recharge la liste.');
        }
        $this->audit->write($request->requestId, $session['id'], 'admin.replica.update', 'replica', $params['id'], ['pending' => $state === 'pending']);
        Response::json(['replica' => $this->present($this->row($params['id']))]);
    }

    public function archive(Request $request, array $params): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_archive', $session['id'], 60, 3600);
        $body = $request->rawBody === '' ? [] : $request->json();
        Validator::keys($body, ['version'], ['version']);
        $statement = $this->db->prepare("UPDATE replica_posts SET state='archived',archived_at=UTC_TIMESTAMP(),version=version+1 WHERE id=? AND version=? AND state<>'archived'");
        $statement->execute([$params['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) throw new HttpException(409, 'archive_conflict', 'La card n’est plus retirable avec cette version.');
        $this->audit->write($request->requestId, $session['id'], 'admin.replica.archive', 'replica', $params['id']);
        Response::json(['replica' => $this->present($this->row($params['id']))]);
    }

    public function restore(Request $request, array $params): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $body = $request->json();
        Validator::keys($body, ['version'], ['version']);
        $statement = $this->db->prepare("UPDATE replica_posts SET state=IF(image_status='ready','pending','draft'),archived_at=NULL,version=version+1 WHERE id=? AND version=? AND state='archived'");
        $statement->execute([$params['id'], Validator::version($body['version'])]);
        if ($statement->rowCount() !== 1) throw new HttpException(409, 'restore_conflict', 'La card n’est plus restaurable avec cette version.');
        $this->audit->write($request->requestId, $session['id'], 'admin.replica.restore', 'replica', $params['id']);
        Response::json(['replica' => $this->present($this->row($params['id']))]);
    }

    public function image(Request $request, array $params): never
    {
        $this->sessions->require($request, 'admin');
        $row = $this->row($params['id']);
        if ($row['image_status'] !== 'ready' || !preg_match('/^[a-f0-9]{24}\.webp$/', (string) $row['image_path'])) {
            throw new HttpException(404, 'image_not_found', 'Image indisponible.');
        }
        Response::webp($this->config->storagePath('images' . DIRECTORY_SEPARATOR . $row['image_path']));
    }

    public function publish(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], true);
    }

    public function reject(Request $request, array $params): never
    {
        $this->moderate($request, $params['id'], false);
    }

    private function moderate(Request $request, string $id, bool $publish): never
    {
        $session = $this->sessions->require($request, 'admin');
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('admin_moderate', $session['id'], 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['version','note'], ['version']);
        $version = Validator::version($body['version']);
        $note = $publish ? null : Validator::text($body['note'] ?? '', 'Le motif de rejet', 3, 500);
        $state = $publish ? 'published' : 'rejected';
        $statement = $this->db->prepare(
            "UPDATE replica_posts SET state=?,moderation_note=?,moderated_by=?,moderated_at=UTC_TIMESTAMP(),version=version+1 "
            . "WHERE id=? AND version=? AND state='pending' AND image_status='ready'"
        );
        $statement->execute([$state, $note, $session['id'], $id, $version]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(409, 'moderation_conflict', 'La card n’est plus modérable avec cette version.');
        }
        $this->audit->write($request->requestId, $session['id'], 'admin.replica.' . $state, 'replica', $id);
        Response::json(['id' => $id, 'state' => $state]);
    }

    /** @return array<string,mixed> */
    private function row(string $id): array
    {
        $statement = $this->db->prepare('SELECT r.*,u.pseudo AS owner_pseudo FROM replica_posts r JOIN users u ON u.id=r.user_id WHERE r.id=? LIMIT 1');
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row) throw new HttpException(404, 'replica_not_found', 'Réplique introuvable.');
        return $row;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function present(array $row): array
    {
        return [
            'id' => $row['id'], 'name' => $row['model_name'], 'type' => $row['replica_type'],
            'state' => $row['state'], 'imageStatus' => $row['image_status'],
            'photoUrl' => $row['image_status'] === 'ready' ? '/api/v1/admin/replicas/' . $row['id'] . '/image.webp' : '',
            'massG' => (float) $row['mass_g'], 'energyJ' => (float) $row['energy_j'],
            'usefulRangeM' => $row['useful_range_m'] === null ? null : (float) $row['useful_range_m'],
            'maximumRangeM' => $row['maximum_range_m'] === null ? null : (float) $row['maximum_range_m'],
            'curveThumbSvg' => $row['curve_thumbnail_svg'] ?? '', 'simUrl' => $row['simulation_url'],
            'version' => (int) $row['version'], 'moderationNote' => $row['moderation_note'],
            'user' => ['pseudo' => $row['owner_pseudo'], 'chrony' => false, 'youtubeUrl' => $row['youtube_url'] ?? ''],
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
        if ($url === '') return null;
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
            if ($value === null || $value === '') return null;
            $number = filter_var($value, FILTER_VALIDATE_FLOAT);
            if ($number === false || !is_finite((float) $number) || $number < 0 || $number > 1000) {
                throw new HttpException(422, 'validation', "{$label} est invalide.");
            }
            return round((float) $number, 2);
        };
        $usefulRange = $parse($useful, 'La portée utile');
        $maximumRange = $parse($maximum, 'La portée maximale');
        if ($usefulRange !== null && $maximumRange !== null && $usefulRange > $maximumRange) {
            throw new HttpException(422, 'validation', 'La portée utile ne peut pas dépasser la portée maximale.');
        }
        return [$usefulRange, $maximumRange];
    }
}
