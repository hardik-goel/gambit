-- Player ids are text.
--
-- The first schema typed every player id as `uuid`, because it was written for
-- a world where a player is an `auth.users` row. Three kinds of player id
-- actually exist in this product, and only one of them was ever a uuid:
--
--   * a guest — a random id in a cookie;
--   * a bot — `bot:1`, `bot:2`, seated like anyone else;
--   * an account, when accounts arrive.
--
-- Rather than force the first two into a shape they do not have, the columns
-- become `text`. What a player *is* stays where it was already recorded:
-- `room_players.is_bot` for a bot, and `profiles.user_id` — still a uuid,
-- still referencing `auth.users` — for an account.
--
-- Nothing is lost by this. A uuid is valid text, so an account id stores
-- unchanged, and `profiles.user_id` keeps the foreign key that matters.

-- Policies read these columns, so they cannot be altered underneath them.
drop policy if exists "friendships are visible to the two people in them" on public.friendships;
drop policy if exists "a player may request a friendship as themselves" on public.friendships;
drop policy if exists "either side may update the friendship" on public.friendships;
drop policy if exists "a player reads the public log, plus what was addressed to them" on public.game_events;
drop policy if exists "people at the table read the table's chat" on public.chat_messages;
drop policy if exists "you may only speak as yourself, and only at your own table" on public.chat_messages;
drop policy if exists "you may file a report as yourself" on public.reports;
drop policy if exists "you may read your own reports" on public.reports;

drop function if exists public.profile_of_current_user();

alter table public.friendships   drop constraint if exists friendships_requester_id_fkey;
alter table public.friendships   drop constraint if exists friendships_addressee_id_fkey;
alter table public.rooms         drop constraint if exists rooms_host_id_fkey;
alter table public.room_players  drop constraint if exists room_players_player_id_fkey;
alter table public.ratings       drop constraint if exists ratings_player_id_fkey;
alter table public.chat_messages drop constraint if exists chat_messages_player_id_fkey;
alter table public.reports       drop constraint if exists reports_reporter_id_fkey;
alter table public.reports       drop constraint if exists reports_subject_id_fkey;

alter table public.profiles      alter column id           type text using id::text;
alter table public.friendships   alter column requester_id type text using requester_id::text;
alter table public.friendships   alter column addressee_id type text using addressee_id::text;
alter table public.rooms         alter column host_id      type text using host_id::text;
alter table public.room_players  alter column player_id    type text using player_id::text;
alter table public.ratings       alter column player_id    type text using player_id::text;
alter table public.chat_messages alter column player_id    type text using player_id::text;
alter table public.reports       alter column reporter_id  type text using reporter_id::text;
alter table public.reports       alter column subject_id   type text using subject_id::text;

alter table public.friendships
  add constraint friendships_requester_id_fkey
  foreign key (requester_id) references public.profiles(id) on delete cascade;
alter table public.friendships
  add constraint friendships_addressee_id_fkey
  foreign key (addressee_id) references public.profiles(id) on delete cascade;
alter table public.rooms
  add constraint rooms_host_id_fkey
  foreign key (host_id) references public.profiles(id) on delete set null;
alter table public.room_players
  add constraint room_players_player_id_fkey
  foreign key (player_id) references public.profiles(id) on delete cascade;
alter table public.ratings
  add constraint ratings_player_id_fkey
  foreign key (player_id) references public.profiles(id) on delete cascade;
alter table public.chat_messages
  add constraint chat_messages_player_id_fkey
  foreign key (player_id) references public.profiles(id) on delete set null;
alter table public.reports
  add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete cascade;
alter table public.reports
  add constraint reports_subject_id_fkey
  foreign key (subject_id) references public.profiles(id) on delete set null;

-- ------------------------------------------------------------ the policies

create or replace function public.profile_of_current_user() returns text
  language sql stable
  security definer
  set search_path = public
as $$ select p.id from public.profiles p where p.user_id = auth.uid() $$;

create policy "friendships are visible to the two people in them"
  on public.friendships for select to authenticated
  using (public.profile_of_current_user() in (requester_id, addressee_id));

create policy "a player may request a friendship as themselves"
  on public.friendships for insert to authenticated
  with check (public.profile_of_current_user() = requester_id);

create policy "either side may update the friendship"
  on public.friendships for update to authenticated
  using (public.profile_of_current_user() in (requester_id, addressee_id));

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

create policy "people at the table read the table's chat"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = chat_messages.room_id
        and rp.player_id = public.profile_of_current_user()
    )
  );

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

create policy "you may file a report as yourself"
  on public.reports for insert to authenticated
  with check (public.profile_of_current_user() = reporter_id);

create policy "you may read your own reports"
  on public.reports for select to authenticated
  using (public.profile_of_current_user() = reporter_id);
