-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('main', 'addon', 'option');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "kind" "ServiceKind" NOT NULL DEFAULT 'main';

-- CreateTable
CREATE TABLE "VisitItem" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "priceMin" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "belowMinReason" TEXT,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitItem_visitId_idx" ON "VisitItem"("visitId");

-- AddForeignKey
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
