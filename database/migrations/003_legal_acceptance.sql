ALTER TABLE users
  ADD COLUMN terms_version VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER email_verified_at,
  ADD COLUMN terms_accepted_at DATETIME NULL AFTER terms_version,
  ADD CONSTRAINT chk_users_terms_acceptance CHECK (
    (terms_version IS NULL AND terms_accepted_at IS NULL)
    OR (terms_version IS NOT NULL AND terms_accepted_at IS NOT NULL)
  );
