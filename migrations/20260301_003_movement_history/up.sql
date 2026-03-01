CREATE TABLE IF NOT EXISTS movement_history (
  id VARCHAR(64) PRIMARY KEY,
  created_at DATETIME NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(128) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  detail_json JSON NULL,
  result VARCHAR(16) NOT NULL,
  error_message TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_movement_history_created_at ON movement_history(created_at);
CREATE INDEX IF NOT EXISTS idx_movement_history_event_type ON movement_history(event_type);
CREATE INDEX IF NOT EXISTS idx_movement_history_user_id ON movement_history(user_id);

INSERT INTO movement_history (
  id, created_at, user_id, user_name, role, event_type, action, entity_type, entity_id, detail_json, result, error_message
)
SELECT
  id,
  timestamp,
  user_id,
  user_name,
  COALESCE(role, 'procura'),
  action,
  action,
  entity,
  entity_id,
  changes,
  'OK',
  NULL
FROM audit_logs
WHERE NOT EXISTS (
  SELECT 1 FROM movement_history mh WHERE mh.entity_id = audit_logs.entity_id AND mh.action = audit_logs.action AND mh.created_at = audit_logs.timestamp
);

