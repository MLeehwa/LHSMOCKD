-- Supabase schema for OCR results with mo_ prefix

-- Table: public.mo_ocr_results
CREATE TABLE IF NOT EXISTS public.mo_ocr_results (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT,
  prefixes TEXT,
  text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0
);

-- Prevent duplicate rows for the same text within the same dataset context.
-- If you want global uniqueness by text only, keep the first index and remove the second.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'mo_ocr_results_text_key'
  ) THEN
    CREATE UNIQUE INDEX mo_ocr_results_text_key ON public.mo_ocr_results (text);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.mo_ocr_results ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mo_ocr_results'
      AND policyname = 'allow anon insert'
  ) THEN
    CREATE POLICY "allow anon insert"
    ON public.mo_ocr_results
    FOR INSERT
    TO anon
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mo_ocr_results'
      AND policyname = 'allow anon select'
  ) THEN
    CREATE POLICY "allow anon select"
    ON public.mo_ocr_results
    FOR SELECT
    TO anon
    USING (true);
  END IF;
END $$;


-- Optional: scans table (barcodes)
CREATE TABLE IF NOT EXISTS public.mo_scans (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  prefixes TEXT,
  text TEXT NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='mo_scans_text_key'
  ) THEN
    CREATE UNIQUE INDEX mo_scans_text_key ON public.mo_scans (text);
  END IF;
END $$;


-- Scan sessions and items (to persist matched/unmatched results per run)
-- Requires pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mo_scan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  name text
);

CREATE TABLE IF NOT EXISTS public.mo_scan_items (
  id bigserial PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  session_id uuid NOT NULL REFERENCES public.mo_scan_sessions(id) ON DELETE CASCADE,
  prefixes text,
  text text NOT NULL,
  matched boolean NOT NULL DEFAULT false
);

-- Uniqueness: one code per session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='mo_scan_items_unique'
  ) THEN
    CREATE UNIQUE INDEX mo_scan_items_unique ON public.mo_scan_items (session_id, text);
  END IF;
END $$;

ALTER TABLE public.mo_scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_scan_items ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mo_scan_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mo_scan_items TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_scan_sessions' AND policyname='allow anon all'
  ) THEN
    CREATE POLICY "allow anon all" ON public.mo_scan_sessions FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_scan_items' AND policyname='allow anon all'
  ) THEN
    CREATE POLICY "allow anon all" ON public.mo_scan_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.mo_scans ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mo_scans TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_scans' AND policyname='allow anon select'
  ) THEN
    CREATE POLICY "allow anon select" ON public.mo_scans FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_scans' AND policyname='allow anon insert'
  ) THEN
    CREATE POLICY "allow anon insert" ON public.mo_scans FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_scans' AND policyname='allow anon delete'
  ) THEN
    CREATE POLICY "allow anon delete" ON public.mo_scans FOR DELETE TO anon USING (true);
  END IF;
END $$;

-- Inventory table for receiving and disposing products
CREATE TABLE IF NOT EXISTS public.mo_lq2_inventory (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  barcode TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  disposed_at TIMESTAMPTZ,
  prefixes TEXT
);

-- Index for barcode lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='mo_lq2_inventory_barcode_idx'
  ) THEN
    CREATE INDEX mo_lq2_inventory_barcode_idx ON public.mo_lq2_inventory (barcode);
  END IF;
END $$;

-- Index for active inventory (not disposed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='mo_lq2_inventory_active_idx'
  ) THEN
    CREATE INDEX mo_lq2_inventory_active_idx ON public.mo_lq2_inventory (barcode, disposed_at) WHERE disposed_at IS NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.mo_lq2_inventory ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mo_lq2_inventory TO anon;

-- Policies for inventory
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mo_lq2_inventory' AND policyname='allow anon all'
  ) THEN
    CREATE POLICY "allow anon all" ON public.mo_lq2_inventory FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_mo_lq2_inventory_updated_at'
  ) THEN
    CREATE TRIGGER update_mo_lq2_inventory_updated_at
    BEFORE UPDATE ON public.mo_lq2_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

