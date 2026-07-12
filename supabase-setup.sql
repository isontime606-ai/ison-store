-- Migración idempotente para ISON. Ejecutar en Supabase SQL Editor.
create extension if not exists pgcrypto;

-- Usuarios del panel compartidos entre dispositivos. Las contraseñas nunca se guardan en texto plano.
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(), username text not null, password_hash text not null,
  role text not null default 'vendedor' check (role in ('admin','vendedor')),
  active boolean not null default true, created_at timestamptz not null default now()
);
create unique index if not exists admin_users_username_lower_idx on public.admin_users(lower(username));
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.admin_users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.admin_users, public.admin_sessions from anon, authenticated;

insert into public.admin_users(username,password_hash,role) values
 ('diego',crypt('DiegoISON#2026',gen_salt('bf')),'admin'),
 ('maicol',crypt('MaicolISON#2026',gen_salt('bf')),'admin')
on conflict (lower(username)) do update set
 password_hash=excluded.password_hash,
 role=excluded.role,
 active=true;

create or replace function public.login_admin(login_username text,login_password text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.admin_users; raw_token text;
begin
 select * into u from public.admin_users where lower(username)=lower(trim(login_username)) and active
   and password_hash=crypt(login_password,password_hash);
 if not found then return null; end if;
 delete from public.admin_sessions where expires_at<=now();
 raw_token:=encode(gen_random_bytes(32),'hex');
 insert into public.admin_sessions(user_id,token_hash) values(u.id,encode(digest(raw_token,'sha256'),'hex'));
 return jsonb_build_object('id',u.id,'user',u.username,'rol',u.role,'token',raw_token);
end $$;

create or replace function public.validate_admin_session(session_token text)
returns jsonb language sql security definer set search_path=public stable as $$
 select jsonb_build_object('id',u.id,'user',u.username,'rol',u.role)
 from public.admin_sessions s join public.admin_users u on u.id=s.user_id
 where s.token_hash=encode(digest(session_token,'sha256'),'hex') and s.expires_at>now() and u.active limit 1
$$;

create or replace function public.list_admin_users(session_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.admin_sessions s join public.admin_users u on u.id=s.user_id
   where s.token_hash=encode(digest(session_token,'sha256'),'hex') and s.expires_at>now() and u.active and u.role='admin')
 then raise exception 'No autorizado'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'user',username,'rol',role) order by created_at),'[]'::jsonb)
   from public.admin_users where active);
end $$;

create or replace function public.create_admin_user(session_token text,new_username text,new_password text,new_role text)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if not exists(select 1 from public.admin_sessions s join public.admin_users u on u.id=s.user_id
   where s.token_hash=encode(digest(session_token,'sha256'),'hex') and s.expires_at>now() and u.active and u.role='admin')
 then raise exception 'No autorizado'; end if;
 if length(trim(new_username))<3 or length(new_password)<6 or new_role not in ('admin','vendedor')
 then raise exception 'Datos de usuario inválidos'; end if;
 insert into public.admin_users(username,password_hash,role)
 values(trim(new_username),crypt(new_password,gen_salt('bf')),new_role) returning id into new_id;
 return new_id;
end $$;

create or replace function public.delete_admin_user(session_token text,user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare caller_id uuid;
begin
 select u.id into caller_id from public.admin_sessions s join public.admin_users u on u.id=s.user_id
 where s.token_hash=encode(digest(session_token,'sha256'),'hex') and s.expires_at>now() and u.active and u.role='admin';
 if caller_id is null or caller_id=user_id then raise exception 'No autorizado'; end if;
 delete from public.admin_users where id=user_id;
end $$;

create or replace function public.logout_admin(session_token text)
returns void language sql security definer set search_path=public as $$
 delete from public.admin_sessions where token_hash=encode(digest(session_token,'sha256'),'hex')
$$;

grant execute on function public.login_admin(text,text) to anon,authenticated;
grant execute on function public.validate_admin_session(text) to anon,authenticated;
grant execute on function public.list_admin_users(text) to anon,authenticated;
grant execute on function public.create_admin_user(text,text,text,text) to anon,authenticated;
grant execute on function public.delete_admin_user(text,uuid) to anon,authenticated;
grant execute on function public.logout_admin(text) to anon,authenticated;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price numeric(14,2) not null default 0,
  stock integer not null default 0
);
alter table public.products add column if not exists image text not null default '';
alter table public.products add column if not exists image_url text not null default '';
alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists ref text not null default '';
alter table public.products add column if not exists brand text not null default 'ISON';
alter table public.products add column if not exists categoria text not null default '';
alter table public.products add column if not exists preciodesc numeric(14,2) not null default 0;
alter table public.products add column if not exists material text not null default '';
alter table public.products add column if not exists color text not null default '';
alter table public.products add column if not exists garantia text not null default '';
alter table public.products add column if not exists visible boolean not null default true;

create table if not exists public.sales (
  id text primary key,
  fecha timestamptz not null default now(),
  "productoId" text not null,
  producto text not null default '',
  cantidad integer not null default 1,
  cliente text not null default '',
  ciudad text not null default '',
  telefono text not null default '',
  canal text not null default 'whatsapp',
  estado text not null default 'pendiente',
  total numeric(14,2) not null default 0
);
alter table public.sales add column if not exists canal text not null default 'whatsapp';
alter table public.sales add column if not exists fecha timestamptz not null default now();
alter table public.sales add column if not exists "productoId" text;
alter table public.sales add column if not exists producto text not null default '';
alter table public.sales add column if not exists cantidad integer not null default 1;
alter table public.sales add column if not exists cliente text not null default '';
alter table public.sales add column if not exists ciudad text not null default '';
alter table public.sales add column if not exists telefono text not null default '';
alter table public.sales add column if not exists estado text not null default 'pendiente';
alter table public.sales add column if not exists total numeric(14,2) not null default 0;

alter table public.products drop constraint if exists products_stock_nonnegative;
alter table public.products add constraint products_stock_nonnegative check (stock >= 0);
alter table public.sales drop constraint if exists sales_quantity_positive;
alter table public.sales add constraint sales_quantity_positive check (cantidad > 0);
alter table public.sales drop constraint if exists sales_status_valid;
alter table public.sales add constraint sales_status_valid check (estado in ('pendiente','pagado','enviado','entregado','cancelado'));

create or replace function public.create_sale_with_stock(sale_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.products; s public.sales; qty integer := greatest(1,coalesce((sale_data->>'cantidad')::integer,1));
begin
  select * into p from public.products where id::text=sale_data->>'productoId' for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if coalesce(sale_data->>'estado','pendiente')<>'cancelado' then
    if p.stock < qty then raise exception 'Stock insuficiente para %',p.name; end if;
    update public.products set stock=stock-qty where id=p.id;
  end if;
  insert into public.sales(id,fecha,"productoId",producto,cantidad,cliente,ciudad,telefono,canal,estado,total)
  values(coalesce(nullif(sale_data->>'id',''),'s'||extract(epoch from clock_timestamp())::bigint),
    coalesce((sale_data->>'fecha')::timestamptz,now()),p.id::text,p.name,qty,
    coalesce(sale_data->>'cliente',''),coalesce(sale_data->>'ciudad',''),coalesce(sale_data->>'telefono',''),
    coalesce(sale_data->>'canal','whatsapp'),coalesce(sale_data->>'estado','pendiente'),
    coalesce((sale_data->>'total')::numeric,0)) returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.create_sales_with_stock(sales_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(sales_data)<>'array' or jsonb_array_length(sales_data)=0 then raise exception 'La compra está vacía'; end if;
  for item in select value from jsonb_array_elements(sales_data) loop
    result := result || jsonb_build_array(public.create_sale_with_stock(item));
  end loop;
  return result;
end $$;

create or replace function public.change_sale_status_with_stock(sale_id text,new_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.sales; p public.products;
begin
  if new_status not in ('pendiente','pagado','enviado','entregado','cancelado') then raise exception 'Estado inválido'; end if;
  select * into s from public.sales where id::text=sale_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if s.estado<>new_status then
    select * into p from public.products where id::text=s."productoId" for update;
    if s.estado<>'cancelado' and new_status='cancelado' and found then
      update public.products set stock=stock+s.cantidad where id=p.id;
    elsif s.estado='cancelado' and new_status<>'cancelado' then
      if not found or p.stock<s.cantidad then raise exception 'Stock insuficiente para reactivar la venta'; end if;
      update public.products set stock=stock-s.cantidad where id=p.id;
    end if;
    update public.sales set estado=new_status where id::text=sale_id returning * into s;
  end if;
  return to_jsonb(s);
end $$;

create or replace function public.delete_sale_with_stock(sale_id text)
returns void language plpgsql security definer set search_path=public as $$
declare s public.sales; p public.products;
begin
  select * into s from public.sales where id::text=sale_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if s.estado<>'cancelado' then
    select * into p from public.products where id::text=s."productoId" for update;
    if found then update public.products set stock=stock+s.cantidad where id=p.id; end if;
  end if;
  delete from public.sales where id::text=sale_id;
end $$;

grant execute on function public.create_sale_with_stock(jsonb) to anon,authenticated;
grant execute on function public.create_sales_with_stock(jsonb) to anon,authenticated;
grant execute on function public.change_sale_status_with_stock(text,text) to anon,authenticated;
grant execute on function public.delete_sale_with_stock(text) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('products','products',true,5242880,array['image/webp','image/jpeg','image/png'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Public product image read" on storage.objects;
drop policy if exists "Public product image upload" on storage.objects;
drop policy if exists "Public product image update" on storage.objects;
drop policy if exists "Public product image delete" on storage.objects;
create policy "Public product image read" on storage.objects for select to public using(bucket_id='products');
create policy "Public product image upload" on storage.objects for insert to public with check(bucket_id='products');
create policy "Public product image update" on storage.objects for update to public using(bucket_id='products') with check(bucket_id='products');
create policy "Public product image delete" on storage.objects for delete to public using(bucket_id='products');

alter table public.products enable row level security;
alter table public.sales enable row level security;
drop policy if exists "Public products read" on public.products;
drop policy if exists "Public products write" on public.products;
drop policy if exists "Public sales read" on public.sales;
create policy "Public products read" on public.products for select to public using(true);
create policy "Public products write" on public.products for all to public using(true) with check(true);
create policy "Public sales read" on public.sales for select to public using(true);

do $$ begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.sales;
exception when duplicate_object then null; end $$;
