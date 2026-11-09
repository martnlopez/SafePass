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
