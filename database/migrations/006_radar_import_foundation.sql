ALTER TABLE radar_events
  ADD COLUMN IF NOT EXISTS external_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS organizer_name VARCHAR(160) NULL AFTER title,
  ADD COLUMN IF NOT EXISTS organizer_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER organizer_name,
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER organizer_type,
  ADD COLUMN IF NOT EXISTS terrain_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER event_type,
  ADD COLUMN IF NOT EXISTS price_min_cents INT UNSIGNED NULL AFTER price_cents,
  ADD COLUMN IF NOT EXISTS price_max_cents INT UNSIGNED NULL AFTER price_min_cents,
  ADD COLUMN IF NOT EXISTS record_visibility ENUM('public','admin_preview_only','private') NOT NULL DEFAULT 'private' AFTER moderation_state,
  ADD COLUMN IF NOT EXISTS claim_state ENUM('unclaimed','pending','approved','rejected') NOT NULL DEFAULT 'unclaimed' AFTER record_visibility,
  ADD COLUMN IF NOT EXISTS location_precision ENUM('street','locality','city','undisclosed') NULL AFTER location_visibility,
  ADD COLUMN IF NOT EXISTS geocode_status ENUM('not_requested','validated','needs_review') NOT NULL DEFAULT 'not_requested' AFTER location_precision,
  ADD COLUMN IF NOT EXISTS geocode_checked_at DATETIME NULL AFTER geocode_status,
  ADD COLUMN IF NOT EXISTS schedule_precision ENUM('datetime','date') NOT NULL DEFAULT 'datetime' AFTER timezone,
  ADD COLUMN IF NOT EXISTS requires_pre_publication_check TINYINT(1) NOT NULL DEFAULT 0 AFTER registration_url,
  ADD COLUMN IF NOT EXISTS last_source_verified_at DATETIME NULL AFTER requires_pre_publication_check,
  ADD COLUMN IF NOT EXISTS pre_publication_checked_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER last_source_verified_at,
  ADD COLUMN IF NOT EXISTS pre_publication_checked_at DATETIME NULL AFTER pre_publication_checked_by,
  ADD COLUMN IF NOT EXISTS is_fixture TINYINT(1) NOT NULL DEFAULT 0 AFTER pre_publication_checked_at,
  ADD COLUMN IF NOT EXISTS import_batch_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER is_fixture,
  ADD UNIQUE INDEX IF NOT EXISTS uq_radar_event_external_key (external_key),
  ADD INDEX IF NOT EXISTS idx_radar_event_visibility (state, record_visibility, starts_at_utc),
  ADD INDEX IF NOT EXISTS idx_radar_event_place (department_code, city, starts_at_utc),
  ADD INDEX IF NOT EXISTS idx_radar_event_import_review (is_fixture, requires_pre_publication_check, geocode_status, state),
  ADD INDEX IF NOT EXISTS idx_radar_event_checked_by (pre_publication_checked_by),
  ADD CONSTRAINT fk_radar_event_checked_by FOREIGN KEY (pre_publication_checked_by) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE radar_events
  MODIFY latitude DECIMAL(9,6) NULL,
  MODIFY longitude DECIMAL(9,6) NULL;

UPDATE radar_events
SET record_visibility = CASE WHEN state IN ('published','cancelled') THEN 'public' ELSE 'private' END
WHERE external_key IS NULL;

UPDATE radar_events
SET location_precision = CASE
  WHEN latitude IS NULL OR longitude IS NULL THEN NULL
  WHEN location_visibility = 'exact' THEN 'street'
  ELSE 'locality'
END
WHERE location_precision IS NULL;

ALTER TABLE radar_events
  DROP CONSTRAINT IF EXISTS chk_radar_event_publication;

ALTER TABLE radar_events
  ADD CONSTRAINT chk_radar_event_publication CHECK (
    state <> 'published'
    OR (
      record_visibility = 'public'
      AND is_fixture = 0
      AND requires_pre_publication_check = 0
      AND starts_at_utc IS NOT NULL
      AND ends_at_utc IS NOT NULL
      AND registration_url IS NOT NULL
      AND public_location_label IS NOT NULL
      AND published_at IS NOT NULL
      AND (
        (
          location_precision = 'undisclosed'
          AND latitude IS NULL
          AND longitude IS NULL
        )
        OR (
          location_precision <> 'undisclosed'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND location_confirmed_at IS NOT NULL
        )
      )
    )
  );

CREATE TABLE IF NOT EXISTS radar_event_sources (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_url VARCHAR(2048) NOT NULL,
  registration_url VARCHAR(2048) NULL,
  source_tier ENUM('primary','secondary') NOT NULL,
  source_locator VARCHAR(500) NULL,
  last_verified_at DATETIME NULL,
  source_fingerprint BINARY(32) NOT NULL,
  requires_pre_publication_check TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radar_source_event_url (event_id, source_fingerprint),
  KEY idx_radar_source_review (source_tier, requires_pre_publication_check, last_verified_at),
  KEY idx_radar_source_event (event_id, updated_at),
  CONSTRAINT fk_radar_source_event FOREIGN KEY (event_id) REFERENCES radar_events (id) ON DELETE CASCADE,
  CONSTRAINT chk_radar_source_review CHECK (requires_pre_publication_check IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radar_event_claims (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claimant_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  proof_ciphertext VARBINARY(2048) NULL,
  reviewed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radar_claim_pending (event_id, claimant_user_id, status),
  KEY idx_radar_claim_status (status, created_at),
  KEY idx_radar_claim_reviewer (reviewed_by),
  CONSTRAINT fk_radar_claim_event FOREIGN KEY (event_id) REFERENCES radar_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_radar_claim_user FOREIGN KEY (claimant_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_radar_claim_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
