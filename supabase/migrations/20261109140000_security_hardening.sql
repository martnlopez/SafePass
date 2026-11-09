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
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
