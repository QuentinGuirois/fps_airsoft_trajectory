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
  image_original_path VARCHAR(512) NOT NULL,
  image_public_path VARCHAR(512) NULL,
  image_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_media_type ENUM('image/jpeg','image/png','image/webp') NOT NULL,
  status ENUM('pending','published','rejected','deleted') NOT NULL DEFAULT 'pending',
  rights_confirmed_at DATETIME NOT NULL,
  moderation_note VARCHAR(500) NULL,
  moderated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_replica_slug (slug),
  KEY idx_replica_status_created (status, created_at),
  KEY idx_replica_image_hash (image_sha256)
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
  status ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_replica_jobs_status (status, created_at),
  CONSTRAINT fk_replica_image_jobs_post FOREIGN KEY (replica_id)
    REFERENCES replica_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
