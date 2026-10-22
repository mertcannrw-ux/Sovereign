-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "projects_realm_id_sort_order_idx" ON "projects"("realm_id", "sort_order");
