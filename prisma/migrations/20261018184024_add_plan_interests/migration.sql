-- CreateTable
CREATE TABLE "plan_interests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_interests_plan_idx" ON "plan_interests"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "plan_interests_user_id_plan_key" ON "plan_interests"("user_id", "plan");

-- AddForeignKey
ALTER TABLE "plan_interests" ADD CONSTRAINT "plan_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
