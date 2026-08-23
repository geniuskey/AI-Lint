CREATE TABLE doc_index (
  document_uri   TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  doc_type       TEXT NOT NULL,
  document_hash  TEXT NOT NULL,
  modified_at    TIMESTAMPTZ,
  payload        JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX doc_index_updated ON doc_index (updated_at DESC);
