-- AlterEnum
ALTER TYPE "PositionStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "originalQuantity" DECIMAL(65,30),
ADD COLUMN     "partialExitAt" TIMESTAMP(3),
ADD COLUMN     "partialExitPrice" DECIMAL(65,30),
ADD COLUMN     "partialPnl" DECIMAL(65,30),
ADD COLUMN     "takeProfit2" DECIMAL(65,30);
