-- CreateEnum
CREATE TYPE "MasterCategory" AS ENUM ('lash', 'nail', 'lami_brow', 'hair');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "category" "MasterCategory";
