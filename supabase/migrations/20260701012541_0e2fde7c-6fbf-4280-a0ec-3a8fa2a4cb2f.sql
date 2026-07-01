create policy "Coach uploads: user reads own"
  on storage.objects for select to authenticated
  using (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Coach uploads: user inserts own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Coach uploads: user deletes own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text);