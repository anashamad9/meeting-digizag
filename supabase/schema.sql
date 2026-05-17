-- Digizag Meeting Room schema
-- Paste this in Supabase SQL editor and run once.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_date date not null,
  hour smallint not null check (hour between 0 and 23),
  booked_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (booking_date, hour)
);

create index if not exists bookings_booking_date_idx
  on public.bookings (booking_date);

create index if not exists bookings_booked_by_idx
  on public.bookings (booked_by);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;

-- Profiles: any logged-in employee can read names/emails for booking visibility.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Bookings: authenticated users can view all bookings and create/delete their own.
drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated"
  on public.bookings
  for select
  to authenticated
  using (true);

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
  on public.bookings
  for insert
  to authenticated
  with check (booked_by = auth.uid());

drop policy if exists "bookings_delete_own" on public.bookings;
create policy "bookings_delete_own"
  on public.bookings
  for delete
  to authenticated
  using (booked_by = auth.uid());

drop policy if exists "bookings_delete_hr_any" on public.bookings;
create policy "bookings_delete_hr_any"
  on public.bookings
  for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'hr@digizag.com');
