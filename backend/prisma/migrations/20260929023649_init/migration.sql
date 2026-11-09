-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OPERATOR', 'SUPERVISOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Crew" AS ENUM ('7x7', '4x3');

-- CreateEnum
CREATE TYPE "TrafficLight" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "SupervisorDecision" AS ENUM ('AUTORIZAR_REEVALUACION', 'REASIGNACION_TAREA', 'DERIVACION_POLICLINICO', 'SUSPENSION_TURNO');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'TOTEM', 'SYSTEM', 'ANONYMOUS');

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "pseudonym_id" UUID NOT NULL,
    "ficha_id" VARCHAR(8) NOT NULL,
    "rut_encrypted" TEXT NOT NULL,
    "rut_hash" CHAR(64) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "position" VARCHAR(80) NOT NULL,
    "company" VARCHAR(120),
    "crew" "Crew" NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pin_hash" TEXT NOT NULL,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totems" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "location" VARCHAR(120),
    "key_hash" CHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "totems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "totem_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mean_latency_ms" INTEGER NOT NULL,
    "median_reaction_time_ms" INTEGER NOT NULL,
    "omissions" INTEGER NOT NULL,
    "false_starts" INTEGER NOT NULL,
    "total_stimuli" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "computed_status" "TrafficLight" NOT NULL,
    "status" "TrafficLight" NOT NULL,
    "scoring_version" VARCHAR(16) NOT NULL,
    "supervisor_decision" "SupervisorDecision",
    "supervisor_note_encrypted" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "voided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32),
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(256),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workers_pseudonym_id_key" ON "workers"("pseudonym_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_ficha_id_key" ON "workers"("ficha_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_rut_hash_key" ON "workers"("rut_hash");

-- CreateIndex
CREATE INDEX "workers_crew_active_idx" ON "workers"("crew", "active");

-- CreateIndex
CREATE INDEX "workers_role_idx" ON "workers"("role");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_session_id_key" ON "evaluations"("session_id");

-- CreateIndex
CREATE INDEX "evaluations_subject_id_created_at_idx" ON "evaluations"("subject_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluations_status_created_at_idx" ON "evaluations"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluations_created_at_idx" ON "evaluations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluations_totem_id_idx" ON "evaluations"("totem_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_totem_id_fkey" FOREIGN KEY ("totem_id") REFERENCES "totems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Bitácora de auditoría de solo inserción: la BD rechaza UPDATE y DELETE
-- (defensa en profundidad además de la capa de repositorios).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_logs_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo inserción (operación % no permitida)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();

-- Rangos válidos de métricas y puntaje (además de la validación Zod en la API)
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_score_range" CHECK ("score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "evaluations_metrics_non_negative" CHECK (
    "mean_latency_ms" > 0 AND "median_reaction_time_ms" > 0 AND "omissions" >= 0
    AND "false_starts" >= 0 AND "total_stimuli" > 0 AND "duration_seconds" > 0
  ),
  ADD CONSTRAINT "evaluations_void_consistency" CHECK (
    ("voided_at" IS NULL AND "void_reason" IS NULL AND "voided_by_id" IS NULL)
    OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "voided_by_id" IS NOT NULL)
  );
