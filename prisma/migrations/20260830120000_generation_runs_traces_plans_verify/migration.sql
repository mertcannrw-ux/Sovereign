-- CreateEnum
CREATE TYPE "generation_mode" AS ENUM ('PLAN', 'BUILD');

-- CreateEnum
CREATE TYPE "generation_run_status" AS ENUM ('RUNNING', 'WAITING_RUNTIME', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "verify_report_status" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "vercel_project_id" TEXT;

-- CreateTable
CREATE TABLE "agent_plans" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "explanation" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" "generation_mode" NOT NULL DEFAULT 'BUILD',
    "status" "generation_run_status" NOT NULL DEFAULT 'RUNNING',
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "source_message_id" TEXT,
    "plan_id" TEXT,
    "auto_fix_count" INTEGER NOT NULL DEFAULT 0,
    "token_usage" JSONB,
    "error_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_tool_traces" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arguments" JSONB,
    "result" JSONB,
    "status" TEXT NOT NULL,
    "request_id" TEXT,
    "command" TEXT,
    "timeout_ms" INTEGER,
    "expires_at" TIMESTAMP(3),
    "files_revision" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_tool_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verify_reports" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "verify_report_status" NOT NULL,
    "reason" TEXT,
    "channels" JSONB NOT NULL,
    "raw_logs_r2_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verify_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_plans_project_id_created_at_idx" ON "agent_plans"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_runs_project_id_started_at_idx" ON "generation_runs"("project_id", "started_at");

-- CreateIndex
CREATE INDEX "generation_runs_user_id_started_at_idx" ON "generation_runs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "generation_tool_traces_run_id_created_at_idx" ON "generation_tool_traces"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_tool_traces_request_id_idx" ON "generation_tool_traces"("request_id");

-- CreateIndex
CREATE INDEX "generation_tool_traces_created_at_idx" ON "generation_tool_traces"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "verify_reports_run_id_key" ON "verify_reports"("run_id");

-- CreateIndex
CREATE INDEX "verify_reports_project_id_created_at_idx" ON "verify_reports"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "agent_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_tool_traces" ADD CONSTRAINT "generation_tool_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
