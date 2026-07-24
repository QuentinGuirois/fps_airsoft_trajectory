ALTER TABLE radar_event_rules
  ADD COLUMN IF NOT EXISTS evidence_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER details,
  ADD COLUMN IF NOT EXISTS evidence_locator VARCHAR(500) NULL AFTER evidence_url,
  ADD COLUMN IF NOT EXISTS evidence_excerpt VARCHAR(500) NULL AFTER evidence_locator,
  ADD COLUMN IF NOT EXISTS evidence_scope ENUM('event','organizer_general') NULL AFTER evidence_excerpt,
  ADD COLUMN IF NOT EXISTS evidence_checked_at DATETIME NULL AFTER evidence_scope,
  ADD INDEX IF NOT EXISTS idx_radar_rule_evidence (evidence_scope, evidence_checked_at);

ALTER TABLE radar_event_links
  MODIFY link_type ENUM(
    'organizer','registration','website','facebook','helloasso','discord','instagram'
  ) NOT NULL;

UPDATE radar_event_rules
SET details='NC',
    joules=NULL,
    evidence_url=NULL,
    evidence_locator=NULL,
    evidence_excerpt=NULL,
    evidence_scope=NULL,
    evidence_checked_at=NULL
WHERE rule_state='not_communicated';

-- Les anciennes règles connues n'avaient aucune provenance exploitable.
-- Elles deviennent NC plutôt que de conserver une affirmation invérifiable.
UPDATE radar_event_rules
SET rule_state='not_communicated',
    details='NC',
    joules=NULL,
    evidence_url=NULL,
    evidence_locator=NULL,
    evidence_excerpt=NULL,
    evidence_scope=NULL,
    evidence_checked_at=NULL
WHERE rule_state IN ('allowed','specific','forbidden')
  AND (
    evidence_url IS NULL
    OR evidence_locator IS NULL
    OR evidence_excerpt IS NULL
    OR evidence_scope IS NULL
    OR evidence_checked_at IS NULL
  );

ALTER TABLE radar_event_rules
  DROP CONSTRAINT IF EXISTS chk_radar_rule_evidence;

ALTER TABLE radar_event_rules
  ADD CONSTRAINT chk_radar_rule_evidence CHECK (
    (
      rule_state='not_communicated'
      AND joules IS NULL
      AND details='NC'
      AND evidence_url IS NULL
      AND evidence_locator IS NULL
      AND evidence_excerpt IS NULL
      AND evidence_scope IS NULL
      AND evidence_checked_at IS NULL
    )
    OR (
      rule_state IN ('allowed','specific','forbidden')
      AND details IS NOT NULL
      AND evidence_url IS NOT NULL
      AND evidence_locator IS NOT NULL
      AND evidence_excerpt IS NOT NULL
      AND evidence_scope IS NOT NULL
      AND evidence_checked_at IS NOT NULL
    )
  );

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
