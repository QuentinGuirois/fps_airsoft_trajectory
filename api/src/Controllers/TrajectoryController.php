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
use Fat\Api\Support;
use Fat\Api\Validation\CurveThumbnail;
use Fat\Api\Validation\SimulationUrl;
use Fat\Api\Validation\Validator;
use PDO;

final class TrajectoryController
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
        $session = $this->sessions->require($request);
        $statement = $this->db->prepare('SELECT * FROM saved_trajectories WHERE user_id=? ORDER BY created_at DESC LIMIT 50');
        $statement->execute([$session['id']]);
        Response::json(['trajectories' => array_map([$this, 'present'], $statement->fetchAll())]);
    }

    public function create(Request $request): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $this->limits->hit('trajectory_create', $session['id'], 60, 3600);
        $body = $request->json();
        Validator::keys($body, ['name','simulationUrl','massG','energyJ','usefulRangeM','maximumRangeM','curveThumbnailSvg'], ['name','simulationUrl','curveThumbnailSvg']);
        $count = $this->db->prepare('SELECT COUNT(*) FROM saved_trajectories WHERE user_id=?');
        $count->execute([$session['id']]);
        if ((int) $count->fetchColumn() >= 50) {
            throw new HttpException(409, 'trajectory_quota', 'Ton espace contient déjà 50 courbes. Supprime une ancienne courbe avant d’enregistrer celle-ci.');
        }
        $simulation = SimulationUrl::parse($body['simulationUrl'], $this->config);
        $this->assertMeasurementMatch($body, $simulation);
        [$usefulRange, $maximumRange] = $this->ranges($body['usefulRangeM'] ?? null, $body['maximumRangeM'] ?? null);
        $id = Support::uuid();
        $statement = $this->db->prepare(
            'INSERT INTO saved_trajectories (id,user_id,name,simulation_url,mass_g,energy_j,useful_range_m,maximum_range_m,curve_thumbnail_svg) VALUES (?,?,?,?,?,?,?,?,?)'
        );
        $statement->execute([
            $id, $session['id'], Validator::text($body['name'], 'Le nom de la courbe', 2, 80),
            $simulation['url'], $simulation['massG'], $simulation['energyJ'], $usefulRange, $maximumRange,
            CurveThumbnail::sanitize($body['curveThumbnailSvg']),
        ]);
        $this->audit->write($request->requestId, $session['id'], 'trajectory.create', 'trajectory', $id);
        Response::json(['trajectory' => $this->owned($id, $session['id'])], 201);
    }

    public function delete(Request $request, array $params): never
    {
        $session = $this->sessions->require($request);
        $this->sessions->requireCsrf($request, $session);
        $statement = $this->db->prepare('DELETE FROM saved_trajectories WHERE id=? AND user_id=?');
        $statement->execute([$params['id'], $session['id']]);
        if ($statement->rowCount() !== 1) {
            throw new HttpException(404, 'trajectory_not_found', 'Courbe enregistrée introuvable.');
        }
        $this->audit->write($request->requestId, $session['id'], 'trajectory.delete', 'trajectory', $params['id']);
        Response::noContent();
    }

    /** @return array<string,mixed> */
    private function owned(string $id, string $userId): array
    {
        $statement = $this->db->prepare('SELECT * FROM saved_trajectories WHERE id=? AND user_id=? LIMIT 1');
        $statement->execute([$id, $userId]);
        $row = $statement->fetch();
        if (!$row) throw new HttpException(404, 'trajectory_not_found', 'Courbe enregistrée introuvable.');
        return $this->present($row);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function present(array $row): array
    {
        return [
            'id' => $row['id'], 'name' => $row['name'], 'simUrl' => $row['simulation_url'],
            'massG' => (float) $row['mass_g'], 'energyJ' => (float) $row['energy_j'],
            'usefulRangeM' => $row['useful_range_m'] === null ? null : (float) $row['useful_range_m'],
            'maximumRangeM' => $row['maximum_range_m'] === null ? null : (float) $row['maximum_range_m'],
            'curveThumbSvg' => $row['curve_thumbnail_svg'], 'createdAt' => $row['created_at'],
        ];
    }

    /** @param array<string,mixed> $body @param array{url:string,massG:float,energyJ:float} $simulation */
    private function assertMeasurementMatch(array $body, array $simulation): void
    {
        foreach ([['massG','massG','Le grammage'], ['energyJ','energyJ','L’énergie']] as [$input, $parsed, $label]) {
            if (isset($body[$input]) && abs((float) $body[$input] - $simulation[$parsed]) > 0.0001) {
                throw new HttpException(422, 'measurement_mismatch', $label . ' diverge de l’URL F.A.T.');
            }
        }
    }

    /** @return array{?float,?float} */
    private function ranges(mixed $useful, mixed $maximum): array
    {
        $parse = static function (mixed $value, string $label): ?float {
            if ($value === null || $value === '') return null;
            $number = filter_var($value, FILTER_VALIDATE_FLOAT);
            if ($number === false || !is_finite((float) $number) || $number < 0 || $number > 1000) {
                throw new HttpException(422, 'validation', $label . ' est invalide.');
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
