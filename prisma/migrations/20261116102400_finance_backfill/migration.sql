-- Перенос существующих данных: ничего не удаляется и не пересчитывается задним числом.
-- Старые выполненные визиты сохраняют прежнюю долю (процент из настройки master_share_percent, по умолчанию 50).
UPDATE "Visit" SET "listAmount" = "amount";

UPDATE "Visit" v SET
  "splitPercent" = p.pct,
  "masterAmount" = FLOOR(v."amount" * p.pct / 100.0)::int,
  "salonAmount"  = v."amount" - FLOOR(v."amount" * p.pct / 100.0)::int
FROM (SELECT COALESCE((SELECT "value"::numeric FROM "Setting" WHERE "key" = 'master_share_percent'), 50) AS pct) p
WHERE v."status" = 'done';

-- Будущие записи получают длительность по умолчанию 60 минут (нужна для защиты от пересечений).
UPDATE "Visit" SET "durationMin" = 60 WHERE "status" = 'scheduled' AND "durationMin" IS NULL;

-- Проценты мастера по специализации. Действуют для записей, закрытых после ввода новых правил.
INSERT INTO "Setting" ("key", "value") VALUES
  ('share_percent_lash', '50'),
  ('share_percent_lami_brow', '50'),
  ('share_percent_nail', '60'),
  ('share_percent_hair', '50'),
  ('new_rules_from', '2026-11-16')
ON CONFLICT ("key") DO NOTHING;
