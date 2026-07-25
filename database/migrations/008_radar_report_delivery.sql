ALTER TABLE radar_event_reports
    ADD COLUMN notification_sent_at DATETIME NULL AFTER reviewed_at,
    ADD COLUMN notification_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER notification_sent_at,
    ADD COLUMN notification_last_attempt_at DATETIME NULL AFTER notification_attempts,
    ADD INDEX idx_radar_reports_notification (
        status,
        notification_sent_at,
        notification_last_attempt_at,
        created_at
    );
