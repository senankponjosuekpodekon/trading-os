#!/usr/bin/env python3
"""Migration sélective : copie les données utiles du backup vers la DB active.

Stratégie (Option B) :
- markets / assets / strategies : fusion par nom/symbol, l'ID du backup est conservé
  pour que les positions/signaux anciens restent cohérents.
- users : conserver l'admin actuel, importer l'ancien user si email différent.
- portfolios / user_strategies / signals / positions / journal_entries : import pur.
- rag_documents : ignoré (déjà seedé dans la DB active).
"""
import asyncio
from decimal import Decimal
import asyncpg

OLD_URL = "postgresql://trading_user:trading_pass@localhost:5433/trading_os_old"
NEW_URL = "postgresql://trading_user:trading_pass@localhost:5433/trading_os"


async def migrate():
    old = await asyncpg.connect(OLD_URL)
    new = await asyncpg.connect(NEW_URL)
    try:
        # 1. Markets : fusion par nom, ID backup gagnant
        rows = await old.fetch('SELECT id, name, type, "isActive" FROM markets')
        for r in rows:
            await new.execute(
                """INSERT INTO markets (id, name, type, "isActive")
                   VALUES ($1, $2, $3::"MarketType", $4)
                   ON CONFLICT (name) DO UPDATE SET
                     id = EXCLUDED.id,
                     type = EXCLUDED.type,
                     "isActive" = EXCLUDED."isActive" """,
                r["id"], r["name"], r["type"], r["isActive"],
            )
        print(f"  -> {len(rows)} markets fusionnés")

        # 2. Assets : fusion par symbol, ID backup gagnant
        rows = await old.fetch(
            'SELECT id, symbol, name, "marketId", "baseCurrency", "isActive", metadata FROM assets'
        )
        for r in rows:
            await new.execute(
                """INSERT INTO assets (id, symbol, name, "marketId", "baseCurrency", "isActive", metadata)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (symbol) DO UPDATE SET
                     id = EXCLUDED.id,
                     name = EXCLUDED.name,
                     "marketId" = EXCLUDED."marketId",
                     "baseCurrency" = EXCLUDED."baseCurrency",
                     "isActive" = EXCLUDED."isActive",
                     metadata = EXCLUDED.metadata""",
                r["id"], r["symbol"], r["name"], r["marketId"], r["baseCurrency"], r["isActive"], r["metadata"],
            )
        print(f"  -> {len(rows)} assets fusionnés")

        # 3. Users : garder admin actuel, ajouter l'ancien user
        rows = await old.fetch(
            'SELECT id, email, password, name, role, "isActive", "createdAt", "updatedAt" FROM users'
        )
        imported = 0
        for r in rows:
            res = await new.execute(
                """INSERT INTO users (id, email, password, name, role, "isActive", "createdAt", "updatedAt")
                   VALUES ($1, $2, $3, $4, $5::"UserRole", $6, $7, $8)
                   ON CONFLICT (email) DO NOTHING""",
                r["id"], r["email"], r["password"], r["name"], r["role"], r["isActive"], r["createdAt"], r["updatedAt"],
            )
            if res.endswith("1"):
                imported += 1
        print(f"  -> {imported} ancien(s) user(s) importé(s)")

        # 4. Strategies : fusion par nom, ID backup gagnant
        rows = await old.fetch(
            'SELECT id, name, description, rules, "isActive", "createdAt", "updatedAt" FROM strategies'
        )
        for r in rows:
            await new.execute(
                """INSERT INTO strategies (id, name, description, rules, "isActive", "createdAt", "updatedAt")
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (name) DO UPDATE SET
                     id = EXCLUDED.id,
                     description = EXCLUDED.description,
                     rules = EXCLUDED.rules,
                     "isActive" = EXCLUDED."isActive",
                     "createdAt" = EXCLUDED."createdAt",
                     "updatedAt" = EXCLUDED."updatedAt" """,
                r["id"], r["name"], r["description"], r["rules"], r["isActive"], r["createdAt"], r["updatedAt"],
            )
        print(f"  -> {len(rows)} strategies fusionnées")

        # 5. Portfolios
        rows = await old.fetch(
            'SELECT id, name, type, currency, "initialCapital", "currentCapital", "userId", "createdAt", "updatedAt" FROM portfolios'
        )
        for r in rows:
            await new.execute(
                """INSERT INTO portfolios (id, name, type, currency, "initialCapital", "currentCapital", "userId", "createdAt", "updatedAt")
                   VALUES ($1, $2, $3::"PortfolioType", $4, $5, $6, $7, $8, $9)
                   ON CONFLICT (id) DO NOTHING""",
                r["id"], r["name"], r["type"], r["currency"], r["initialCapital"], r["currentCapital"],
                r["userId"], r["createdAt"], r["updatedAt"],
            )
        print(f"  -> {len(rows)} portfolios importés")

        # 6. UserStrategies
        rows = await old.fetch(
            'SELECT id, "userId", "strategyId", "isEnabled", "customRules", "createdAt" FROM user_strategies'
        )
        for r in rows:
            await new.execute(
                """INSERT INTO user_strategies (id, "userId", "strategyId", "isEnabled", "customRules", "createdAt")
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (id) DO NOTHING""",
                r["id"], r["userId"], r["strategyId"], r["isEnabled"], r["customRules"], r["createdAt"],
            )
        print(f"  -> {len(rows)} user_strategies importées")

        # 7. Signals
        rows = await old.fetch(
            """SELECT id, "assetId", "strategyId", signal, confidence, timeframe, "entryPrice",
                      "stopLoss", "takeProfit1", "takeProfit2", "riskReward", indicators, explanation,
                      "isActive", "expiresAt", "createdAt", metadata
               FROM signals"""
        )
        for r in rows:
            await new.execute(
                """INSERT INTO signals (id, "assetId", "strategyId", signal, confidence, timeframe, "entryPrice",
                                      "stopLoss", "takeProfit1", "takeProfit2", "riskReward", indicators,
                                      explanation, "isActive", "expiresAt", "createdAt", metadata)
                   VALUES ($1, $2, $3, $4::"SignalType", $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                   ON CONFLICT (id) DO NOTHING""",
                r["id"], r["assetId"], r["strategyId"], r["signal"], r["confidence"], r["timeframe"],
                r["entryPrice"], r["stopLoss"], r["takeProfit1"], r["takeProfit2"], r["riskReward"],
                r["indicators"], r["explanation"], r["isActive"], r["expiresAt"], r["createdAt"], r["metadata"],
            )
        print(f"  -> {len(rows)} signaux importés")

        # 8. Positions
        rows = await old.fetch(
            """SELECT id, "portfolioId", "assetId", "signalId", status, direction, "entryPrice",
                      "exitPrice", quantity, "stopLoss", "takeProfit", pnl, "pnlPercent", "openedAt", "closedAt"
               FROM positions"""
        )
        for r in rows:
            await new.execute(
                """INSERT INTO positions (id, "portfolioId", "assetId", "signalId", status, direction, "entryPrice",
                                       "exitPrice", quantity, "stopLoss", "takeProfit", pnl, "pnlPercent",
                                       "openedAt", "closedAt")
                   VALUES ($1, $2, $3, $4, $5::"PositionStatus", $6::"SignalType", $7, $8, $9, $10, $11, $12, $13, $14, $15)
                   ON CONFLICT (id) DO NOTHING""",
                r["id"], r["portfolioId"], r["assetId"], r["signalId"], r["status"], r["direction"],
                r["entryPrice"], r["exitPrice"], r["quantity"], r["stopLoss"], r["takeProfit"],
                r["pnl"], r["pnlPercent"], r["openedAt"], r["closedAt"],
            )
        print(f"  -> {len(rows)} positions importées")

        # 9. JournalEntries
        rows = await old.fetch(
            'SELECT id, "userId", "positionId", title, content, emotion, tags, "createdAt", grade FROM journal_entries'
        )
        for r in rows:
            await new.execute(
                """INSERT INTO journal_entries (id, "userId", "positionId", title, content, emotion, tags, "createdAt", grade)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   ON CONFLICT (id) DO NOTHING""",
                r["id"], r["userId"], r["positionId"], r["title"], r["content"], r["emotion"], r["tags"], r["createdAt"], r["grade"],
            )
        print(f"  -> {len(rows)} entrées de journal importées")

        print("\n✅ Migration sélective terminée.")
    finally:
        await old.close()
        await new.close()


if __name__ == "__main__":
    asyncio.run(migrate())
