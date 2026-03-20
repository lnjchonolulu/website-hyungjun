CREATE TABLE IF NOT EXISTS publications (
  id BIGSERIAL PRIMARY KEY,
  publication_year TEXT NOT NULL,
  year_sort_order INTEGER NOT NULL,
  item_sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  venue TEXT NOT NULL,
  award TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS publications_year_sort_idx
  ON publications (year_sort_order, item_sort_order);
