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
