<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use Fat\Api\HttpException;
use Fat\Api\Support;
use PDO;

final class UploadService
{
    private const MAX_BYTES = 8_388_608;
    private const MAX_PIXELS = 36_000_000;
    private const MIME_EXTENSIONS = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    public function __construct(private readonly PDO $db, private readonly Config $config)
    {
    }

    /** @param array<string,mixed> $file @return array{jobId:string,status:string} */
    public function queue(string $userId, string $replicaId, array $file): array
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        $size = (int) ($file['size'] ?? 0);
        $temporary = (string) ($file['tmp_name'] ?? '');
        if ($error !== UPLOAD_ERR_OK || $size < 1 || $size > self::MAX_BYTES || !is_file($temporary)) {
            throw new HttpException(422, 'upload', 'Photo absente, invalide ou supérieure à 8 Mo.');
        }
        if (PHP_SAPI !== 'cli' && !is_uploaded_file($temporary)) {
            throw new HttpException(422, 'upload', 'Le fichier ne provient pas d’un upload HTTP valide.');
        }
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = strtolower((string) $finfo->file($temporary));
        if (!isset(self::MIME_EXTENSIONS[$mime])) {
            throw new HttpException(422, 'upload_mime', 'Formats acceptés : JPEG, PNG ou WebP.');
        }
        $prefix = file_get_contents($temporary, false, null, 0, min($size, 1_048_576));
        if ($prefix === false || preg_match('/<\?(?:php|=)|<svg\b|<script\b/i', $prefix)) {
            throw new HttpException(422, 'upload_polyglot', 'Le fichier contient des données interdites.');
        }
        $dimensions = @getimagesize($temporary);
        if ($dimensions === false || ($dimensions['mime'] ?? '') !== $mime) {
            throw new HttpException(422, 'upload_decode', 'Le fichier image est indécodable ou incohérent.');
        }
        [$width, $height] = $dimensions;
        if ($width < 1 || $height < 1 || $width * $height > self::MAX_PIXELS || min($width, $height) < 420 || max($width, $height) < 720) {
            throw new HttpException(422, 'upload_dimensions', 'Les dimensions de la photo sont refusées.');
        }
        $queue = $this->config->storagePath('queue');
        if (!is_dir($queue) && !mkdir($queue, 0700, true) && !is_dir($queue)) {
            throw new \RuntimeException('Impossible de créer la file privée.');
        }
        $jobId = Support::uuid();
        $extension = self::MIME_EXTENSIONS[$mime];
        $staging = $queue . DIRECTORY_SEPARATOR . '.' . $jobId . '.uploading';
        $destination = $queue . DIRECTORY_SEPARATOR . $jobId . '.' . $extension;
        $moved = PHP_SAPI === 'cli' ? rename($temporary, $staging) : move_uploaded_file($temporary, $staging);
        if (!$moved || !is_file($staging)) {
            throw new \RuntimeException('Impossible de déplacer l’upload dans la file privée.');
        }
        @chmod($staging, 0600);
        $oldJobs = [];
        try {
            $this->db->beginTransaction();
            $owner = $this->db->prepare('SELECT id,state,image_path,image_bytes,image_sha256 FROM replica_posts WHERE id=? AND user_id=? FOR UPDATE');
            $owner->execute([$replicaId, $userId]);
            $replica = $owner->fetch();
            if (!$replica) {
                throw new HttpException(404, 'replica_not_found', 'Réplique introuvable.');
            }
            $quota = max(102_400, $this->config->int('OWNER_IMAGE_QUOTA_BYTES', 10_485_760));
            $usage = $this->db->prepare(
                'SELECT COALESCE(SUM(image_bytes),0) FROM replica_posts WHERE user_id=? '
                . 'UNION ALL SELECT COALESCE(SUM(r.image_bytes),0) FROM replica_image_retention r JOIN replica_posts p ON p.id=r.replica_id WHERE p.user_id=?'
            );
            $usage->execute([$userId, $userId]);
            $used = array_sum(array_map('intval', $usage->fetchAll(PDO::FETCH_COLUMN)));
            if ($used + 102_400 > $quota) {
                throw new HttpException(422, 'image_quota', 'Le quota d’images du compte est atteint.');
            }
            $jobs = $this->db->prepare("SELECT id,source_extension FROM image_jobs WHERE replica_id=? AND status IN ('queued','processing') FOR UPDATE");
            $jobs->execute([$replicaId]);
            $oldJobs = $jobs->fetchAll();
            $this->db->prepare("UPDATE image_jobs SET status='rejected',last_error_code='replaced',finished_at=UTC_TIMESTAMP() WHERE replica_id=? AND status IN ('queued','processing')")
                ->execute([$replicaId]);
            if ($replica['image_path'] !== null) {
                $retention = $this->db->prepare('INSERT IGNORE INTO replica_image_retention (replica_id,image_path,image_bytes,image_sha256,delete_after) VALUES (?,?,?,?,UTC_TIMESTAMP()+INTERVAL 7 DAY)');
                $retention->execute([$replicaId, $replica['image_path'], $replica['image_bytes'], $replica['image_sha256']]);
            }
            $this->db->prepare('INSERT INTO image_jobs (id,replica_id,source_extension) VALUES (?,?,?)')->execute([$jobId, $replicaId, $extension]);
            $nextState = $replica['state'] === 'published' ? 'pending' : ($replica['state'] === 'archived' ? 'archived' : 'draft');
            $this->db->prepare("UPDATE replica_posts SET state=?,image_status='queued',image_path=NULL,image_mime=NULL,image_bytes=NULL,image_width=NULL,image_height=NULL,image_sha256=NULL,image_scores_json=NULL,image_generated_at=NULL,version=version+1 WHERE id=? AND user_id=?")
                ->execute([$nextState, $replicaId, $userId]);
            if (!rename($staging, $destination)) {
                throw new \RuntimeException('Impossible de finaliser la mise en file.');
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            @unlink($staging);
            @unlink($destination);
            throw $error;
        }
        foreach ($oldJobs as $old) {
            foreach ([$queue . DIRECTORY_SEPARATOR . $old['id'] . '.' . $old['source_extension'], $queue . DIRECTORY_SEPARATOR . $old['id'] . '.' . $old['source_extension'] . '.processing'] as $path) {
                @unlink($path);
            }
        }
        return ['jobId' => $jobId, 'status' => 'queued'];
    }
}
