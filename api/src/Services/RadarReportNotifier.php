<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use Fat\Api\Config;
use PDO;

final class RadarReportNotifier
{
    private const REASON_LABELS = [
        'outdated' => 'Information périmée',
        'wrong_location' => 'Lieu incorrect',
        'wrong_rules' => 'Règles incorrectes',
        'duplicate' => 'Doublon',
        'unsafe' => 'Problème de sécurité',
        'other' => 'Autre motif',
    ];

    public function __construct(
        private readonly Config $config,
        private readonly PDO $db,
        private readonly Mailer $mailer,
    ) {
    }

    public function notifyStored(string $reportId): bool
    {
        $statement = $this->db->prepare(
            'SELECT p.id,p.reason,p.message,p.notification_sent_at,r.slug,r.title '
            . 'FROM radar_event_reports p JOIN radar_events r ON r.id=p.event_id WHERE p.id=? LIMIT 1'
        );
        $statement->execute([$reportId]);
        $report = $statement->fetch();
        if (!is_array($report) || $report['notification_sent_at'] !== null) {
            return false;
        }
        try {
            $this->send(
                (string) $report['id'],
                (string) $report['slug'],
                (string) $report['title'],
                (string) $report['reason'],
                $report['message'] === null ? null : (string) $report['message'],
            );
            $delivered = $this->db->prepare(
                'UPDATE radar_event_reports SET notification_sent_at=UTC_TIMESTAMP(),'
                . 'notification_attempts=notification_attempts+1,notification_last_attempt_at=UTC_TIMESTAMP() '
                . 'WHERE id=? AND notification_sent_at IS NULL'
            );
            $delivered->execute([$reportId]);
            return $delivered->rowCount() === 1;
        } catch (\Throwable $error) {
            $failed = $this->db->prepare(
                'UPDATE radar_event_reports SET notification_attempts=notification_attempts+1,'
                . 'notification_last_attempt_at=UTC_TIMESTAMP() WHERE id=? AND notification_sent_at IS NULL'
            );
            $failed->execute([$reportId]);
            error_log('FAT radar report notification ' . get_class($error));
            return false;
        }
    }

    public function flushPending(int $limit = 50): int
    {
        $limit = max(1, min(100, $limit));
        $pending = $this->db->query(
            "SELECT id FROM radar_event_reports WHERE status='open' AND notification_sent_at IS NULL "
            . 'AND notification_attempts<10 AND (notification_last_attempt_at IS NULL '
            . 'OR notification_last_attempt_at<UTC_TIMESTAMP()-INTERVAL 5 MINUTE) '
            . 'ORDER BY created_at ASC LIMIT ' . $limit
        );
        $sent = 0;
        foreach ($pending ? $pending->fetchAll(PDO::FETCH_COLUMN) : [] as $reportId) {
            if (is_string($reportId) && $this->notifyStored($reportId)) {
                $sent++;
            }
        }
        return $sent;
    }

    private function send(
        string $reportId,
        string $eventSlug,
        string $eventTitle,
        string $reason,
        ?string $details,
    ): void {
        $recipient = $this->config->get(
            'MAIL_CONTACT_TO',
            $this->config->get('MAIL_REPLY_TO', 'contact@fps-airsoft-trajectory.com'),
        );
        $label = self::REASON_LABELS[$reason] ?? 'Motif non reconnu';
        $detailText = $details === null || trim($details) === '' ? 'Aucun détail fourni.' : trim($details);
        $eventUrl = rtrim($this->config->get('APP_ORIGIN'), '/') . '/parties-airsoft/' . rawurlencode($eventSlug) . '/';
        $adminUrl = rtrim($this->config->get('APP_ORIGIN'), '/') . '/compte/mes-parties.html';
        $text = implode("\n", [
            'Nouveau signalement Radar F.A.T.',
            '',
            'Partie : ' . $eventTitle,
            'Motif : ' . $label,
            'Détail : ' . $detailText,
            'Fiche : ' . $eventUrl,
            'Administration : ' . $adminUrl,
            'Identifiant du signalement : ' . $reportId,
        ]);
        $escape = static fn(string $value): string => htmlspecialchars(
            $value,
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8',
        );
        $html = '<!doctype html><html lang="fr"><body>'
            . '<h1>Nouveau signalement Radar F.A.T.</h1>'
            . '<p><strong>Partie :</strong> ' . $escape($eventTitle) . '</p>'
            . '<p><strong>Motif :</strong> ' . $escape($label) . '</p>'
            . '<p><strong>Détail :</strong> ' . nl2br($escape($detailText), false) . '</p>'
            . '<p><a href="' . $escape($eventUrl) . '">Voir la fiche</a> · '
            . '<a href="' . $escape($adminUrl) . '">Ouvrir l’administration</a></p>'
            . '<p>Identifiant : ' . $escape($reportId) . '</p>'
            . '</body></html>';
        $this->mailer->send(
            $recipient,
            new EmailMessage('[F.A.T.] Signalement Radar — ' . $eventTitle, $text, $html),
        );
    }
}
