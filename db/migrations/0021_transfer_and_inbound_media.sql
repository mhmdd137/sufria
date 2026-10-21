-- =============================================================================
-- Sufria — Migration 0021: the transfer payment, the accepted notice, and a
-- customer's media (brief م-هـ-أ)
--
-- Four things, each for one of Mohammed's decisions (20 October 2026):
--
-- 1. A restaurant takes one payment method, cash or transfer (decision 3):
--    `restaurants.payment_method`, and the restaurant's own transfer details —
--    its words, sent to the customer as written when an order is accepted
--    (decision 4). A transfer restaurant always has them.
-- 2. A transfer order is `transfer` / `pending_transfer`, and completed it is
--    `collected` like cash: staff checked the transfer in their wallet before
--    «ابدأ التحضير» (decision 5). `orders_collected_is_cash` gives way to a
--    constraint that admits both.
-- 3. `orders.accepted_notice_at`: when the notifier claimed the order's
--    accepted message. The notifier sends the order's status *now*, once
--    every NOTIFY_POLL_MS, so «اقبل» then «ابدأ التحضير» inside one cycle
--    found `preparing`, which is silent — and the accepted message, with a
--    transfer order's details, was never sent. The notifier now sends it in
--    place of `preparing` while this is NULL. Orders already past it are
--    backfilled as notified, or the next status change would send it again.
-- 4. `inbound_media`: a customer's image, voice note or PDF, downloaded from
--    Meta by the engine and kept here (decision 1: Meta keeps a webhook's
--    media 7 days). One row per message, the bytes in `content` once stored.
--    The engine writes it; the dashboard reads it and nothing more.
--    `app.restaurants_with_pending_media()` is Bypass #6, on 0018's shape.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The restaurant's payment method and transfer details.
-- -----------------------------------------------------------------------------
ALTER TABLE restaurants
  ADD COLUMN payment_method   payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN transfer_details text NULL;

ALTER TABLE restaurants
  -- `online` is the gateway's, and no restaurant takes it (brief ج §2.5).
  ADD CONSTRAINT restaurants_payment_method_check
    CHECK (payment_method IN ('cash', 'transfer')),
  -- The restaurant's words, up to 300 characters, never blank. Kept when the
  -- restaurant goes back to cash, so going back to transfer loses nothing.
  ADD CONSTRAINT restaurants_transfer_details_check
    CHECK (transfer_details IS NULL
           OR (char_length(transfer_details) <= 300
               AND btrim(transfer_details, E' \t\r\n') <> '')),
  ADD CONSTRAINT restaurants_transfer_needs_details
    CHECK (payment_method <> 'transfer' OR transfer_details IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 2. The order's transfer payment.
-- -----------------------------------------------------------------------------
ALTER TABLE orders DROP CONSTRAINT orders_collected_is_cash;

ALTER TABLE orders
  -- `collected`: the money is the restaurant's — cash in the till, or a
  -- transfer staff checked. `paid` stays the gateway's.
  ADD CONSTRAINT orders_collected_is_cash_or_transfer
    CHECK (payment_status <> 'collected' OR payment_method IN ('cash', 'transfer')),
  ADD CONSTRAINT orders_pending_transfer_is_transfer
    CHECK (payment_status <> 'pending_transfer' OR payment_method = 'transfer'),
  ADD CONSTRAINT orders_transfer_payment_status
    CHECK (payment_method <> 'transfer'
           OR payment_status IN ('pending_transfer', 'collected'));

-- -----------------------------------------------------------------------------
-- 3. The accepted notice.
-- -----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN accepted_notice_at timestamptz NULL;

-- Past `accepted`, or accepted and already claimed by the notifier: its
-- accepted message went (or was lost, at most once). An accepted order still
-- `notified = false` is left NULL: the notifier has yet to send it.
UPDATE orders
   SET accepted_notice_at = now()
 WHERE status IN ('preparing', 'ready', 'completed', 'expired')
    OR (status = 'accepted' AND notified);

-- -----------------------------------------------------------------------------
-- 4. A customer's media.
-- -----------------------------------------------------------------------------
-- The tenant key of 0013 and 0018: a media row cannot name another
-- restaurant's message, not even by mistake.
ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_messages_id_restaurant_key UNIQUE (id, restaurant_id);

CREATE TABLE inbound_media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  inbound_message_id uuid NOT NULL UNIQUE,
  -- What the dashboard can show: an image, a voice note or audio file, a PDF.
  kind               text NOT NULL CHECK (kind IN ('image', 'audio', 'pdf')),
  -- Meta's media id, from the webhook. Downloadable for 7 days.
  wa_media_id        text NOT NULL CHECK (wa_media_id <> ''),
  -- As Meta sent it: 'image/jpeg', 'audio/ogg; codecs=opus', 'application/pdf'.
  mime_type          text NOT NULL CHECK (mime_type <> ''),
  -- A document's own filename, as the customer's phone sent it.
  file_name          text NULL,
  state              text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending', 'stored', 'failed', 'too_large')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- The queue's clock: a claim moves it forward (the lease), a failure to
  -- its retry. Due when <= now().
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  content            bytea NULL,
  -- The file's size: stored, or the one Meta announced for `too_large`.
  size_bytes         integer NULL CHECK (size_bytes > 0),
  -- An image's pixels, read from its header: the screen keeps its place
  -- before it loads. NULL when the header could not be read.
  width              integer NULL CHECK (width > 0),
  height             integer NULL CHECK (height > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz NULL,
  FOREIGN KEY (inbound_message_id, restaurant_id)
    REFERENCES inbound_messages (id, restaurant_id) ON DELETE CASCADE,
  CHECK ((state = 'stored') = (content IS NOT NULL)),
  CHECK (content IS NULL
         OR (octet_length(content) = size_bytes AND size_bytes <= 5242880)),
  CHECK ((state = 'pending') = (finished_at IS NULL)),
  CHECK ((width IS NULL) = (height IS NULL)),
  CHECK (kind = 'image' OR width IS NULL)
);

-- Already compressed (JPEG, Opus, PDF): compressing again costs time for
-- nothing.
ALTER TABLE inbound_media ALTER COLUMN content SET STORAGE EXTERNAL;

CREATE INDEX idx_inbound_media_queue
  ON inbound_media (restaurant_id, next_attempt_at)
  WHERE state = 'pending';

ALTER TABLE inbound_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_media FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbound_media
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- 0003's default privileges give both roles everything. The engine writes;
-- the dashboard reads, and nothing more: a bug in the API cannot overwrite a
-- customer's receipt.
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_media TO sufria_engine;
GRANT SELECT ON inbound_media TO sufria_dashboard;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON inbound_media FROM sufria_dashboard;

-- -----------------------------------------------------------------------------
-- 5. app.restaurants_with_pending_media() — Bypass #6, 0018's shape: the
--    queue has no inbound message, so no tenant context, and `sufria_engine`
--    sees zero rows without one. Restaurant ids with media due, nothing else.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.restaurants_with_pending_media()
  RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT m.restaurant_id
      FROM inbound_media m
      JOIN restaurants   r ON r.id = m.restaurant_id
     WHERE m.state = 'pending'
       AND m.next_attempt_at <= now()
       AND r.status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.restaurants_with_pending_media() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restaurants_with_pending_media() FROM sufria_dashboard;
GRANT EXECUTE ON FUNCTION app.restaurants_with_pending_media() TO sufria_engine;

COMMIT;
