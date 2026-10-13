-- 0016: brief م-أ — a customer's message after an order reaches the
-- restaurant.
--
-- inbound_messages.order_id: the order the engine relayed this message to.
-- NULL = not relayed (an ordering message, one before any order, a
-- reaction). Tied to the restaurant by the tenant key, as outbound_messages
-- (0013). ON DELETE SET NULL (order_id) — the column list keeps
-- restaurant_id: the customer's own words are the one thing we hold no copy
-- of, and an order going never takes them with it.
--
-- customers.relay_replied_at: the last time the relay line went to this
-- customer; the next waits RELAY_REPLY_QUIET_MINUTES. Read and written under
-- FOR UPDATE on the customer's row.
BEGIN;

ALTER TABLE inbound_messages
  ADD COLUMN order_id uuid NULL;

ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_messages_order_fk
  FOREIGN KEY (order_id, restaurant_id)
  REFERENCES orders (id, restaurant_id) ON DELETE SET NULL (order_id);

CREATE INDEX idx_inbound_messages_order
  ON inbound_messages (order_id, received_at)
  WHERE order_id IS NOT NULL;

ALTER TABLE customers
  ADD COLUMN relay_replied_at timestamptz NULL;

COMMIT;
