-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('scheduled', 'done', 'cancelled');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'kaspi';

-- AlterTable
ALTER TABLE "DayClosing" ADD COLUMN     "cashTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isClosed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kaspiTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mastersTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedById" TEXT,
ADD COLUMN     "revenue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salonShare" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visitCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "status" "VisitStatus" NOT NULL DEFAULT 'done';

-- CreateTable
CREATE TABLE "DayOff" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DayOff_date_idx" ON "DayOff"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DayOff_masterId_date_key" ON "DayOff"("masterId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "Visit_visitDate_status_idx" ON "Visit"("visitDate", "status");
