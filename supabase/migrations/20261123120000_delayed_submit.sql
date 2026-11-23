-- Envío diferido por cortes de señal (docs/DECISIONES.md, D10).
-- Antes, la hora oficial del test era la de LLEGADA del envío y la sesión vencía a los 30 min:
-- un test hecho sin señal llegaba con otra hora o se perdía.
-- Ahora:
--   completed_at = inicio de la sesión (hora del servidor) + duración del test informada por la app,
--                  acotada por el servidor: 60 s ≤ duración ≤ 30 min y ≤ tiempo real transcurrido.
--   received_at  = hora real de llegada (la fija el servidor).
--   El envío se acepta hasta 2 h después de abrir la sesión.
-- El cliente sigue sin poder fijar una hora libre: solo puede mover la hora de término dentro de
-- la propia sesión y nunca después de la llegada (ver análisis en D10). Los descansos se miden
-- con la hora de llegada y solo vale la sesión más reciente.

alter table public.evaluations add column received_at timestamptz;
-- Filas anteriores: llegada = término (así funcionaba)
update public.evaluations set received_at = completed_at where received_at is null;
alter table public.evaluations alter column received_at set default clock_timestamp();
comment on column public.evaluations.received_at is 'Hora en que el resultado llegó al servidor (puede ser posterior a completed_at si hubo corte de señal).';
comment on column public.evaluations.completed_at is 'Hora de término del test: inicio de la sesión + duración (acotada por el servidor). Desde 2026-11-23.';
comment on column public.evaluations.duration_seconds is 'Duración del test (60–1800 s), informada por la app y acotada por el servidor. Antes del 2026-11-23: segundos entre el inicio de la sesión y el envío.';

-- La vista se definió con "select *": se recrea para que incluya received_at (mismas columnas + la nueva al final)
create or replace view public.latest_evaluations with (security_invoker = on) as
  select distinct on (worker_id) * from public.evaluations
  order by worker_id, completed_at desc;

-- Solo vale la sesión de test más reciente: abrir una nueva invalida las anteriores sin envío.
-- Así no se pueden tener sesiones abiertas de antemano para elegir la hora de término.
alter table private.evaluation_sessions add column superseded_at timestamptz;
comment on column private.evaluation_sessions.superseded_at is 'Se abrió otra sesión del mismo trabajador antes de enviar esta: ya no acepta envíos.';

-- Los descansos (2 min entre tests, 5 min tras SEMI APTO) se miden con la hora de LLEGADA, que
-- fija el servidor: la hora de término la informa en parte la app y no debe acortar un descanso.
create or replace function private.assert_can_evaluate(p_worker uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval      public.evaluations%rowtype;
  last_dec       public.decisions%rowtype;
  v_last_arrival timestamptz;
begin
  select * into last_eval from public.evaluations
    where worker_id = p_worker order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = p_worker order by decided_at desc limit 1;
  select max(coalesce(received_at, completed_at)) into v_last_arrival
    from public.evaluations where worker_id = p_worker;

  if v_last_arrival is not null and v_last_arrival > clock_timestamp() - interval '2 minutes' then
    raise exception 'EVALUATION_TOO_SOON'
      using hint = 'Ya registraste una evaluación hace menos de 2 minutos.';
  end if;

  if last_dec.id is not null
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at)
     and last_dec.consumed_at is null then
    raise exception 'SUPERVISOR_AUTHORIZATION_REQUIRED'
      using hint = 'Tu último resultado requiere una indicación de tu supervisor.';
  end if;

  if last_eval.status = 'semi'
     and coalesce(last_eval.received_at, last_eval.completed_at) > clock_timestamp() - interval '5 minutes'
     and not (last_dec.id is not null and last_dec.decided_at >= last_eval.completed_at
              and last_dec.decision = 'retest' and last_dec.consumed_at is not null) then
    raise exception 'RETEST_COOLDOWN'
      using hint = 'Debes completar el descanso preventivo de 5 minutos.';
  end if;
end;
$$;
revoke all on function private.assert_can_evaluate(uuid) from public, anon, authenticated;

create or replace function public.start_evaluation()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  v_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not (select private.is_active_worker()) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  perform private.assert_can_evaluate(uid);

  if (select count(*) from private.evaluation_sessions
        where worker_id = uid and started_at > clock_timestamp() - interval '1 hour') >= 10 then
    raise exception 'TOO_MANY_SESSIONS'
      using hint = 'Demasiados intentos de evaluación en la última hora.';
  end if;

  update private.evaluation_sessions
    set superseded_at = clock_timestamp()
    where worker_id = uid and submitted_at is null and superseded_at is null;

  insert into private.evaluation_sessions (worker_id) values (uid) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.start_evaluation() from public, anon;
grant execute on function public.start_evaluation() to authenticated;

-- El trigger ya no pisa completed_at con la hora de llegada: la calcula submit_evaluation.
-- Defensa extra: nunca en el futuro ni antes del inicio de la sesión.
create or replace function private.evaluations_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_started timestamptz;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.session_id is null then
    raise exception 'EVALUATION_SESSION_REQUIRED';
  end if;

  -- Serializa las escrituras del mismo trabajador (evita carreras entre reglas e inserción)
  perform pg_advisory_xact_lock(hashtextextended(new.worker_id::text, 0));

  -- El cliente solo aporta el desglose: puntaje y estado los fija el servidor
  new.score := private.battery_score(new.breakdown);
  new.status := case when new.score >= 80 then 'apto' when new.score >= 60 then 'semi' else 'no' end;

  new.received_at := clock_timestamp();
  select started_at into v_started from private.evaluation_sessions where id = new.session_id;
  if v_started is null then
    raise exception 'EVALUATION_SESSION_INVALID';
  end if;
  new.completed_at := greatest(least(new.completed_at, new.received_at), v_started);

  perform private.assert_can_evaluate(new.worker_id);
  return new;
end;
$$;
revoke all on function private.evaluations_before_insert() from public, anon, authenticated;

-- Nueva firma con la duración (opcional: una app sin actualizar sigue funcionando como antes)
drop function public.submit_evaluation(uuid, jsonb);

create or replace function public.submit_evaluation(
  p_session_id uuid,
  p_breakdown jsonb,
  p_duration_seconds integer default null
)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  uid        uuid := (select auth.uid());
  s          private.evaluation_sessions%rowtype;
  e          public.evaluations%rowtype;
  v_elapsed  integer;
  v_duration integer;
  v_flags    text[];
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
      'completed_at', e.completed_at, 'received_at', e.received_at, 'breakdown', e.breakdown, 'replayed', true
    );
  end if;

  -- Se abrió una sesión más nueva: esta ya no acepta envíos
  if s.superseded_at is not null then
    raise exception 'EVALUATION_SESSION_EXPIRED';
  end if;

  -- Tiempo real desde que el servidor abrió la sesión
  v_elapsed := floor(extract(epoch from clock_timestamp() - s.started_at));
  -- La batería dura unos 4 minutos; menos de 60 s no es una ejecución real
  if v_elapsed < 60 then
    raise exception 'EVALUATION_TOO_FAST';
  end if;
  -- Plazo de entrega con cortes de señal: 2 h desde que se abrió la sesión
  if v_elapsed > 7200 then
    raise exception 'EVALUATION_SESSION_EXPIRED';
  end if;

  if p_duration_seconds is null then
    -- App sin actualizar: la duración es el tiempo hasta la llegada (regla anterior)
    v_duration := v_elapsed;
  else
    v_duration := p_duration_seconds;
  end if;
  if v_duration < 60 then
    raise exception 'EVALUATION_TOO_FAST';
  end if;
  if v_duration > 1800 then
    raise exception 'EVALUATION_SESSION_EXPIRED';
  end if;
  -- La app no puede decir que el test duró más que el tiempo real transcurrido
  v_duration := least(v_duration, v_elapsed);

  -- score/status provisorios: el trigger los recalcula desde el desglose (y valida su forma)
  insert into public.evaluations (worker_id, score, status, breakdown, session_id, duration_seconds, completed_at)
    values (uid, 0, 'no', p_breakdown, s.id, v_duration, s.started_at + make_interval(secs => v_duration))
    returning * into e;
  update private.evaluation_sessions
    set submitted_at = clock_timestamp(), evaluation_id = e.id
    where id = s.id;

  -- Marca de sospecha (no bloquea): se calcula sobre el desglose ya validado por el trigger
  v_flags := private.evaluation_flags_for(e.breakdown, v_duration);
  if cardinality(v_flags) > 0 then
    insert into private.evaluation_flags (evaluation_id, flags) values (e.id, v_flags);
  end if;

  return json_build_object(
    'id', e.id, 'worker_id', e.worker_id, 'score', e.score, 'status', e.status,
    'completed_at', e.completed_at, 'received_at', e.received_at, 'breakdown', e.breakdown, 'replayed', false
  );
end;
$$;
revoke all on function public.submit_evaluation(uuid, jsonb, integer) from public, anon;
grant execute on function public.submit_evaluation(uuid, jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
