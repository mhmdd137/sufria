-- =============================================================================
-- Sufria — Migration 0020: the transfer payment's two enum values (brief م-هـ-أ)
--
-- A restaurant in Gaza is paid by transfer, not cash: «ما في كاش بغزة» (two of
-- two restaurants visited, field notes, 19 October 2026). An order of such a
-- restaurant is `payment_method = 'transfer'`, waiting as `pending_transfer`.
--
-- 🔴 The values alone, and nothing that uses them. Postgres refuses a new enum
--    value inside the transaction that added it ("unsafe use of new value"),
--    and the runner applies each file in one transaction (scripts/migrate.mjs).
--    Every use — the CHECKs, the restaurant's column — is 0021's.
-- =============================================================================
BEGIN;

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'pending_transfer';

COMMIT;
