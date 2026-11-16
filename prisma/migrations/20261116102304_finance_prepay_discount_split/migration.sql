-- CreateEnum
CREATE TYPE "DiscountBearer" AS ENUM ('master', 'salon', 'shared');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'kaspi_red';
ALTER TYPE "PaymentMethod" ADD VALUE 'halyk';

-- AlterTable
ALTER TABLE "DayClosing" ADD COLUMN     "forfeitedPrepay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "halykTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kaspiRedTotal" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountBearer" "DiscountBearer",
ADD COLUMN     "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "durationMin" INTEGER,
ADD COLUMN     "isBlogger" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listAmount" INTEGER,
ADD COLUMN     "masterAmount" INTEGER,
ADD COLUMN     "prepaidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prepaidMethod" "PaymentMethod",
ADD COLUMN     "salonAmount" INTEGER,
ADD COLUMN     "splitPercent" INTEGER,
ADD COLUMN     "splitWarning" TEXT;
