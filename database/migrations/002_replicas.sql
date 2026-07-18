CREATE TABLE IF NOT EXISTS replica_posts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  model_name VARCHAR(80) NOT NULL,
  replica_type VARCHAR(24) NOT NULL,
  mass_g DECIMAL(5,2) NOT NULL,
  energy_j DECIMAL(6,3) NOT NULL,
  useful_range_m DECIMAL(6,2) NULL,
  maximum_range_m DECIMAL(6,2) NULL,
  simulation_url VARCHAR(2048) NOT NULL,
  youtube_url VARCHAR(512) NULL,
  curve_thumbnail_svg MEDIUMTEXT NULL,
  state ENUM('draft','pending','published','rejected','archived') NOT NULL DEFAULT 'draft',
  image_status ENUM('queued','processing','ready','rejected') NOT NULL DEFAULT 'queued',
  image_path VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  image_mime VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  image_bytes INT UNSIGNED NULL,
  image_width SMALLINT UNSIGNED NULL,
  image_height SMALLINT UNSIGNED NULL,
  image_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  image_scores_json JSON NULL,
  image_generated_at DATETIME NULL,
  rights_confirmed_at DATETIME NOT NULL,
  moderation_note VARCHAR(500) NULL,
  moderated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  moderated_at DATETIME NULL,
  archived_at DATETIME NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_replica_slug (slug),
  UNIQUE KEY uq_replica_image_path (image_path),
  KEY idx_replica_owner_state (user_id, state, created_at),
  KEY idx_replica_moderation (state, created_at),
  KEY idx_replica_image_hash (image_sha256),
  CONSTRAINT fk_replica_owner FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_replica_moderator FOREIGN KEY (moderated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_replica_image_mime CHECK (image_mime IS NULL OR image_mime = 'image/webp'),
  CONSTRAINT chk_replica_image_bytes CHECK (image_bytes IS NULL OR image_bytes BETWEEN 1 AND 102400),
  CONSTRAINT chk_replica_ready_image CHECK (
    (image_status = 'ready' AND image_path IS NOT NULL AND image_mime = 'image/webp'
      AND image_bytes BETWEEN 1 AND 102400 AND image_width > 0 AND image_height > 0
      AND image_sha256 IS NOT NULL AND image_generated_at IS NOT NULL)
    OR
    (image_status <> 'ready' AND image_path IS NULL AND image_mime IS NULL
      AND image_bytes IS NULL AND image_width IS NULL AND image_height IS NULL
      AND image_sha256 IS NULL AND image_generated_at IS NULL)
  ),
  CONSTRAINT chk_replica_published CHECK (state <> 'published' OR image_status = 'ready')
  ,CONSTRAINT chk_replica_ranges CHECK (
    (useful_range_m IS NULL OR useful_range_m BETWEEN 0 AND 1000)
    AND (maximum_range_m IS NULL OR maximum_range_m BETWEEN 0 AND 1000)
    AND (useful_range_m IS NULL OR maximum_range_m IS NULL OR useful_range_m <= maximum_range_m)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_jobs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replica_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('queued','processing','ready','rejected') NOT NULL DEFAULT 'queued',
  source_extension VARCHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_json JSON NULL,
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_image_jobs_status (status, queued_at),
  KEY idx_image_jobs_replica (replica_id, created_at),
  CONSTRAINT fk_image_jobs_replica FOREIGN KEY (replica_id) REFERENCES replica_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS replica_image_retention (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  replica_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_path VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_bytes INT UNSIGNED NOT NULL,
  image_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delete_after DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_replica_retained_path (image_path),
  KEY idx_replica_retention_delete (delete_after),
  CONSTRAINT chk_replica_retained_bytes CHECK (image_bytes BETWEEN 1 AND 102400),
  CONSTRAINT fk_replica_retention_post FOREIGN KEY (replica_id) REFERENCES replica_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
