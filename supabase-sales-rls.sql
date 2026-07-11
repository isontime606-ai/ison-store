-- Permisos mínimos requeridos por la arquitectura actual de la tienda.
-- Ejecutar una vez en Supabase > SQL Editor.

alter table public.sales enable row level security;

drop policy if exists "Storefront sales select" on public.sales;
drop policy if exists "Storefront sales insert" on public.sales;
drop policy if exists "Storefront sales update" on public.sales;
drop policy if exists "Storefront sales delete" on public.sales;

create policy "Storefront sales select"
on public.sales for select
to anon, authenticated
using (true);

create policy "Storefront sales insert"
on public.sales for insert
to anon, authenticated
with check (estado in ('Pendiente', 'Pagada', 'Enviada', 'Entregada', 'Cancelada'));

create policy "Storefront sales update"
on public.sales for update
to anon, authenticated
using (true)
with check (estado in ('Pendiente', 'Pagada', 'Enviada', 'Entregada', 'Cancelada'));

create policy "Storefront sales delete"
on public.sales for delete
to anon, authenticated
using (true);
