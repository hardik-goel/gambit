-- A version conflict is an answer, not a transient failure.
--
-- `append_game_events` raised its version conflict with SQLSTATE 40001, the
-- serialization-failure code. That reads well — two writers did collide — but
-- 40001 is precisely the code the stack is built to retry: PostgREST treats it
-- as transient and tries again, and again, until the gateway gives up. Measured
-- against a real project, one stale append took 125 seconds and came back as
-- "upstream request timeout" instead of the conflict it was.
--
-- That is not a rare path. It is what happens whenever two players act at the
-- same instant, which is the ordinary case this whole design exists to handle.
--
-- PT409 is in PostgREST's own range: it is returned to the caller as HTTP 409
-- Conflict, immediately, and nothing retries it. The message is unchanged, so
-- anything matching on the text keeps working.

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
      using errcode = 'PT409';
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
