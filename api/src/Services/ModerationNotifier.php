<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use PDO;

final class ModerationNotifier
{
    public function __construct(
        private readonly PDO $db,
        private readonly Mailer $mailer,
        private readonly TransactionalEmailFactory $emails,
    ) {
    }

    public function replicaPending(string $replicaId): void
    {
        $replica = $this->db->prepare('SELECT r.model_name,r.replica_type,u.pseudo FROM replica_posts r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.state="pending" LIMIT 1');
        $replica->execute([$replicaId]);
        $card = $replica->fetch();
        if (!is_array($card)) {
            return;
        }

        $admins = $this->db->query("SELECT email FROM users WHERE role='admin' AND email_verified_at IS NOT NULL AND deletion_requested_at IS NULL ORDER BY created_at ASC");
        $recipients = $admins ? $admins->fetchAll(PDO::FETCH_COLUMN) : [];
        if ($recipients === []) {
            return;
        }

        $message = $this->emails->moderation(
            (string) $card['pseudo'],
            (string) $card['model_name'],
            (string) $card['replica_type'],
        );
        foreach (array_unique(array_filter($recipients, 'is_string')) as $recipient) {
            try {
                $this->mailer->send($recipient, $message);
            } catch (\Throwable $error) {
                error_log('FAT moderation notification ' . get_class($error));
            }
        }
    }
}
