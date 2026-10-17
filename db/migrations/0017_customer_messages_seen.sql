-- 0017: brief م-ب — when the restaurant last read an order's customer
-- messages. A message relayed to the order (0016) after this is unread: the
-- card shows it with a count, and a closed order with one comes back to
-- «الطلبات». NULL = never opened since a message came. Written by the
-- dashboard alone (POST /orders/:id/messages/seen), never moved backwards.
BEGIN;

ALTER TABLE orders
  ADD COLUMN customer_messages_seen_at timestamptz NULL;

COMMIT;
