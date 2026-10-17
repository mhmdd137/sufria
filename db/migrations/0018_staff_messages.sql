-- =============================================================================
-- 0018: brief م-ج — the restaurant writes to its customer from the dashboard.
--
-- staff_messages: every text a staff member sent to an order's customer, from
-- the moment they pressed «send». The dashboard writes the row
-- (send_state 'pending'); the Conversation Engine sends it on its own timer
-- and moves it forward: pending → sending → sent | failed. Never backwards,
-- never deleted by the application.
--
-- Not in outbound_messages (0013): a staff text lives here alone — with its
-- state, its author and Meta's id — so the order's conversation shows it
-- once. The engine sends it through its raw sender, not the saving wrapper.
--
-- The bot keeps quiet for a customer while their latest staff message that
-- did not fail is younger than its silence_until (written by the dashboard,
-- on the database's clock), unless, after that message:
--   - the customer wrote «منيو», or staff pressed «رجّع للبوت» —
--     customers.bot_resumed_at;
--   - or the message's order was completed, cancelled or expired —
--     its order_status_history row.
-- app.bot_silence() is that rule, in one place, for the engine and the
-- dashboard alike. A failed message never silences: the silence goes back to
-- what the previous message made it, with nothing to undo.
-- =============================================================================

BEGIN;

CREATE TABLE staff_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL,
  -- Who pressed «send». NULL only once the account is gone.
  staff_account_id uuid NULL REFERENCES staff_accounts(id) ON DELETE SET NULL,
  -- The screen's own id for this message: a second press, or a request sent
  -- again, finds the first row instead of sending twice.
  client_id        uuid NOT NULL,
  body             text NOT NULL CHECK (btrim(body) <> ''),
  send_state       text NOT NULL DEFAULT 'pending'
                   CHECK (send_state IN ('pending', 'sending', 'sent', 'failed')),
  failure          text NULL
                   CHECK (failure IN ('expired', 'send_failed', 'window_closed', 'no_sender_number')),
  -- Meta's error code when Meta refused the send (131047: the 24 hours).
  meta_error_code  integer NULL,
  -- Meta's id for the sent message (wamid.*): what a delivery status names,
  -- when the dashboard shows one.
  wa_message_id    text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The end of the bot's silence this message makes: created_at plus
  -- BOT_SILENCE_MINUTES, written by the dashboard.
  silence_until    timestamptz NOT NULL,
  claimed_at       timestamptz NULL,
  finished_at      timestamptz NULL,

  -- The tenant key of 0013: another restaurant's order cannot be named here.
  FOREIGN KEY (order_id, restaurant_id)
    REFERENCES orders (id, restaurant_id) ON DELETE CASCADE,
  UNIQUE (restaurant_id, client_id),
  CHECK (silence_until > created_at),
  CHECK ((send_state = 'failed') = (failure IS NOT NULL))
);

-- An order's staff messages in time order — the conversation's read, and the
-- silence's (through orders.customer_id).
CREATE INDEX idx_staff_messages_order
  ON staff_messages (order_id, created_at);

-- The engine's queue: only what waits or is being sent.
CREATE INDEX idx_staff_messages_queue
  ON staff_messages (restaurant_id, created_at)
  WHERE send_state IN ('pending', 'sending');

-- -----------------------------------------------------------------------------
-- RLS. The shape of 0006 and 0013, verbatim.
-- -----------------------------------------------------------------------------
ALTER TABLE staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_messages
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_messages TO sufria_dashboard, sufria_engine;

-- -----------------------------------------------------------------------------
-- The last time the bot was handed back to this customer: «منيو» from them
-- (the engine) or «رجّع للبوت» on the dashboard. A staff message older than
-- this no longer keeps the bot quiet.
-- -----------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN bot_resumed_at timestamptz NULL;

-- -----------------------------------------------------------------------------
-- app.bot_silence(customer): the order whose staff message keeps the bot
-- quiet, and until when — or no row.
--
-- SECURITY INVOKER (the default) on purpose: it runs under the caller's RLS,
-- so a customer of another restaurant gives no row. Every time is the
-- database's: now(), and the rows' own created_at and changed_at.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.bot_silence(p_customer_id uuid)
  RETURNS TABLE (silenced_order_id uuid, silenced_until timestamptz)
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    WITH last_message AS (
      SELECT s.order_id, s.created_at, s.silence_until
        FROM staff_messages s
        JOIN orders o ON o.id = s.order_id
       WHERE o.customer_id = p_customer_id
         AND s.send_state <> 'failed'
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 1
    )
    SELECT m.order_id, m.silence_until
      FROM last_message m
      JOIN customers c ON c.id = p_customer_id
     WHERE m.silence_until > now()
       AND (c.bot_resumed_at IS NULL OR c.bot_resumed_at < m.created_at)
       AND NOT EXISTS (
             SELECT 1
               FROM order_status_history h
              WHERE h.order_id = m.order_id
                AND h.to_status IN ('completed', 'cancelled', 'expired')
                AND h.changed_at > m.created_at)
  $$;

REVOKE ALL ON FUNCTION app.bot_silence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bot_silence(uuid) TO sufria_dashboard, sufria_engine;

-- -----------------------------------------------------------------------------
-- Bypass #5: which restaurants have a staff message to send. The shape of
-- Bypass #4 (0012), for the same reason: the engine's timer has no inbound
-- message and so no tenant context, and under RLS it reads zero rows. Output:
-- restaurant ids and nothing else; every read and write after it runs under
-- RLS, inside runInTenant. EXECUTE for sufria_engine alone. The pinned
-- search_path is what keeps a caller's schema from shadowing staff_messages.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.restaurants_with_pending_staff_messages()
  RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT s.restaurant_id
      FROM staff_messages s
      JOIN restaurants    r ON r.id = s.restaurant_id
     WHERE s.send_state IN ('pending', 'sending')
       AND r.status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.restaurants_with_pending_staff_messages() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restaurants_with_pending_staff_messages() FROM sufria_dashboard;
GRANT EXECUTE ON FUNCTION app.restaurants_with_pending_staff_messages() TO sufria_engine;

COMMIT;
