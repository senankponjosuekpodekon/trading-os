# Query Performance Audit — trading-os DB

**Date** : 16/07/2026  
**Database** : `trading_os` @ `localhost:5433`  
**Script** : `apps/api/scripts/explain_analyze_critical_queries.sql`

## Summary

All critical queries execute in **< 1 ms** on the current dataset. Several still show `Seq Scan` because the tables contain very few rows (e.g. 12 signals, 9 positions). PostgreSQL correctly chooses a sequential scan in those cases; the execution plan will switch to index scans as volumes grow.

## Query-by-query results

| # | Query | Plan | Exec time | Status |
|---|-------|------|-----------|--------|
| 1 | Signals by asset sorted by createdAt | Seq Scan (table: 12 rows) | 0.07 ms | OK — index `signals_assetId_createdAt_idx` exists, will be used at scale |
| 2 | Active signals feed | Seq Scan (table: 12 rows) | 0.03 ms | OK — index `signals_isActive_createdAt_idx` exists |
| 3 | Positions by portfolio + status | Seq Scan (table: 9 rows) | 0.03 ms | OK — index `positions_portfolioId_status_idx` exists |
| 4 | Open positions for user (join) | Nested Loop + Bitmap on `portfolios_userId_idx` | 0.07 ms | OK |
| 5 | Refresh token by hash | Index Scan on `refresh_tokens_token_hash_idx` | 0.03 ms | Good |
| 6 | User by email | Index Scan on `users_email_key` | 0.02 ms | Good |
| 7 | Portfolios by user | Bitmap Index Scan on `portfolios_userId_idx` | 0.03 ms | Good |
| 8 | Signal logs by symbol/timeframe | Index Scan on `signal_logs_symbol_timeframe_created_at_idx` | 0.02 ms | Good |
| 9 | Notifications by user sorted | Bitmap Index Scan on `notifications_userId_createdAt_idx` | 0.03 ms | Good |
| 10 | Journal entries by user sorted | Bitmap Index Scan on `journal_entries_userId_createdAt_idx` | 0.03 ms | Good |
| 11 | Daily alert count | Index Scan on `notifications_type_createdAt_idx` + filter user_id | 0.27 ms | Suboptimal — see recommendation |

## Recommendations

1. **Daily alert count (query 11)**
   - Currently uses index `(type, created_at)` then filters `user_id`.
   - Better index: `@@index([user_id, type, created_at])` on `Notification`.
   - Or keep the existing `notifications_userId_createdAt_idx` and write the count as:
     ```sql
     SELECT COUNT(*) FROM "notifications"
     WHERE "user_id" = '...'
       AND "type" = 'SIGNAL'
       AND "created_at" >= CURRENT_DATE;
     ```
     PostgreSQL will prefer the user_id index and apply the type filter.

2. **Watch for growth on signals / positions**
   - `Seq Scan` plans are expected with <100 rows.
   - Monitor `EXPLAIN` again once signals > 10k rows and positions > 1k rows.

3. **Composite index review**
   - `(assetId, createdAt DESC)` on signals is correct.
   - `(isActive, createdAt DESC)` is correct for the active feed.
   - `(portfolioId, status, openedAt DESC)` could replace `(portfolioId, status)` if this exact ordering becomes hot.

## How to re-run

```bash
cd apps/api
PGPASSWORD=trading_pass psql -h localhost -p 5433 -U trading_user -d trading_os \
  -f scripts/explain_analyze_critical_queries.sql \
  > reports/query_performance_audit.txt
```
