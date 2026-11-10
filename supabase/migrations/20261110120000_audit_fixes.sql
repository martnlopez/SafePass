-- Correcciones de la auditoría de seguridad run-1 (2026-11-10)
--   A1  La evaluación solo se registra dentro de una sesión emitida por el servidor
--       (duración mínima, un envío por sesión, sin INSERT directo).
--   A2  El "Pase Excepcional" es de un solo uso.
--   A3  La validación del pase se hace en el servidor y considera la elegibilidad actual;
--       el pase APTO vence a las 12 h del test, no de la emisión.
--   +   Bloqueo por trabajador contra carreras, y un supervisor no decide sobre sí mismo.

-- ── A1: sesiones de evaluación ─────────────────────────────────────────
create table private.evaluation_sessions (
  id             uuid primary key default gen_random_uuid(),
  worker_id      uuid not null references public.workers (id) on delete cascade,
  started_at     timestamptz not null default clock_timestamp(),
  submitted_at   timestamptz,
  evaluation_id  uuid references public.evaluations (id) on delete set null
);
create index evaluation_sessions_worker_idx on private.evaluation_sessions (worker_id, started_at desc);
alter table private.evaluation_sessions enable row level security;
revoke all on private.evaluation_sessions from public, anon, authenticated;

alter table public.evaluations
  add column session_id uuid unique,
  add column duration_seconds integer check (duration_seconds is null or duration_seconds >= 0);
comment on column public.evaluations.session_id is 'Sesión emitida por start_evaluation; nulo solo en filas anteriores a 2026-11-10.';
comment on column public.evaluations.duration_seconds is 'Segundos entre el inicio de la sesión y el envío, medidos por el servidor.';

-- Ya no se inserta directamente: solo a través de submit_evaluation
revoke insert on public.evaluations from authenticated;

-- Reglas para iniciar una evaluación (las usan start_evaluation y el trigger)
create or replace function private.assert_can_evaluate(p_worker uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval public.evaluations%rowtype;
  last_dec  public.decisions%rowtype;
begin
  select * into last_eval from public.evaluations
    where worker_id = p_worker order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = p_worker order by decided_at desc limit 1;

  if last_eval.id is not null and last_eval.completed_at > clock_timestamp() - interval '2 minutes' then
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
     and last_eval.completed_at > clock_timestamp() - interval '5 minutes'
     and not (last_dec.id is not null and last_dec.decided_at >= last_eval.completed_at
              and last_dec.decision = 'retest' and last_dec.consumed_at is not null) then
    raise exception 'RETEST_COOLDOWN'
      using hint = 'Debes completar el descanso preventivo de 5 minutos.';
  end if;
end;
$$;

create or replace function private.evaluations_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.session_id is null then
    raise exception 'EVALUATION_SESSION_REQUIRED';
  end if;

  -- Serializa las escrituras del mismo trabajador (evita carreras entre reglas e inserción)
  perform pg_advisory_xact_lock(hashtextextended(new.worker_id::text, 0));

  -- El cliente solo aporta el desglose: puntaje, estado y hora los fija el servidor
  new.score := private.battery_score(new.breakdown);
  new.status := case when new.score >= 80 then 'apto' when new.score >= 60 then 'semi' else 'no' end;
  new.completed_at := clock_timestamp();

  perform private.assert_can_evaluate(new.worker_id);
  return new;
end;
$$;

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

  insert into private.evaluation_sessions (worker_id) values (uid) returning id into v_id;
  return v_id;
end;
$$;

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
  if s.id is null or s.submitted_at is not null then
    raise exception 'EVALUATION_SESSION_INVALID';
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
    'completed_at', e.completed_at, 'breakdown', e.breakdown
  );
end;
$$;

-- ── Decisiones: un supervisor no decide sobre sí mismo ─────────────────
create or replace function private.decisions_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval public.evaluations%rowtype;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.decided_at := clock_timestamp();
  new.seen_at := null;
  new.consumed_at := null;

  -- Inserción del sistema desde evaluations_after_insert (NO APTO automático)
  if pg_trigger_depth() > 1 then
    new.decided_by := null;
    new.decided_by_ficha := null;
    return new;
  end if;

  if not (select private.is_supervisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if new.worker_id = (select auth.uid()) then
    raise exception 'SELF_DECISION_NOT_ALLOWED'
      using hint = 'Otro supervisor debe decidir sobre tu evaluación.';
  end if;

  new.decided_by := (select auth.uid());
  select ficha_id into new.decided_by_ficha from public.workers where id = new.decided_by;
  -- Se ignora cualquier evaluation_id enviado por el cliente
  select * into last_eval from public.evaluations
    where worker_id = new.worker_id order by completed_at desc limit 1;
  new.evaluation_id := last_eval.id;
  new.evaluation_score := last_eval.score;
  new.evaluation_status := last_eval.status;
  return new;
end;
$$;

-- ── A2: pase excepcional de un solo uso; pase APTO vence a las 12 h del test ─
create or replace function public.issue_access_pass()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  last_eval public.evaluations%rowtype;
  last_dec  public.decisions%rowtype;
  existing  public.access_passes%rowtype;
  v_reason  text;
  v_since   timestamptz;
  v_expires timestamptz;
  v_code    text;
  v_pass    public.access_passes%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not (select private.is_active_worker()) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select * into last_eval from public.evaluations
    where worker_id = uid order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = uid order by decided_at desc limit 1;

  if last_dec.id is not null and last_dec.decision = 'pase'
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at) then
    v_reason := 'pase_excepcional';
    v_since := last_dec.decided_at;
    v_expires := clock_timestamp() + interval '12 hours';
  elsif last_eval.status = 'apto' and last_eval.completed_at > clock_timestamp() - interval '12 hours'
     and (last_dec.id is null or last_dec.decided_at < last_eval.completed_at) then
    v_reason := 'apto';
    v_since := last_eval.completed_at;
    v_expires := last_eval.completed_at + interval '12 hours';
  else
    raise exception 'PASS_NOT_ALLOWED'
      using hint = 'No hay un resultado APTO vigente ni un pase autorizado por tu supervisor.';
  end if;

  -- Idempotente: devuelve el pase vigente emitido para este resultado o decisión
  select * into existing from public.access_passes
    where worker_id = uid and expires_at > clock_timestamp() and issued_at >= v_since
    order by issued_at desc limit 1;

  if existing.id is not null then
    v_pass := existing;
  elsif v_reason = 'pase_excepcional' and last_dec.consumed_at is not null then
    raise exception 'PASS_NOT_ALLOWED'
      using hint = 'El pase excepcional ya fue utilizado.';
  else
    loop
      v_code := 'SP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from public.access_passes where code = v_code);
    end loop;
    insert into public.access_passes (code, worker_id, reason, issued_at, expires_at)
      values (v_code, uid, v_reason, clock_timestamp(), v_expires)
      returning * into v_pass;
  end if;

  if v_reason = 'pase_excepcional' and last_dec.consumed_at is null then
    update public.decisions set consumed_at = clock_timestamp() where id = last_dec.id;
  end if;

  return json_build_object(
    'id', v_pass.id,
    'code', v_pass.code,
    'ficha_id', (select ficha_id from public.workers where id = uid),
    'issued_at', v_pass.issued_at,
    'expires_at', v_pass.expires_at
  );
end;
$$;

-- ── A3: validación del pase en el servidor, según la elegibilidad actual ─
create or replace function public.validate_pass(p_code text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  p        public.access_passes%rowtype;
  w        public.workers%rowtype;
  v_status text;
  v_reason text;
begin
  if not (select private.is_supervisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_code is null or p_code !~ '^SP-[0-9A-F]{6}$' then
    return json_build_object('status', 'invalid');
  end if;

  select * into p from public.access_passes where code = p_code;
  if p.id is null then
    return json_build_object('status', 'invalid');
  end if;
  select * into w from public.workers where id = p.worker_id;

  if not w.active then
    v_status := 'revoked'; v_reason := 'account_disabled';
  elsif exists (select 1 from public.decisions d
                 where d.worker_id = p.worker_id and d.decided_at > p.issued_at and d.decision <> 'pase') then
    v_status := 'revoked'; v_reason := 'supervisor_decision';
  elsif exists (select 1 from public.evaluations e
                 where e.worker_id = p.worker_id and e.completed_at > p.issued_at and e.status <> 'apto') then
    v_status := 'revoked'; v_reason := 'later_evaluation';
  elsif p.expires_at <= clock_timestamp() then
    v_status := 'expired';
  else
    v_status := 'valid';
  end if;

  return json_build_object(
    'status', v_status, 'reason', v_reason,
    'id', p.id, 'code', p.code, 'issued_at', p.issued_at, 'expires_at', p.expires_at,
    'ficha_id', w.ficha_id, 'full_name', w.full_name, 'position', w.position, 'company', w.company
  );
end;
$$;

-- ── Permisos ───────────────────────────────────────────────────────────
revoke all on function private.assert_can_evaluate(uuid) from public, anon, authenticated;
revoke all on function private.evaluations_before_insert() from public, anon, authenticated;
revoke all on function private.decisions_before_insert() from public, anon, authenticated;
revoke all on function public.start_evaluation() from public, anon;
revoke all on function public.submit_evaluation(uuid, jsonb) from public, anon;
revoke all on function public.validate_pass(text) from public, anon;
revoke all on function public.issue_access_pass() from public, anon;
grant execute on function public.start_evaluation() to authenticated;
grant execute on function public.submit_evaluation(uuid, jsonb) to authenticated;
grant execute on function public.validate_pass(text) to authenticated;
grant execute on function public.issue_access_pass() to authenticated;
