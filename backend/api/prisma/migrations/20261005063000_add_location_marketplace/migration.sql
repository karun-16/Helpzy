-- Location-based marketplace.
--
-- One `locations` row per tradable place, identified by (state, district, city) and
-- addressed by a derived slug. `ProfessionalProfile.locationId` then replaces
-- free-text city matching with an exact reference.
--
-- Deliberately non-destructive: the new column is nullable and no existing row is
-- given a location. A professional with a null location is simply absent from every
-- city's marketplace until they complete their profile, which is honest - inventing
-- a city for them could list them somewhere they do not work.

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "stateCode" CHAR(2) NOT NULL,
    "state" TEXT NOT NULL,
    "districtSlug" VARCHAR(64) NOT NULL,
    "district" TEXT NOT NULL,
    "citySlug" VARCHAR(64) NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "isMajor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_slug_key" ON "locations"("slug");

-- AlterTable
ALTER TABLE "professional_profiles" ADD COLUMN "locationId" UUID;

-- CreateIndex
CREATE INDEX "professional_profiles_location_id_key" ON "professional_profiles"("locationId");

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;