-- F.A.T. — schéma MariaDB de préparation pour les soumissions de répliques.
-- À exécuter dans une base dédiée avec un compte limité à ces tables.
-- Ce schéma ne publie aucune donnée par lui-même.

CREATE TABLE replica_posts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(120) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  pseudo VARCHAR(32) NOT NULL,
  model_name VARCHAR(80) NOT NULL,
  mass_g DECIMAL(5,2) NOT NULL,
  energy_j DECIMAL(6,3) NOT NULL,
  simulation_url VARCHAR(2048) NOT NULL,
  youtube_url VARCHAR(512) NULL,
  image_path VARCHAR(512) NULL,
  image_mime VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  image_bytes INT UNSIGNED NULL,
  image_width SMALLINT UNSIGNED NULL,
  image_height SMALLINT UNSIGNED NULL,
  image_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  image_status ENUM('queued','processing','ready','rejected') NOT NULL DEFAULT 'queued',
  image_generated_at DATETIME NULL,
  status ENUM('pending','published','rejected','deleted') NOT NULL DEFAULT 'pending',
  rights_confirmed_at DATETIME NOT NULL,
  moderation_note VARCHAR(500) NULL,
  moderated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_replica_slug (slug),
  UNIQUE KEY uq_replica_image_path (image_path),
  KEY idx_replica_status_created (status, created_at),
  KEY idx_replica_image_hash (image_sha256),
  CONSTRAINT chk_replica_image_mime CHECK (image_mime IS NULL OR image_mime = 'image/webp'),
  CONSTRAINT chk_replica_image_bytes CHECK (image_bytes IS NULL OR image_bytes <= 102400),
  CONSTRAINT chk_replica_ready_image CHECK (
    (
      image_status = 'ready'
      AND image_path IS NOT NULL
      AND image_mime = 'image/webp'
      AND image_bytes BETWEEN 1 AND 102400
      AND image_width > 0
      AND image_height > 0
      AND image_sha256 IS NOT NULL
      AND image_generated_at IS NOT NULL
    ) OR (
      image_status <> 'ready'
      AND image_path IS NULL
      AND image_mime IS NULL
      AND image_bytes IS NULL
      AND image_width IS NULL
      AND image_height IS NULL
      AND image_sha256 IS NULL
      AND image_generated_at IS NULL
    )
  ),
  CONSTRAINT chk_replica_published_image CHECK (status <> 'published' OR image_status = 'ready')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE replica_rate_limits (
  ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_start DATETIME NOT NULL,
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

CREATE TABLE replica_image_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  replica_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('queued','processing','ready','rejected') NOT NULL DEFAULT 'queued',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_replica_jobs_status (status, created_at),
  CONSTRAINT fk_replica_image_jobs_post FOREIGN KEY (replica_id)
    REFERENCES replica_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le propriétaire est une clé opaque dérivée côté serveur, jamais une IP brute.
CREATE TABLE replica_storage_quotas (
  owner_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active_image_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  retained_image_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  card_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une ancienne image n'entre ici qu'après bascule atomique vers le nouveau WebP.
-- Elle reste privée jusqu'à delete_after et compte dans retained_image_bytes.
CREATE TABLE replica_image_retention (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  replica_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_path VARCHAR(512) NOT NULL,
  image_bytes INT UNSIGNED NOT NULL,
  image_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delete_after DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_replica_retained_path (image_path),
  KEY idx_replica_retention_delete (delete_after),
  CONSTRAINT chk_replica_retained_bytes CHECK (image_bytes BETWEEN 1 AND 102400),
  CONSTRAINT fk_replica_retention_post FOREIGN KEY (replica_id)
    REFERENCES replica_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
