-- AlterTable
ALTER TABLE "signals" ADD COLUMN     "profileSuitability" TEXT[] DEFAULT ARRAY[]::TEXT[];
