CREATE POLICY "Authenticated users can read bar chunks"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bars');