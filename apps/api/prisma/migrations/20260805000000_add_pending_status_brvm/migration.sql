-- Add PENDING to PositionStatus enum and BRVM support
-- PositionStatus already uses TEXT in the database (Prisma enum), so this is a no-op for TEXT columns.
-- If PositionStatus is a native PG enum, uncomment the ALTER TYPE below.

-- For native PG enum (if applicable):
-- ALTER TYPE "PositionStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- ExchangeName is stored as TEXT, so BRVM is automatically supported.
-- No schema changes needed for BRVM.

-- No data migration needed: the metadata column may not exist yet on all deployments.
