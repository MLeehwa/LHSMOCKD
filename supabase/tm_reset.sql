-- ============================================
-- TM 테이블 초기화 스크립트
-- 기존 mo_tm_barcodes 테이블을 삭제하고 새로 생성합니다.
-- product_date 컬럼이 추가된 새 구조로 생성됩니다.
-- ============================================

-- 1. 기존 테이블 및 관련 객체 삭제
DROP TABLE IF EXISTS public.mo_tm_barcodes CASCADE;

-- 2. TM barcodes 테이블 생성 (날짜 + 바코드)
CREATE TABLE public.mo_tm_barcodes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  barcode TEXT NOT NULL,
  product_date DATE NOT NULL
);

-- 3. Unique constraint (바코드 + 제품날짜 조합으로 중복 방지)
CREATE UNIQUE INDEX mo_tm_barcodes_unique ON public.mo_tm_barcodes (barcode, product_date);

-- 4. Index for barcode lookups
CREATE INDEX mo_tm_barcodes_barcode_idx ON public.mo_tm_barcodes (barcode);

-- 5. Index for product_date lookups
CREATE INDEX mo_tm_barcodes_date_idx ON public.mo_tm_barcodes (product_date);

-- 6. Enable Row Level Security
ALTER TABLE public.mo_tm_barcodes ENABLE ROW LEVEL SECURITY;

-- 7. Grant permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mo_tm_barcodes TO anon;
GRANT USAGE, SELECT ON SEQUENCE mo_tm_barcodes_id_seq TO anon;

-- 8. Create policy (allow all operations for anon users)
CREATE POLICY "allow anon all" ON public.mo_tm_barcodes 
  FOR ALL 
  TO anon 
  USING (true) 
  WITH CHECK (true);

-- 완료!
-- 이제 TM Upload 페이지에서 날짜와 바코드를 업로드할 수 있습니다.
