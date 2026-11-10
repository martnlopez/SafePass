-- Envío idempotente de la evaluación (prompt de arquitectura §3.4 y §8.6).
-- Si la respuesta se pierde por mala señal y el cliente reintenta con la MISMA sesión,
-- el servidor devuelve la evaluación ya registrada (eco) en vez de un error: llegar dos
-- veces es inofensivo y el trabajador no tiene que repetir la batería.

create or replace function public.submit_evaluation(p_session_id uuid, p_breakdown jsonb)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  s         private.evaluation_sessions%rowtype;
  e         public.evaluations%rowtype;
  v_elapsed integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not (select private.is_active_worker()) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select * into s from private.evaluation_sessions
    where id = p_session_id and worker_id = uid
    for update;
  if s.id is null then
    raise exception 'EVALUATION_SESSION_INVALID';
  end if;

  -- Reintento de un envío ya registrado: eco de la misma evaluación
  if s.submitted_at is not null then
    select * into e from public.evaluations where id = s.evaluation_id;
    if e.id is null then
      raise exception 'EVALUATION_SESSION_INVALID';
    end if;
    return json_build_object(
      'id', e.id, 'worker_id', e.worker_id, 'score', e.score, 'status', e.status,
      'completed_at', e.completed_at, 'breakdown', e.breakdown, 'replayed', true
    );
  end if;

  v_elapsed := floor(extract(epoch from clock_timestamp() - s.started_at));
  -- La batería dura unos 4 minutos; menos de 60 s no es una ejecución real
  if v_elapsed < 60 then
    raise exception 'EVALUATION_TOO_FAST';
  end if;
  if v_elapsed > 1800 then
    raise exception 'EVALUATION_SESSION_EXPIRED';
  end if;

  -- score/status provisorios: el trigger los recalcula desde el desglose
  insert into public.evaluations (worker_id, score, status, breakdown, session_id, duration_seconds)
    values (uid, 0, 'no', p_breakdown, s.id, v_elapsed)
    returning * into e;
  update private.evaluation_sessions
    set submitted_at = clock_timestamp(), evaluation_id = e.id
    where id = s.id;

  return json_build_object(
    'id', e.id, 'worker_id', e.worker_id, 'score', e.score, 'status', e.status,
    'completed_at', e.completed_at, 'breakdown', e.breakdown, 'replayed', false
  );
end;
$$;

revoke all on function public.submit_evaluation(uuid, jsonb) from public, anon;
grant execute on function public.submit_evaluation(uuid, jsonb) to authenticated;
