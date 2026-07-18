CREATE TABLE saved_trajectories (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  simulation_url VARCHAR(2048) NOT NULL,
  mass_g DECIMAL(5,2) NOT NULL,
  energy_j DECIMAL(6,3) NOT NULL,
  useful_range_m DECIMAL(6,2) NULL,
  maximum_range_m DECIMAL(6,2) NULL,
  curve_thumbnail_svg MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_saved_trajectory_owner (user_id, created_at),
  CONSTRAINT fk_saved_trajectory_owner FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_saved_trajectory_ranges CHECK (
    (useful_range_m IS NULL OR useful_range_m BETWEEN 0 AND 1000)
    AND (maximum_range_m IS NULL OR maximum_range_m BETWEEN 0 AND 1000)
    AND (useful_range_m IS NULL OR maximum_range_m IS NULL OR useful_range_m <= maximum_range_m)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE replica_posts
  ADD COLUMN trajectory_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER user_id,
  ADD KEY idx_replica_trajectory (trajectory_id),
  ADD CONSTRAINT fk_replica_trajectory FOREIGN KEY (trajectory_id) REFERENCES saved_trajectories (id) ON DELETE SET NULL;
