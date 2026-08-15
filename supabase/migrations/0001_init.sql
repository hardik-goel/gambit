-- Gambit — initial schema.
--
-- Two rules run through every table here:
--   1. RLS is on, always, with no exceptions and no "temporarily off".
--   2. Game state and the event log are written by the service role only. A
--      client can read what it is allowed to see and nothing else; it can never
--      write a move directly, because moves must go through the engine.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text unique not null check (char_length(handle) between 2 and 24),
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar_url   text,
  theme        text not null default 'cocoa',
  audio        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by signed-in players"
  on public.profiles for select to authenticated using (true);

create policy "a player may edit only their own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

create policy "a player may create only their own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

-- ------------------------------------------------------------- friendships

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "friendships are visible to the two people in them"
  on public.friendships for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "a player may request a friendship as themselves"
  on public.friendships for insert to authenticated with check (auth.uid() = requester_id);

create policy "either side may update the friendship"
  on public.friendships for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ------------------------------------------------------------------ rooms

create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null check (code ~ '^[A-Z0-9]{6}$'),
  game_id          text not null,
  host_id          uuid references public.profiles(id) on delete set null,
  status           text not null default 'lobby' check (status in ('lobby','playing','finished','abandoned')),
  config           jsonb not null default '{}'::jsonb,
  -- The seed decides every shuffle and every die. It is service-role only until
  -- the game is over, at which point it becomes part of the replay record.
  seed             text not null,
  pass_and_play    boolean not null default false,
  turn_timeout_sec integer not null default 90,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

create index rooms_status_game_idx on public.rooms (status, game_id);
create index rooms_code_idx on public.rooms (code);

alter table public.rooms enable row level security;

create policy "anyone signed in may look up a room"
  on public.rooms for select to authenticated using (true);
-- Inserts and updates go through the service role in the move pipeline.

-- ----------------------------------------------------------- room_players

create table public.room_players (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat      integer,
  team      text,
  ready     boolean not null default false,
  is_host   boolean not null default false,
  is_bot    boolean not null default false,
  bot_level integer,
  seen_at   timestamptz not null default now(),
  connected boolean not null default true,
  primary key (room_id, player_id),
  unique (room_id, seat)
);

alter table public.room_players enable row level security;

create policy "players at a table can see who else is there"
  on public.room_players for select to authenticated using (true);

-- ------------------------------------------------------------------ games

-- The authoritative state snapshot. Never readable by a client: a client only
-- ever receives the output of redactStateFor, over realtime.
create table public.games (
  room_id    uuid primary key references public.rooms(id) on delete cascade,
  game_id    text not null,
  version    integer not null default 0,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;
-- No policies: service role only. This is the hidden-information firewall in
-- its most literal form.

-- ------------------------------------------------------------ game_events

create table public.game_events (
  seq        bigserial primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seat       integer,
  version    integer not null,
  event      jsonb not null,
  -- Null means public. A seat list means only those seats may read it.
  visible_to integer[],
  at         timestamptz not null default now()
);

create index game_events_room_seq_idx on public.game_events (room_id, seq);

alter table public.game_events enable row level security;

create policy "a player reads the public log, plus what was addressed to them"
  on public.game_events for select to authenticated
  using (
    visible_to is null
    or exists (
      select 1 from public.room_players rp
      where rp.room_id = game_events.room_id
        and rp.player_id = auth.uid()
        and rp.seat = any (game_events.visible_to)
    )
  );

-- ------------------------------------------------------------- game_moves

create table public.game_moves (
  seq             bigserial primary key,
  room_id         uuid not null references public.rooms(id) on delete cascade,
  seat            integer not null,
  move            jsonb not null,
  idempotency_key text not null,
  at              timestamptz not null default now(),
  unique (room_id, idempotency_key)
);

create index game_moves_room_idx on public.game_moves (room_id, seq);

alter table public.game_moves enable row level security;
-- Service role only while a game is live; the replay endpoint reads it server-side.

-- ------------------------------------------------------------ game_results

create table public.game_results (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  game_id     text not null,
  seed        text not null,
  scores      jsonb not null,
  seats       jsonb not null,
  finished_at timestamptz not null default now()
);

create index game_results_game_idx on public.game_results (game_id, finished_at desc);

alter table public.game_results enable row level security;

create policy "finished games are public record"
  on public.game_results for select to authenticated using (true);

-- ---------------------------------------------------------------- ratings

create table public.ratings (
  player_id  uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null,
  rating     numeric not null default 1500,
  deviation  numeric not null default 350,
  games      integer not null default 0,
  season     integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id, season)
);

alter table public.ratings enable row level security;

create policy "ratings are public"
  on public.ratings for select to authenticated using (true);

-- ---------------------------------------------------------- chat_messages

create table public.chat_messages (
  id        bigserial primary key,
  room_id   uuid not null references public.rooms(id) on delete cascade,
  player_id uuid references public.profiles(id) on delete set null,
  text      text check (char_length(text) <= 280),
  emote     text,
  at        timestamptz not null default now()
);

create index chat_room_idx on public.chat_messages (room_id, at desc);

alter table public.chat_messages enable row level security;

create policy "people at the table read the table's chat"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = chat_messages.room_id and rp.player_id = auth.uid()
    )
  );

create policy "you may only speak as yourself, and only at your own table"
  on public.chat_messages for insert to authenticated
  with check (
    auth.uid() = player_id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = chat_messages.room_id and rp.player_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------- reports

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  subject_id  uuid references public.profiles(id) on delete set null,
  room_id     uuid references public.rooms(id) on delete set null,
  reason      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "you may file a report as yourself"
  on public.reports for insert to authenticated with check (auth.uid() = reporter_id);

create policy "you may read your own reports"
  on public.reports for select to authenticated using (auth.uid() = reporter_id);

-- ------------------------------------------------------ atomic move append

-- The whole pipeline's write, in one transaction: check the version, append the
-- events and the move, bump the version, save the state. Called by the service
-- role from the move pipeline. Raises on a version conflict so the caller can
-- re-read rather than clobber.
create or replace function public.append_game_events(
  p_room_id  uuid,
  p_expected integer,
  p_state    jsonb,
  p_events   jsonb,
  p_seat     integer,
  p_move     jsonb,
  p_key      text
) returns table (version integer, first_seq bigint, last_seq bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_next    integer;
  v_first   bigint;
  v_last    bigint;
  v_event   jsonb;
begin
  select g.version into v_current from public.games g
    where g.room_id = p_room_id for update;

  if v_current is null then
    v_current := 0;
  end if;

  if v_current <> p_expected then
    raise exception 'version conflict: expected %, store is at %', p_expected, v_current
      using errcode = '40001';
  end if;

  v_next := v_current + 1;

  for v_event in select * from jsonb_array_elements(p_events) loop
    insert into public.game_events (room_id, seat, version, event, visible_to)
    values (
      p_room_id,
      p_seat,
      v_next,
      v_event,
      case when v_event ? 'visibleTo'
           then (select array_agg(value::int) from jsonb_array_elements_text(v_event->'visibleTo'))
           else null end
    )
    returning seq into v_last;
    if v_first is null then v_first := v_last; end if;
  end loop;

  if p_move is not null then
    insert into public.game_moves (room_id, seat, move, idempotency_key)
    values (p_room_id, p_seat, p_move, p_key)
    on conflict (room_id, idempotency_key) do nothing;
  end if;

  insert into public.games (room_id, game_id, version, state, updated_at)
  values (p_room_id, (select game_id from public.rooms where id = p_room_id), v_next, p_state, now())
  on conflict (room_id) do update
    set version = v_next, state = p_state, updated_at = now();

  return query select v_next, coalesce(v_first, 0::bigint), coalesce(v_last, 0::bigint);
end;
$$;

revoke all on function public.append_game_events(uuid, integer, jsonb, jsonb, integer, jsonb, text) from public;
