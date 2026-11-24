-- ═══════════════════════════════════════════════════════════════════════════
-- SafePass · script de creación de la base de datos (PostgreSQL 17 / Supabase)
--
-- Crea la base desde cero: tablas, restricciones, seguridad por fila (RLS), triggers
-- y funciones del servidor. Es la unión, en orden cronológico, de las migraciones de
-- supabase/migrations/ (la fuente de verdad); si una cambia, se vuelve a generar este archivo.
--
-- Requisitos: un proyecto Supabase vacío (aporta el esquema auth y los roles anon /
-- authenticated). Ejecutar completo en el editor SQL, o con: supabase db push
-- No incluye datos: los usuarios se crean en Supabase Auth (ver db/README.md).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261109120000_init_safepass.sql
-- ───────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════
-- SafePass · esquema inicial (Supabase / PostgreSQL 17)
--
-- El frontend se conecta directo con la clave publicable. La seguridad la dan:
--   · Supabase Auth: cada Ficha ID es un usuario (email interno + PIN).
--   · RLS: el trabajador solo ve lo suyo; el supervisor ve todo.
--   · Triggers y funciones del servidor: reglas de re-evaluación, decisiones
--     automáticas y emisión de pases (el cliente no puede saltárselas).
-- Las inserciones sin usuario (auth.uid() nulo: migraciones, seeds, service role)
-- no pasan por las reglas de negocio.
-- ═══════════════════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ── Tablas ─────────────────────────────────────────────────────────────

create table public.workers (
  id          uuid primary key references auth.users (id) on delete cascade,
  ficha_id    text not null unique check (ficha_id ~ '^[A-Z]{3}-[0-9]{4}$'),
  full_name   text not null check (char_length(full_name) between 3 and 120),
  position    text not null default 'Sin registro' check (char_length(position) <= 80),
  company     text check (char_length(company) <= 120),
  shift       text not null default 'Día' check (shift in ('Día', 'Noche')),
  app_role    text not null default 'worker' check (app_role in ('worker', 'supervisor')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.workers is 'Perfil de cada Ficha ID (1:1 con auth.users).';

create table public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.workers (id) on delete cascade,
  score         smallint not null check (score between 0 and 100),
  status        text not null check (status in ('apto', 'semi', 'no')),
  breakdown     jsonb check (breakdown is null or jsonb_typeof(breakdown) = 'array'),
  completed_at  timestamptz not null default now(),
  constraint evaluations_status_matches_score check (
    (status = 'apto' and score >= 80)
    or (status = 'semi' and score between 60 and 79)
    or (status = 'no' and score < 60)
  )
);
create index evaluations_worker_completed_idx on public.evaluations (worker_id, completed_at desc);
create index evaluations_completed_idx on public.evaluations (completed_at desc);
comment on table public.evaluations is 'Resultado de cada batería (escala 0-100: apto 80-100, semi 60-79, no 0-59).';

create table public.decisions (
  id                 uuid primary key default gen_random_uuid(),
  worker_id          uuid not null references public.workers (id) on delete cascade,
  decision           text not null check (decision in ('retest', 'pase', 'revision', 'reasignar', 'policlinico', 'suspender')),
  note               text check (note is null or char_length(note) <= 280),
  decided_by         uuid references public.workers (id) on delete set null,
  decided_by_ficha   text,
  decided_at         timestamptz not null default now(),
  evaluation_id      uuid references public.evaluations (id) on delete set null,
  evaluation_score   smallint check (evaluation_score between 0 and 100),
  evaluation_status  text check (evaluation_status in ('apto', 'semi', 'no')),
  seen_at            timestamptz,
  consumed_at        timestamptz
);
create index decisions_worker_decided_idx on public.decisions (worker_id, decided_at desc);
comment on table public.decisions is 'Decisiones del supervisor (decided_by nulo = automática por NO APTO).';
comment on column public.decisions.note is 'Comentario visible para el trabajador: sin diagnósticos ni datos médicos.';

create table public.access_passes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^SP-[0-9A-F]{6}$'),
  worker_id   uuid not null references public.workers (id) on delete cascade,
  reason      text not null check (reason in ('apto', 'pase_excepcional')),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index access_passes_worker_idx on public.access_passes (worker_id, issued_at desc);

-- ── Funciones auxiliares (esquema privado, no expuesto por la API) ─────

create or replace function private.is_supervisor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workers
    where id = (select auth.uid()) and app_role = 'supervisor' and active
  );
$$;
revoke all on function private.is_supervisor() from public, anon;
grant execute on function private.is_supervisor() to authenticated;

-- ── Vistas: último resultado / última decisión por trabajador (respetan RLS) ──

create view public.latest_evaluations with (security_invoker = on) as
  select distinct on (worker_id) * from public.evaluations
  order by worker_id, completed_at desc;

create view public.latest_decisions with (security_invoker = on) as
  select distinct on (worker_id) * from public.decisions
  order by worker_id, decided_at desc;

-- ── RLS ────────────────────────────────────────────────────────────────

alter table public.workers enable row level security;
alter table public.evaluations enable row level security;
alter table public.decisions enable row level security;
alter table public.access_passes enable row level security;

revoke all on public.workers, public.evaluations, public.decisions, public.access_passes from anon;
revoke all on public.latest_evaluations, public.latest_decisions from anon;
-- Nadie modifica ni borra desde el cliente: decisiones y pases cambian solo vía funciones del servidor
revoke update, delete, truncate on public.workers, public.evaluations, public.decisions, public.access_passes from authenticated;
revoke insert on public.workers, public.access_passes from authenticated;

create policy "workers: perfil propio o supervisor" on public.workers
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_supervisor()));

create policy "evaluations: propias o supervisor" on public.evaluations
  for select to authenticated
  using (worker_id = (select auth.uid()) or (select private.is_supervisor()));

create policy "evaluations: el trabajador registra las suyas" on public.evaluations
  for insert to authenticated
  with check (worker_id = (select auth.uid()));

create policy "decisions: propias o supervisor" on public.decisions
  for select to authenticated
  using (worker_id = (select auth.uid()) or (select private.is_supervisor()));

create policy "decisions: solo el supervisor decide" on public.decisions
  for insert to authenticated
  with check ((select private.is_supervisor()));

create policy "access_passes: propios o supervisor" on public.access_passes
  for select to authenticated
  using (worker_id = (select auth.uid()) or (select private.is_supervisor()));

-- ── Reglas de re-evaluación (antes de guardar una evaluación) ──────────
-- · Decisión posterior al último resultado y aún no usada → requiere al supervisor
--   (revisión pendiente, reasignación, derivación, suspensión, o un re-test/pase sin usar).
-- · SEMI-APTO: descanso de 5 min, salvo re-test autorizado y ya iniciado.

create or replace function private.evaluations_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval public.evaluations%rowtype;
  last_dec  public.decisions%rowtype;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.completed_at := now();

  select * into last_eval from public.evaluations
    where worker_id = new.worker_id order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = new.worker_id order by decided_at desc limit 1;

  if last_dec.id is not null
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at)
     and last_dec.consumed_at is null then
    raise exception 'SUPERVISOR_AUTHORIZATION_REQUIRED'
      using hint = 'Tu último resultado requiere una indicación de tu supervisor.';
  end if;

  if last_eval.status = 'semi'
     and last_eval.completed_at > now() - interval '5 minutes'
     and not (last_dec.id is not null and last_dec.decided_at >= last_eval.completed_at
              and last_dec.decision = 'retest' and last_dec.consumed_at is not null) then
    raise exception 'RETEST_COOLDOWN'
      using hint = 'Debes completar el descanso preventivo de 5 minutos.';
  end if;

  return new;
end;
$$;

create trigger evaluations_before_insert
  before insert on public.evaluations
  for each row execute function private.evaluations_before_insert();

-- NO APTO → el caso queda en "Revisión pendiente" hasta que el supervisor decida
create or replace function private.evaluations_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.status = 'no' then
    insert into public.decisions (worker_id, decision, evaluation_id, evaluation_score, evaluation_status)
    values (new.worker_id, 'revision', new.id, new.score, new.status);
  end if;
  return new;
end;
$$;

create trigger evaluations_after_insert
  after insert on public.evaluations
  for each row execute function private.evaluations_after_insert();

-- Decisiones: hora, autor y resultado de referencia los fija el servidor
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

  new.decided_at := now();
  new.seen_at := null;
  new.consumed_at := null;

  if (select private.is_supervisor()) then
    new.decided_by := (select auth.uid());
    select ficha_id into new.decided_by_ficha from public.workers where id = new.decided_by;
  else
    -- Inserción del sistema (NO APTO automático)
    new.decided_by := null;
    new.decided_by_ficha := null;
  end if;

  if new.evaluation_id is null then
    select * into last_eval from public.evaluations
      where worker_id = new.worker_id order by completed_at desc limit 1;
    new.evaluation_id := last_eval.id;
    new.evaluation_score := last_eval.score;
    new.evaluation_status := last_eval.status;
  end if;

  return new;
end;
$$;

create trigger decisions_before_insert
  before insert on public.decisions
  for each row execute function private.decisions_before_insert();

-- ── Funciones que llama el frontend (RPC) ──────────────────────────────

-- El trabajador vio la decisión al ingresar
create or replace function public.mark_decision_seen(p_decision_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.decisions set seen_at = coalesce(seen_at, now())
  where id = p_decision_id and worker_id = (select auth.uid());
$$;

-- Re-test autorizado: solo tras 15 min desde la notificación del supervisor
create or replace function public.start_authorized_retest(p_decision_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.decisions%rowtype;
begin
  select * into d from public.decisions
    where id = p_decision_id and worker_id = (select auth.uid());
  if d.id is null or d.decision <> 'retest' then
    raise exception 'DECISION_NOT_FOUND';
  end if;
  if d.consumed_at is not null then
    return;
  end if;
  if now() < d.decided_at + interval '15 minutes' then
    raise exception 'RETEST_REST_PENDING'
      using hint = 'El descanso de 15 minutos aún no termina.';
  end if;
  update public.decisions set consumed_at = now() where id = d.id;
end;
$$;

-- Emite el pase de acceso: resultado APTO (últimas 12 h) o Pase Excepcional sin usar
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
  v_code    text;
  v_pass    public.access_passes%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into last_eval from public.evaluations
    where worker_id = uid order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = uid order by decided_at desc limit 1;

  if last_dec.id is not null and last_dec.decision = 'pase'
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at) then
    v_reason := 'pase_excepcional';
  elsif last_eval.status = 'apto' and last_eval.completed_at > now() - interval '12 hours'
     and (last_dec.id is null or last_dec.decided_at < last_eval.completed_at) then
    v_reason := 'apto';
  else
    raise exception 'PASS_NOT_ALLOWED'
      using hint = 'No hay un resultado APTO vigente ni un pase autorizado por tu supervisor.';
  end if;

  -- Idempotente: si ya hay un pase vigente emitido después del último resultado, se devuelve el mismo
  select * into existing from public.access_passes
    where worker_id = uid and expires_at > now()
      and issued_at >= coalesce(last_eval.completed_at, '-infinity'::timestamptz)
    order by issued_at desc limit 1;

  if existing.id is not null then
    v_pass := existing;
  else
    loop
      v_code := 'SP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from public.access_passes where code = v_code);
    end loop;
    insert into public.access_passes (code, worker_id, reason, expires_at)
      values (v_code, uid, v_reason, now() + interval '12 hours')
      returning * into v_pass;
  end if;

  if v_reason = 'pase_excepcional' and last_dec.consumed_at is null then
    update public.decisions set consumed_at = now() where id = last_dec.id;
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

revoke all on function public.mark_decision_seen(uuid) from public, anon;
revoke all on function public.start_authorized_retest(uuid) from public, anon;
revoke all on function public.issue_access_pass() from public, anon;
grant execute on function public.mark_decision_seen(uuid) to authenticated;
grant execute on function public.start_authorized_retest(uuid) to authenticated;
grant execute on function public.issue_access_pass() to authenticated;

-- Las funciones de trigger no se invocan directamente
revoke all on function private.evaluations_before_insert() from public, anon, authenticated;
revoke all on function private.evaluations_after_insert() from public, anon, authenticated;
revoke all on function private.decisions_before_insert() from public, anon, authenticated;

-- ── Tiempo real: el panel del supervisor se actualiza al instante ──────
alter publication supabase_realtime add table public.evaluations, public.decisions;

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261109123000_clock_timestamps.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Las marcas de tiempo que fija el servidor usan clock_timestamp() (hora real de cada
-- sentencia) en vez de now() (hora de inicio de la transacción). Así el orden
-- "resultado → decisión automática → pase" nunca empata, aunque ocurra en la misma transacción.

create or replace function private.evaluations_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval public.evaluations%rowtype;
  last_dec  public.decisions%rowtype;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.completed_at := clock_timestamp();

  select * into last_eval from public.evaluations
    where worker_id = new.worker_id order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = new.worker_id order by decided_at desc limit 1;

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

  return new;
end;
$$;

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

  if (select private.is_supervisor()) then
    new.decided_by := (select auth.uid());
    select ficha_id into new.decided_by_ficha from public.workers where id = new.decided_by;
  else
    new.decided_by := null;
    new.decided_by_ficha := null;
  end if;

  if new.evaluation_id is null then
    select * into last_eval from public.evaluations
      where worker_id = new.worker_id order by completed_at desc limit 1;
    new.evaluation_id := last_eval.id;
    new.evaluation_score := last_eval.score;
    new.evaluation_status := last_eval.status;
  end if;

  return new;
end;
$$;

create or replace function public.start_authorized_retest(p_decision_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.decisions%rowtype;
begin
  select * into d from public.decisions
    where id = p_decision_id and worker_id = (select auth.uid());
  if d.id is null or d.decision <> 'retest' then
    raise exception 'DECISION_NOT_FOUND';
  end if;
  if d.consumed_at is not null then
    return;
  end if;
  if clock_timestamp() < d.decided_at + interval '15 minutes' then
    raise exception 'RETEST_REST_PENDING'
      using hint = 'El descanso de 15 minutos aún no termina.';
  end if;
  update public.decisions set consumed_at = clock_timestamp() where id = d.id;
end;
$$;

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
  v_code    text;
  v_pass    public.access_passes%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into last_eval from public.evaluations
    where worker_id = uid order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = uid order by decided_at desc limit 1;

  if last_dec.id is not null and last_dec.decision = 'pase'
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at) then
    v_reason := 'pase_excepcional';
  elsif last_eval.status = 'apto' and last_eval.completed_at > clock_timestamp() - interval '12 hours'
     and (last_dec.id is null or last_dec.decided_at < last_eval.completed_at) then
    v_reason := 'apto';
  else
    raise exception 'PASS_NOT_ALLOWED'
      using hint = 'No hay un resultado APTO vigente ni un pase autorizado por tu supervisor.';
  end if;

  -- Idempotente: si ya hay un pase vigente emitido después del último resultado, se devuelve el mismo
  select * into existing from public.access_passes
    where worker_id = uid and expires_at > clock_timestamp()
      and issued_at >= coalesce(last_eval.completed_at, '-infinity'::timestamptz)
    order by issued_at desc limit 1;

  if existing.id is not null then
    v_pass := existing;
  else
    loop
      v_code := 'SP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from public.access_passes where code = v_code);
    end loop;
    insert into public.access_passes (code, worker_id, reason, issued_at, expires_at)
      values (v_code, uid, v_reason, clock_timestamp(), clock_timestamp() + interval '12 hours')
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

-- create or replace conserva los permisos; se reafirman por claridad
revoke all on function public.start_authorized_retest(uuid) from public, anon;
revoke all on function public.issue_access_pass() from public, anon;
grant execute on function public.start_authorized_retest(uuid) to authenticated;
grant execute on function public.issue_access_pass() to authenticated;
revoke all on function private.evaluations_before_insert() from public, anon, authenticated;
revoke all on function private.decisions_before_insert() from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261109140000_security_hardening.sql
-- ───────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════
-- SafePass · endurecimiento de seguridad (revisión del 2026-11-09)
--
-- Hallazgos confirmados y corregidos:
--  1. Un trabajador podía registrar un puntaje inventado (ej. 100 sin desglose)
--     llamando la API directo, y obtener el pase sin rendir el test.
--     → El servidor exige el desglose completo de las 5 pruebas, recalcula el
--       puntaje global y el estado, y no confía en los valores del cliente.
--  2. Una cuenta desactivada seguía pudiendo leer, registrar evaluaciones y obtener pases.
--     → Todas las políticas y funciones exigen una cuenta activa.
--  3. Se podían registrar evaluaciones en ráfaga.
--     → Mínimo 2 minutos entre evaluaciones del mismo trabajador.
--  4. El supervisor podía asociar una decisión a una evaluación de otra persona.
--     → El resultado de referencia lo fija siempre el servidor.
--  5. Permisos sobrantes: escritura en vistas y ejecución de rls_auto_enable por anon.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Cuenta activa ──────────────────────────────────────────────────────
create or replace function private.is_active_worker()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.workers where id = (select auth.uid()) and active);
$$;
revoke all on function private.is_active_worker() from public, anon;
grant execute on function private.is_active_worker() to authenticated;

drop policy "workers: perfil propio o supervisor" on public.workers;
create policy "workers: perfil propio activo o supervisor" on public.workers
  for select to authenticated
  using ((id = (select auth.uid()) and active) or (select private.is_supervisor()));

drop policy "evaluations: propias o supervisor" on public.evaluations;
create policy "evaluations: propias (cuenta activa) o supervisor" on public.evaluations
  for select to authenticated
  using ((worker_id = (select auth.uid()) and (select private.is_active_worker())) or (select private.is_supervisor()));

drop policy "evaluations: el trabajador registra las suyas" on public.evaluations;
create policy "evaluations: el trabajador activo registra las suyas" on public.evaluations
  for insert to authenticated
  with check (worker_id = (select auth.uid()) and (select private.is_active_worker()));

drop policy "decisions: propias o supervisor" on public.decisions;
create policy "decisions: propias (cuenta activa) o supervisor" on public.decisions
  for select to authenticated
  using ((worker_id = (select auth.uid()) and (select private.is_active_worker())) or (select private.is_supervisor()));

drop policy "access_passes: propios o supervisor" on public.access_passes;
create policy "access_passes: propios (cuenta activa) o supervisor" on public.access_passes
  for select to authenticated
  using ((worker_id = (select auth.uid()) and (select private.is_active_worker())) or (select private.is_supervisor()));

-- ── Validación del desglose: el puntaje lo calcula el servidor ─────────
-- Exactamente una entrada por prueba, puntajes enteros 0-100 y textos acotados.
create or replace function private.battery_score(p_breakdown jsonb)
returns smallint
language plpgsql immutable set search_path = ''
as $$
declare
  item  jsonb;
  keys  text[] := '{}';
  total int := 0;
  s     numeric;
begin
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'array' or jsonb_array_length(p_breakdown) <> 5
     or pg_column_size(p_breakdown) > 4096 then
    raise exception 'INVALID_BREAKDOWN';
  end if;
  for item in select * from jsonb_array_elements(p_breakdown) loop
    if jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'score') <> 'number'
       or jsonb_typeof(item -> 'key') <> 'string'
       or jsonb_typeof(item -> 'name') <> 'string'
       or jsonb_typeof(item -> 'detail') <> 'string'
       or char_length(item ->> 'name') > 60
       or char_length(item ->> 'detail') > 160 then
      raise exception 'INVALID_BREAKDOWN';
    end if;
    s := (item ->> 'score')::numeric;
    if s <> trunc(s) or s < 0 or s > 100 then
      raise exception 'INVALID_BREAKDOWN';
    end if;
    keys := keys || (item ->> 'key');
    total := total + s::int;
  end loop;
  if (select array_agg(k order by k) from unnest(keys) k) <> array['figuras', 'gonogo', 'memoria', 'pvt', 'tracking'] then
    raise exception 'INVALID_BREAKDOWN';
  end if;
  return round(total / 5.0)::smallint;
end;
$$;
revoke all on function private.battery_score(jsonb) from public, anon, authenticated;

create or replace function private.evaluations_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  last_eval public.evaluations%rowtype;
  last_dec  public.decisions%rowtype;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  -- El cliente solo aporta el desglose: puntaje, estado y hora los fija el servidor
  new.score := private.battery_score(new.breakdown);
  new.status := case when new.score >= 80 then 'apto' when new.score >= 60 then 'semi' else 'no' end;
  new.completed_at := clock_timestamp();

  select * into last_eval from public.evaluations
    where worker_id = new.worker_id order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = new.worker_id order by decided_at desc limit 1;

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

  return new;
end;
$$;

-- ── Decisiones: el resultado de referencia siempre lo fija el servidor ─
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

  if (select private.is_supervisor()) then
    new.decided_by := (select auth.uid());
    select ficha_id into new.decided_by_ficha from public.workers where id = new.decided_by;
    -- Se ignora cualquier evaluation_id enviado por el cliente
    select * into last_eval from public.evaluations
      where worker_id = new.worker_id order by completed_at desc limit 1;
    new.evaluation_id := last_eval.id;
    new.evaluation_score := last_eval.score;
    new.evaluation_status := last_eval.status;
  else
    -- Inserción del sistema (NO APTO automático): trae su propia evaluación
    new.decided_by := null;
    new.decided_by_ficha := null;
  end if;

  return new;
end;
$$;

-- ── Funciones RPC: exigen cuenta activa ────────────────────────────────
create or replace function public.mark_decision_seen(p_decision_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.decisions set seen_at = coalesce(seen_at, clock_timestamp())
  where id = p_decision_id and worker_id = (select auth.uid()) and (select private.is_active_worker());
$$;

create or replace function public.start_authorized_retest(p_decision_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.decisions%rowtype;
begin
  if not (select private.is_active_worker()) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  select * into d from public.decisions
    where id = p_decision_id and worker_id = (select auth.uid());
  if d.id is null or d.decision <> 'retest' then
    raise exception 'DECISION_NOT_FOUND';
  end if;
  if d.consumed_at is not null then
    return;
  end if;
  if clock_timestamp() < d.decided_at + interval '15 minutes' then
    raise exception 'RETEST_REST_PENDING'
      using hint = 'El descanso de 15 minutos aún no termina.';
  end if;
  update public.decisions set consumed_at = clock_timestamp() where id = d.id;
end;
$$;

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
  v_code    text;
  v_pass    public.access_passes%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not (select private.is_active_worker()) then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  select * into last_eval from public.evaluations
    where worker_id = uid order by completed_at desc limit 1;
  select * into last_dec from public.decisions
    where worker_id = uid order by decided_at desc limit 1;

  if last_dec.id is not null and last_dec.decision = 'pase'
     and (last_eval.id is null or last_dec.decided_at >= last_eval.completed_at) then
    v_reason := 'pase_excepcional';
  elsif last_eval.status = 'apto' and last_eval.completed_at > clock_timestamp() - interval '12 hours'
     and (last_dec.id is null or last_dec.decided_at < last_eval.completed_at) then
    v_reason := 'apto';
  else
    raise exception 'PASS_NOT_ALLOWED'
      using hint = 'No hay un resultado APTO vigente ni un pase autorizado por tu supervisor.';
  end if;

  select * into existing from public.access_passes
    where worker_id = uid and expires_at > clock_timestamp()
      and issued_at >= coalesce(last_eval.completed_at, '-infinity'::timestamptz)
    order by issued_at desc limit 1;

  if existing.id is not null then
    v_pass := existing;
  else
    loop
      v_code := 'SP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from public.access_passes where code = v_code);
    end loop;
    insert into public.access_passes (code, worker_id, reason, issued_at, expires_at)
      values (v_code, uid, v_reason, clock_timestamp(), clock_timestamp() + interval '12 hours')
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

revoke all on function public.mark_decision_seen(uuid) from public, anon;
revoke all on function public.start_authorized_retest(uuid) from public, anon;
revoke all on function public.issue_access_pass() from public, anon;
grant execute on function public.mark_decision_seen(uuid) to authenticated;
grant execute on function public.start_authorized_retest(uuid) to authenticated;
grant execute on function public.issue_access_pass() to authenticated;
revoke all on function private.evaluations_before_insert() from public, anon, authenticated;
revoke all on function private.decisions_before_insert() from public, anon, authenticated;

-- ── Permisos sobrantes ─────────────────────────────────────────────────
revoke insert, update, delete, truncate on public.latest_evaluations, public.latest_decisions from authenticated;
-- rls_auto_enable la crea la plataforma; en un entorno nuevo puede no existir
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261109141000_fk_indexes.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Índices para las claves foráneas de decisions (recomendación del asesor de rendimiento de Supabase)
create index if not exists decisions_decided_by_idx on public.decisions (decided_by);
create index if not exists decisions_evaluation_id_idx on public.decisions (evaluation_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261110120000_audit_fixes.sql
-- ───────────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261110150000_idempotent_submit.sql
-- ───────────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261112120000_flag_suspicious_evaluations.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Marca de resultados sospechosos (docs/DECISIONES.md, D9).
-- El navegador del trabajador nunca es de fiar: un programa a medida puede abrir una sesión,
-- esperar y enviar puntajes inventados. El servidor no lo puede impedir del todo, pero sí
-- detectar lo atípico y avisar al supervisor. La marca NO bloquea nada (un falso positivo no
-- debe impedir la entrada a faena) y solo la puede leer el supervisor.

create table private.evaluation_flags (
  evaluation_id uuid primary key references public.evaluations (id) on delete cascade,
  flags         text[] not null check (cardinality(flags) > 0),
  created_at    timestamptz not null default clock_timestamp()
);
alter table private.evaluation_flags enable row level security;
revoke all on private.evaluation_flags from public, anon, authenticated;

-- Reglas de la marca. Devuelve los códigos que aplican (arreglo vacío = sin sospecha):
--   muy_rapido            la batería completa tardó menos de 2 min (una real toma unos 4)
--   puntajes_identicos    las 5 pruebas con exactamente el mismo puntaje
--   perfecto_y_rapido     las 5 pruebas ≥ 98 y menos de 3 min
--   detalle_no_estandar   el texto de detalle de una prueba no tiene el formato que genera la app
--   gonogo_incoherente    el puntaje de Go/No-Go no cuadra con sus aciertos y falsos positivos
--   memoria_incoherente   el puntaje de Memoria no cuadra con los niveles superados
create or replace function private.evaluation_flags_for(p_breakdown jsonb, p_duration integer)
returns text[]
language plpgsql immutable set search_path = ''
as $$
declare
  flags    text[] := '{}';
  scores   integer[];
  e        jsonb;
  m        text[];
  expected integer;
begin
  select array_agg((x ->> 'score')::integer) into scores from jsonb_array_elements(p_breakdown) x;

  if p_duration < 120 then
    flags := array_append(flags, 'muy_rapido'::text);
  end if;
  if (select count(distinct s) from unnest(scores) s) = 1 then
    flags := array_append(flags, 'puntajes_identicos'::text);
  end if;
  if (select min(s) from unnest(scores) s) >= 98 and p_duration < 180 then
    flags := array_append(flags, 'perfecto_y_rapido'::text);
  end if;

  -- El texto de detalle lo arma la app con un formato fijo por prueba
  for e in select x from jsonb_array_elements(p_breakdown) x loop
    if not ((e ->> 'detail') ~ case e ->> 'key'
         when 'figuras'  then '^Precisión [0-9]{1,3}% · TR [0-9]{1,5}ms$'
         when 'pvt'      then '^TR medio [0-9]{1,5}ms · [0-9]{1,3} lapsos$'
         when 'gonogo'   then '^Aciertos [0-9]{1,3}% · Falsos \+ [0-9]{1,3}%$'
         when 'memoria'  then '^Span máx\. [0-9] casillas · [0-3]/3 niveles$'
         when 'tracking' then '^[0-9]{1,3} series · [0-9]{1,4} errores$'
         else '^$'
       end) then
      flags := array_append(flags, 'detalle_no_estandar'::text);
      exit;
    end if;
  end loop;

  -- Go/No-Go: puntaje = round((aciertos × 0,5 + (1 − falsos) × 0,5) × 100); el texto trae los % redondeados
  select x into e from jsonb_array_elements(p_breakdown) x where x ->> 'key' = 'gonogo';
  m := regexp_match(e ->> 'detail', '^Aciertos ([0-9]{1,3})% · Falsos \+ ([0-9]{1,3})%$');
  if m is not null then
    expected := round(greatest(0, (m[1]::numeric / 100) * 0.5 + (1 - m[2]::numeric / 100) * 0.5) * 100);
    if abs(expected - (e ->> 'score')::integer) > 2 then
      flags := array_append(flags, 'gonogo_incoherente'::text);
    end if;
  end if;

  -- Memoria: puntaje = round(niveles superados / 3 × 100)
  select x into e from jsonb_array_elements(p_breakdown) x where x ->> 'key' = 'memoria';
  m := regexp_match(e ->> 'detail', '^Span máx\. [0-9] casillas · ([0-3])/3 niveles$');
  if m is not null then
    expected := round(m[1]::numeric / 3 * 100);
    if abs(expected - (e ->> 'score')::integer) > 1 then
      flags := array_append(flags, 'memoria_incoherente'::text);
    end if;
  end if;

  return flags;
end;
$$;
revoke all on function private.evaluation_flags_for(jsonb, integer) from public, anon, authenticated;

-- submit_evaluation: igual que antes (sesión del servidor, idempotente) y además registra la marca.
-- La respuesta al trabajador NO incluye las marcas.
create or replace function public.submit_evaluation(p_session_id uuid, p_breakdown jsonb)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  s         private.evaluation_sessions%rowtype;
  e         public.evaluations%rowtype;
  v_elapsed integer;
  v_flags   text[];
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

  -- score/status provisorios: el trigger los recalcula desde el desglose (y valida su forma)
  insert into public.evaluations (worker_id, score, status, breakdown, session_id, duration_seconds)
    values (uid, 0, 'no', p_breakdown, s.id, v_elapsed)
    returning * into e;
  update private.evaluation_sessions
    set submitted_at = clock_timestamp(), evaluation_id = e.id
    where id = s.id;

  -- Marca de sospecha (no bloquea): se calcula sobre el desglose ya validado por el trigger
  v_flags := private.evaluation_flags_for(e.breakdown, v_elapsed);
  if cardinality(v_flags) > 0 then
    insert into private.evaluation_flags (evaluation_id, flags) values (e.id, v_flags);
  end if;

  return json_build_object(
    'id', e.id, 'worker_id', e.worker_id, 'score', e.score, 'status', e.status,
    'completed_at', e.completed_at, 'breakdown', e.breakdown, 'replayed', false
  );
end;
$$;
revoke all on function public.submit_evaluation(uuid, jsonb) from public, anon;
grant execute on function public.submit_evaluation(uuid, jsonb) to authenticated;

-- Solo el supervisor lee las marcas, de las evaluaciones vigentes (la última de cada trabajador)
create or replace function public.list_flagged_evaluations()
returns table (evaluation_id uuid, flags text[])
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select private.is_supervisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select f.evaluation_id, f.flags
    from private.evaluation_flags f
    join public.latest_evaluations l on l.id = f.evaluation_id;
end;
$$;
revoke all on function public.list_flagged_evaluations() from public, anon;
grant execute on function public.list_flagged_evaluations() to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Migración: 20261123120000_delayed_submit.sql
-- ───────────────────────────────────────────────────────────────────────────
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
