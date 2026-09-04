-- Human eval schema: experiments, renders (per-request results), votes.
-- Everything is public (no RLS) for ease of use, as requested.
-- Run this once in the Supabase SQL editor for the project.

create extension if not exists pgcrypto;

-- One row per "experience": a generation run identified by a unique tag.
create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text not null unique,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One row per rendered result (image/video) produced by an experiment for a given request.
create table if not exists renders (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  request_id text not null,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  task_uuid text,
  metadata jsonb not null default '{}'::jsonb,
  timings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (experiment_id, request_id)
);

-- One row per human vote comparing experiment A vs experiment B on a given request.
-- experiment_a_id/experiment_b_id are always stored in canonical order (a < b as text)
-- so a pair only ever has one identity regardless of which experiment was picked first.
-- voter_name lets several people vote independently on the same pair/request.
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  experiment_a_id uuid not null references experiments(id) on delete cascade,
  experiment_b_id uuid not null references experiments(id) on delete cascade,
  request_id text not null,
  voter_name text not null,
  winner text not null check (winner in ('a', 'b', 'tie')),
  created_at timestamptz not null default now(),
  unique (experiment_a_id, experiment_b_id, request_id, voter_name),
  check (experiment_a_id <> experiment_b_id)
);

-- Migration: add voter_name to a votes table created before this column existed.
-- Safe to re-run: existing rows are backfilled as 'anonymous', then the old
-- (no-voter) unique constraint is replaced with one that includes voter_name.
alter table votes add column if not exists voter_name text not null default 'anonymous';
alter table votes alter column voter_name drop default;
alter table votes drop constraint if exists votes_experiment_a_id_experiment_b_id_request_id_key;
alter table votes drop constraint if exists votes_experiment_a_id_experiment_b_id_request_id_voter_name_key;
alter table votes add constraint votes_experiment_a_id_experiment_b_id_request_id_voter_name_key
  unique (experiment_a_id, experiment_b_id, request_id, voter_name);

-- Migration: add timings to a renders table created before this column existed.
alter table renders add column if not exists timings jsonb not null default '{}'::jsonb;

-- A "battle" is a curated set of experiments that vote/Elo against each other.
-- Grouping experiments into battles lets the leaderboard restrict Elo comparisons
-- to only the experiments meant to compete together (instead of the global pool).
create table if not exists battles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists battle_experiments (
  battle_id uuid not null references battles(id) on delete cascade,
  experiment_id uuid not null references experiments(id) on delete cascade,
  primary key (battle_id, experiment_id)
);

create index if not exists idx_renders_experiment on renders (experiment_id);
create index if not exists idx_renders_request on renders (request_id);
create index if not exists idx_renders_task_uuid on renders (task_uuid);
create index if not exists idx_votes_pair on votes (experiment_a_id, experiment_b_id);
create index if not exists idx_votes_voter on votes (voter_name);
create index if not exists idx_battle_experiments_battle on battle_experiments (battle_id);
create index if not exists idx_battle_experiments_experiment on battle_experiments (experiment_id);

-- Disable RLS: tables are fully public (read/write) as requested for ease of use.
alter table experiments disable row level security;
alter table renders disable row level security;
alter table votes disable row level security;
alter table battles disable row level security;
alter table battle_experiments disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on experiments to anon, authenticated;
grant select, insert, update on renders to anon, authenticated;
grant select, insert on votes to anon, authenticated;
grant select, insert, update, delete on battles to anon, authenticated;
grant select, insert, delete on battle_experiments to anon, authenticated;

-- Storage bucket for renders (images/videos), public read access.
insert into storage.buckets (id, name, public)
values ('renders', 'renders', true)
on conflict (id) do update set public = true;

-- Public storage policies (read + write) so both the upload script and the
-- browser app can operate without needing the service role key.
drop policy if exists "Public read renders" on storage.objects;
create policy "Public read renders" on storage.objects
  for select using (bucket_id = 'renders');

drop policy if exists "Public write renders" on storage.objects;
create policy "Public write renders" on storage.objects
  for insert with check (bucket_id = 'renders');

drop policy if exists "Public update renders" on storage.objects;
create policy "Public update renders" on storage.objects
  for update using (bucket_id = 'renders');
