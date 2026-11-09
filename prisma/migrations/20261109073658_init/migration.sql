-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'master');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'transfer');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'paid');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assignedMasterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "clientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "visitDate" DATE NOT NULL,
    "masterId" TEXT NOT NULL,
    "clientId" TEXT,
    "amount" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitAdjustment" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "oldAmount" INTEGER NOT NULL,
    "newAmount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClosing" (
    "id" TEXT NOT NULL,
    "closingDate" DATE NOT NULL,
    "expectedCash" INTEGER NOT NULL,
    "actualCash" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "DayClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "calculatedAmount" INTEGER NOT NULL,
    "adjustmentAmount" INTEGER NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT,
    "finalAmount" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE INDEX "Visit_visitDate_masterId_idx" ON "Visit"("visitDate", "masterId");

-- CreateIndex
CREATE UNIQUE INDEX "DayClosing_closingDate_key" ON "DayClosing"("closingDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_masterId_periodStart_periodEnd_key" ON "Payout"("masterId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_assignedMasterId_fkey" FOREIGN KEY ("assignedMasterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitAdjustment" ADD CONSTRAINT "VisitAdjustment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
