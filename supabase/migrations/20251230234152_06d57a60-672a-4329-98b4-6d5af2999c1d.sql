-- Step 1: Deduplicate trade_reviews, keeping the row with most screenshots (or latest updated_at)
WITH ranked_reviews AS (
  SELECT id, trade_id,
    ROW_NUMBER() OVER (
      PARTITION BY trade_id
      ORDER BY 
        COALESCE(jsonb_array_length(screenshots), 0) DESC,
        updated_at DESC
    ) AS rn
  FROM public.trade_reviews
),
duplicates AS (
  SELECT id FROM ranked_reviews WHERE rn > 1
)
DELETE FROM public.trade_reviews WHERE id IN (SELECT id FROM duplicates);

-- Step 2: Add UNIQUE constraint on trade_id to prevent future duplicates
ALTER TABLE public.trade_reviews
ADD CONSTRAINT trade_reviews_trade_id_unique UNIQUE (trade_id);