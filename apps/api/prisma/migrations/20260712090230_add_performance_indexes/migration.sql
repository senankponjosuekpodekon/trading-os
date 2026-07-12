-- CreateIndex
CREATE INDEX "journal_entries_userId_createdAt_idx" ON "journal_entries"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_positionId_idx" ON "journal_entries"("positionId");

-- CreateIndex
CREATE INDEX "portfolios_userId_idx" ON "portfolios"("userId");

-- CreateIndex
CREATE INDEX "positions_portfolioId_idx" ON "positions"("portfolioId");

-- CreateIndex
CREATE INDEX "positions_portfolioId_status_idx" ON "positions"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "positions_assetId_idx" ON "positions"("assetId");

-- CreateIndex
CREATE INDEX "positions_status_idx" ON "positions"("status");

-- CreateIndex
CREATE INDEX "signals_assetId_createdAt_idx" ON "signals"("assetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "signals_createdAt_idx" ON "signals"("createdAt" DESC);
