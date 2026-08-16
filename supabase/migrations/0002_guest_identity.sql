-- Guest identity.
--
-- The first schema assumed Supabase Auth: `profiles.id` referenced
-- `auth.users(id)`, and every other table hangs off `profiles`. The product
-- that shipped does not have accounts — a player is a cookie holding a random
-- uuid — so no player could ever have a profile row, and therefore no player
-- could ever be seated. It went unnoticed because nothing had run the Supabase
-- store against a real database until now.
--
-- This makes the schema match the product as it actually is, without giving up
-- the shape it will need when accounts arrive:
--
--   * a profile is a player, whether or not there is an account behind it;
--   * `user_id` is where an account attaches, and is null for a guest;
--   * the policies that used to key off `profiles.id` now key off `user_id`,
--     so they keep meaning what they meant — "only you may edit yours" — and
--     start working the moment a player signs in.
--
-- Guests are written by the service role, which is also the only thing that can
-- create them: there is no path from a browser to a profile row it does not own.

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  add column if not exists user_id uuid unique references auth.users(id) on delete set null;

-- A guest has no account to name them, so a handle is generated rather than
-- chosen. Real handles come with accounts.
alter table public.profiles
  alter column handle drop not null;

-- ------------------------------------------------------------ the policies

drop policy if exists "a player may edit only their own profile" on public.profiles;
create policy "a player may edit only their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "a player may create only their own profile" on public.profiles;
create policy "a player may create only their own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

-- Everything below reads `auth.uid()` against a column that used to hold the
-- account id and now holds the player id. For a signed-in player the two are
-- joined by `profiles.user_id`, so the comparison becomes a lookup rather than
-- an equality. Guests never match any of these, which is correct: a guest
-- reaches the database only through the service role.

create or replace function public.profile_of_current_user() returns uuid
  language sql stable
  security definer
  set search_path = public
as $$ select p.id from public.profiles p where p.user_id = auth.uid() $$;

drop policy if exists "friendships are visible to the two people in them" on public.friendships;
create policy "friendships are visible to the two people in them"
  on public.friendships for select to authenticated
  using (
    public.profile_of_current_user() in (requester_id, addressee_id)
  );

drop policy if exists "a player may request a friendship as themselves" on public.friendships;
create policy "a player may request a friendship as themselves"
  on public.friendships for insert to authenticated
  with check (public.profile_of_current_user() = requester_id);

drop policy if exists "either side may update the friendship" on public.friendships;
create policy "either side may update the friendship"
  on public.friendships for update to authenticated
  using (
    public.profile_of_current_user() in (requester_id, addressee_id)
  );

drop policy if exists "a player reads the public log, plus what was addressed to them" on public.game_events;
create policy "a player reads the public log, plus what was addressed to them"
  on public.game_events for select to authenticated
  using (
    visible_to is null
    or exists (
      select 1 from public.room_players rp
      where rp.room_id = game_events.room_id
        and rp.player_id = public.profile_of_current_user()
        and rp.seat = any (visible_to)
    )
  );

drop policy if exists "people at the table read the table's chat" on public.chat_messages;
create policy "people at the table read the table's chat"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = chat_messages.room_id
        and rp.player_id = public.profile_of_current_user()
    )
  );

drop policy if exists "you may only speak as yourself, and only at your own table" on public.chat_messages;
create policy "you may only speak as yourself, and only at your own table"
  on public.chat_messages for insert to authenticated
  with check (
    public.profile_of_current_user() = player_id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = chat_messages.room_id
        and rp.player_id = public.profile_of_current_user()
    )
  );

drop policy if exists "you may file a report as yourself" on public.reports;
create policy "you may file a report as yourself"
  on public.reports for insert to authenticated
  with check (public.profile_of_current_user() = reporter_id);

drop policy if exists "you may read your own reports" on public.reports;
create policy "you may read your own reports"
  on public.reports for select to authenticated
  using (public.profile_of_current_user() = reporter_id);
