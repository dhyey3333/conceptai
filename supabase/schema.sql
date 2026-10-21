-- ConceptAI persistence (optional). Run in the Supabase SQL editor, then enable
-- Authentication -> Sign In / Providers -> "Allow anonymous sign-ins".
-- Every row belongs to the (anonymous) user that created it; RLS enforces it.

create table if not exists public.lessons (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  topic text not null,
  subject text,
  sample boolean default false,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  topic text not null,
  content text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists lessons_user_updated on public.lessons (user_id, updated_at desc);
create index if not exists notes_user_updated on public.notes (user_id, updated_at desc);

alter table public.lessons enable row level security;
alter table public.notes enable row level security;

drop policy if exists "own lessons" on public.lessons;
create policy "own lessons" on public.lessons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
