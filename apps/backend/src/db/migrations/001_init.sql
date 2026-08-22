CREATE TABLE rulesets (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  name           TEXT NOT NULL,
  yaml           TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  report_id        UUID PRIMARY KEY,
  document_uri     TEXT NOT NULL,
  document_hash    TEXT NOT NULL,
  ruleset_id       TEXT NOT NULL,
  ruleset_version  INTEGER NOT NULL,
  prompt_version   INTEGER NOT NULL,
  doc_type         TEXT NOT NULL,
  score_total      INTEGER NOT NULL,
  score_grade      TEXT NOT NULL,
  payload          JSONB NOT NULL,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 프롬프트를 고치면 이전 리포트가 자동으로 무효화되도록 prompt_version을 캐시 키에 넣는다.
CREATE UNIQUE INDEX reports_cache_key
  ON reports (document_hash, ruleset_id, ruleset_version, prompt_version);
CREATE INDEX reports_by_uri ON reports (document_uri, created_at DESC);

CREATE TABLE doctype_overrides (
  document_uri  TEXT PRIMARY KEY,
  doc_type      TEXT NOT NULL,
  set_by        TEXT NOT NULL,
  set_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_usage (
  user_id     TEXT NOT NULL,
  usage_date  DATE NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);
