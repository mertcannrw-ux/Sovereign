-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_image" BYTEA,
ADD COLUMN     "avatar_mime" TEXT,
ADD COLUMN     "pending_email" TEXT,
ADD COLUMN     "mascot_animations" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "email" TEXT;
