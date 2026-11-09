-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "category" "MasterCategory" NOT NULL,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMin" INTEGER NOT NULL,
    "priceMax" INTEGER,
    "openEnded" BOOLEAN NOT NULL DEFAULT false,
    "details" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_category_groupName_name_key" ON "Service"("category", "groupName", "name");
