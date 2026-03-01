-- down migration kept conservative to avoid destructive data loss.
UPDATE suppliers SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END;
