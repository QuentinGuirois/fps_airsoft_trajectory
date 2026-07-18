<?php
declare(strict_types=1);

namespace Fat\Api\Controllers;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Request;
use Fat\Api\Response;
use PDO;

final class PublicReplicaController
{
    public function __construct(private readonly PDO $db, private readonly Config $config)
    {
    }

    public function list(Request $request): never
    {
        $statement = $this->db->query(
            "SELECT r.*,u.pseudo AS owner_pseudo FROM replica_posts r JOIN users u ON u.id=r.user_id "
            . "WHERE r.state='published' AND r.image_status='ready' ORDER BY r.moderated_at DESC,r.updated_at DESC LIMIT 100"
        );
        Response::json(['replicas' => array_map([$this, 'present'], $statement->fetchAll())], 200, [
            'Cache-Control' => 'public, max-age=60, stale-while-revalidate=300',
            'Pragma' => '',
        ]);
    }

    public function image(Request $request, array $params): never
    {
        $statement = $this->db->prepare("SELECT image_path FROM replica_posts WHERE slug=? AND state='published' AND image_status='ready' LIMIT 1");
        $statement->execute([$params['slug']]);
        $path = $statement->fetchColumn();
        if (!is_string($path) || !preg_match('/^[a-f0-9]{24}\.webp$/', $path)) {
            throw new HttpException(404, 'image_not_found', 'Image indisponible.');
        }
        Response::publicWebp($this->config->storagePath('images' . DIRECTORY_SEPARATOR . $path));
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function present(array $row): array
    {
        return [
            'id' => $row['slug'], 'name' => $row['model_name'], 'type' => $row['replica_type'],
            'state' => 'published', 'imageStatus' => 'ready',
            'photoUrl' => '/api/v1/public/replicas/' . $row['slug'] . '/image.webp',
            'massG' => (float) $row['mass_g'], 'energyJ' => (float) $row['energy_j'],
            'usefulRangeM' => $row['useful_range_m'] === null ? null : (float) $row['useful_range_m'],
            'maximumRangeM' => $row['maximum_range_m'] === null ? null : (float) $row['maximum_range_m'],
            'curveThumbSvg' => $row['curve_thumbnail_svg'] ?? '', 'simUrl' => $row['simulation_url'],
            'user' => ['pseudo' => $row['owner_pseudo'], 'chrony' => false, 'youtubeUrl' => $row['youtube_url'] ?? ''],
        ];
    }
}
