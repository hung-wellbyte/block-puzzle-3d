-- Shared leaderboard for Block Puzzle 3D.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id text not null check (char_length(user_id) between 2 and 20),
  level int not null check (level between 1 and 9999),
  time_ms int not null check (time_ms between 3000 and 86400000),
  hints int not null check (hints between 0 and 3),
  moves int not null check (moves between 8 and 100000),
  created_at timestamptz not null default now()
);

create index if not exists scores_level_idx on public.scores (level, hints, time_ms);

-- Anyone with the public key may read and add scores, never edit or delete them.
alter table public.scores enable row level security;

drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores for select to anon, authenticated using (true);

drop policy if exists "insert scores" on public.scores;
create policy "insert scores" on public.scores for insert to anon, authenticated with check (true);

grant select, insert on public.scores to anon, authenticated;

-- Best record per player per level (user ids compared case-insensitively).
create or replace view public.leaderboard with (security_invoker = true) as
select distinct on (level, lower(user_id))
  user_id, level, time_ms, hints, moves, created_at
from public.scores
order by level, lower(user_id), hints, time_ms;

grant select on public.leaderboard to anon, authenticated;
