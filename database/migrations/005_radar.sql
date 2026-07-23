CREATE TABLE IF NOT EXISTS radar_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('draft','published','cancelled','expired','deleted') NOT NULL DEFAULT 'draft',
  moderation_state ENUM('visible','hidden') NOT NULL DEFAULT 'visible',
  title VARCHAR(120) NOT NULL,
  venue_name VARCHAR(120) NULL,
  short_description VARCHAR(800) NULL,
  starts_at_utc DATETIME NULL,
  ends_at_utc DATETIME NULL,
  timezone VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Europe/Paris',
  scenario VARCHAR(120) NULL,
  level_label VARCHAR(80) NULL,
  beginners_welcome TINYINT(1) NOT NULL DEFAULT 0,
  max_capacity SMALLINT UNSIGNED NULL,
  price_cents INT UNSIGNED NULL,
  minimum_age TINYINT UNSIGNED NULL,
  rental_details VARCHAR(255) NULL,
  catering_details VARCHAR(255) NULL,
  toilets_available TINYINT(1) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  location_method ENUM('geocoded','manual') NULL,
  location_confirmed_at DATETIME NULL,
  location_visibility ENUM('exact','approximate') NOT NULL DEFAULT 'exact',
  exact_address VARCHAR(255) NULL,
  public_location_label VARCHAR(160) NULL,
  city VARCHAR(120) NULL,
  postal_code VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  department_code VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  department VARCHAR(120) NULL,
  region VARCHAR(120) NULL,
  registration_url VARCHAR(2048) NULL,
  contact_email_ciphertext VARBINARY(512) NULL,
  hidden_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  hidden_reason VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  expires_at DATETIME NULL,
  hidden_at DATETIME NULL,
  restored_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radar_event_slug (slug),
  KEY idx_radar_event_public (state, moderation_state, ends_at_utc, starts_at_utc),
  KEY idx_radar_event_owner (user_id, state, updated_at),
  KEY idx_radar_event_region (region, department_code, starts_at_utc),
  KEY idx_radar_event_coordinates (latitude, longitude),
  KEY idx_radar_event_hidden_by (hidden_by),
  CONSTRAINT fk_radar_event_owner FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_radar_event_hidden_by FOREIGN KEY (hidden_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_radar_event_timezone CHECK (timezone = 'Europe/Paris'),
  CONSTRAINT chk_radar_event_dates CHECK (
    (starts_at_utc IS NULL AND ends_at_utc IS NULL)
    OR (starts_at_utc IS NOT NULL AND ends_at_utc IS NOT NULL AND ends_at_utc > starts_at_utc)
  ),
  CONSTRAINT chk_radar_event_capacity CHECK (max_capacity IS NULL OR max_capacity BETWEEN 1 AND 5000),
  CONSTRAINT chk_radar_event_toilets CHECK (toilets_available IS NULL OR toilets_available IN (0,1)),
  CONSTRAINT chk_radar_event_age CHECK (minimum_age IS NULL OR minimum_age BETWEEN 10 AND 99),
  CONSTRAINT chk_radar_event_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL AND location_method IS NULL AND location_confirmed_at IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
      AND location_method IS NOT NULL
    )
  ),
  CONSTRAINT chk_radar_event_publication CHECK (
    state <> 'published'
    OR (
      starts_at_utc IS NOT NULL
      AND ends_at_utc IS NOT NULL
      AND max_capacity IS NOT NULL
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND location_confirmed_at IS NOT NULL
      AND registration_url IS NOT NULL
      AND public_location_label IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radar_event_rules (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_type ENUM('assault','dmr','sniper','cqb','detonating_grenades','co2_grenades','smoke_grenades') NOT NULL,
  rule_state ENUM('allowed','specific','forbidden','not_communicated') NOT NULL DEFAULT 'not_communicated',
  joules DECIMAL(4,2) NULL,
  details VARCHAR(240) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, rule_type),
  KEY idx_radar_rules_filter (rule_type, rule_state),
  CONSTRAINT fk_radar_rules_event FOREIGN KEY (event_id) REFERENCES radar_events (id) ON DELETE CASCADE,
  CONSTRAINT chk_radar_rule_joules CHECK (joules IS NULL OR joules BETWEEN 0.01 AND 10.00)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radar_event_links (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  link_type ENUM('website','facebook','helloasso','discord','instagram') NOT NULL,
  url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_radar_event_link_type (event_id, link_type),
  KEY idx_radar_event_links_order (event_id, sort_order),
  CONSTRAINT fk_radar_links_event FOREIGN KEY (event_id) REFERENCES radar_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radar_event_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason ENUM('outdated','wrong_location','wrong_rules','duplicate','unsafe','other') NOT NULL,
  message VARCHAR(1000) NULL,
  reporter_key_hash BINARY(32) NOT NULL,
  status ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  reviewed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_radar_reports_status (status, created_at),
  KEY idx_radar_reports_event (event_id, created_at),
  KEY idx_radar_reports_reviewer (reviewed_by),
  CONSTRAINT fk_radar_reports_event FOREIGN KEY (event_id) REFERENCES radar_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_radar_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radar_geocoding_cache (
  query_hash BINARY(32) NOT NULL,
  response_json JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (query_hash),
  KEY idx_radar_geocoding_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
