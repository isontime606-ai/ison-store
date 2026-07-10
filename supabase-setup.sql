-- Ejecutar una vez en Supabase SQL Editor.
-- Mantiene las columnas existentes y habilita la galería como URLs públicas.
alter table public.products
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do update set public = true;

-- Ajusta "anon" a authenticated si el panel usa Supabase Auth.
drop policy if exists "Public product image read" on storage.objects;
drop policy if exists "Public product image upload" on storage.objects;
drop policy if exists "Public product image update" on storage.objects;
drop policy if exists "Public product image delete" on storage.objects;
create policy "Public product image read" on storage.objects for select to public using (bucket_id = 'products');
create policy "Public product image upload" on storage.objects for insert to public with check (bucket_id = 'products');
create policy "Public product image update" on storage.objects for update to public using (bucket_id = 'products') with check (bucket_id = 'products');
create policy "Public product image delete" on storage.objects for delete to public using (bucket_id = 'products');

-- Habilita los cambios instantáneos del catálogo si la publicación todavía no existe.
alter publication supabase_realtime add table public.products;
