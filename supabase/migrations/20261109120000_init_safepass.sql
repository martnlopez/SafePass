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
