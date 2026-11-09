-- Índices para las claves foráneas de decisions (recomendación del asesor de rendimiento de Supabase)
create index if not exists decisions_decided_by_idx on public.decisions (decided_by);
create index if not exists decisions_evaluation_id_idx on public.decisions (evaluation_id);
