import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  ORDER_TAB_STATUSES,
  canStaffTransition,
  messageKind,
  type FulfillmentType,
  type HistoryActor,
  type OrderDetail,
  type OrderListItem,
  type OrderListResponse,
  type MessageLocation,
  type OrderMessage,
  type OrderMessagesResponse,
  type OrderStatus,
  type OrderTab,
  type PaymentMethod,
  type PaymentStatus,
  type CreateStaffMessageRequest,
  type StaffMessageFailure,
  type StaffMessageSendState,
  type StaffOrderMessage,
  type StaffTargetStatus,
  type UpdateOrderStatusRequest,
} from "@sufria/shared";
import { env } from "../config/env.js";
import { isoUtc } from "../db/iso-utc.js";
import { TenantDbService, type TenantTx } from "../db/tenant-db.service.js";

/**
 * The §3.1 item projection — one for `GET /orders` and for the reply of
 * `PATCH /orders/:id/status` (brief D §3.3 step 4: "the same query, not a
 * second projection"). Assumes `orders o` and `customers c` in the query that
 * embeds it, and yields an `OrderListRow`.
 *
 * Brief G §3 (G-4) adds three fields for the card: the lines (name and
 * quantity, in the order of `GET /orders/:id`), the time of the last status
 * change, and the cancellation reason. `status_changed_at` is the last
 * history row, or `created_at` for an order that has none (the seeded order
 * of restaurant C) — never a time the screen makes up.
 *
 * Brief م-ب adds two, from the customer messages the engine relayed to the
 * order (`inbound_messages.order_id`, brief م-أ): how many arrived after
 * `customer_messages_seen_at` (0017), and the latest one, read or not — its
 * type and its first 200 characters (the list is polled every 10 seconds,
 * and a WhatsApp text may be 4096). A message of the order's own making
 * names no order and never counts, nor does a reaction (never relayed).
 * Both served by `idx_inbound_messages_order`.
 *
 * Brief م-ج adds one: the latest staff message on the order that did not
 * fail (`staff_messages.created_at`, 0018) — the screen stops a pending
 * order's ringing on it (decision 14). Served by `idx_staff_messages_order`.
 */
const orderListColumns = () => sql`
  o.id,
  o.order_number,
  o.status,
  o.fulfillment_type,
  o.total::text AS total,
  (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id)
    AS item_count,
  ${isoUtc("o.created_at")} AS created_at,
  c.name AS customer_name,
  c.phone_number AS customer_phone,
  COALESCE(
    (SELECT json_agg(json_build_object(
              'name', oi.item_name_snapshot,
              'quantity', oi.quantity,
              'note', oi.notes)
            ORDER BY oi.item_name_snapshot, oi.id)
       FROM order_items oi
      WHERE oi.order_id = o.id),
    '[]'::json) AS items,
  ${isoUtc(
    `COALESCE((SELECT max(h.changed_at) FROM order_status_history h
                WHERE h.order_id = o.id), o.created_at)`,
  )} AS status_changed_at,
  o.cancellation_reason,
  (SELECT count(*)::int
     FROM inbound_messages i
    WHERE i.order_id = o.id
      AND i.restaurant_id = o.restaurant_id
      AND i.message_type <> 'reaction'
      AND i.received_at > COALESCE(o.customer_messages_seen_at,
                                   '-infinity'::timestamptz))
    AS unread_messages,
  (SELECT json_build_object('type', i.message_type, 'body', left(i.body, 200))
     FROM inbound_messages i
    WHERE i.order_id = o.id
      AND i.restaurant_id = o.restaurant_id
      AND i.message_type <> 'reaction'
    ORDER BY i.received_at DESC, i.id DESC
    LIMIT 1) AS last_message,
  ${isoUtc(
    `(SELECT max(s.created_at) FROM staff_messages s
       WHERE s.order_id = o.id
         AND s.restaurant_id = o.restaurant_id
         AND s.send_state <> 'failed')`,
  )} AS staff_messaged_at`;

/**
 * The outcome of a status change — the controller maps it to HTTP (brief D
 * §3.3 and §8.7).
 */
export type StatusChangeOutcome =
  | { kind: "changed"; order: OrderListItem }
  | { kind: "transition_not_allowed" }
  | { kind: "not_found" }
  | { kind: "status_conflict"; currentStatus: OrderStatus }
  | { kind: "payment_not_settled" };

/** Brief D §2.5: 20 per page in the `history` tab, no pages in `active`. */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Brief م-ب: a closed order with an unread message comes back to «الطلبات»
 * while that message is younger than this, by the database's clock.
 */
export const RETURNED_WINDOW = "24 hours";

/** Brief I §4 (I-5): an order's conversation, at most its latest 200. */
export const MESSAGES_LIMIT = 200;

/**
 * Rule 3's window for a customer message's time (brief I §4, I-5): after the
 * customer's order before this one, up to this one, and no older than 24
 * hours before it. Assumes the `o` CTE of `messages`; `time` is a column.
 */
const inWindow = (time: string) =>
  sql.raw(`(${time} > COALESCE(o.prev_at, '-infinity'::timestamptz)
            AND ${time} <= o.created_at
            AND ${time} >= o.created_at - interval '24 hours')`);

/**
 * Brief م-ج, decision 12: the last moment staff can write to a customer —
 * their last message that is not a reaction, plus `minutes`
 * (REPLY_WINDOW_MINUTES); NULL with no message at all. One fragment for the
 * POST's check and the GET's `replyOpenUntil`, so the two never disagree.
 * `restaurant` and `phone` are SQL text — column names written in the code.
 * Served by `idx_inbound_messages_conversation`.
 */
const replyOpenUntil = (restaurant: string, phone: string, minutes: number) =>
  sql`(SELECT max(i.received_at) + make_interval(mins => ${minutes})
         FROM inbound_messages i
        WHERE i.restaurant_id = ${sql.raw(restaurant)}
          AND i.from_phone = ${sql.raw(phone)}
          AND i.message_type <> 'reaction')`;

/**
 * A staff message as the routes return it (brief م-ج): `staff_messages`
 * with its author's name, `staff_accounts.name` — NULL once the account is
 * gone. Assumes `staff_messages s LEFT JOIN staff_accounts a` on the
 * author; yields a `StaffMessageRow`.
 */
const staffMessageColumns = () => sql`
  s.id,
  s.order_id,
  s.body AS text,
  ${isoUtc("s.created_at")} AS at,
  s.send_state,
  s.failure,
  a.name AS staff_name,
  s.client_id`;

/** `staff_messages.send_state` (0018), as the database holds it. */
type StaffMessageDbState = "pending" | "sending" | "sent" | "failed";

type StaffMessageRow = {
  id: string;
  order_id: string;
  text: string;
  at: string;
  send_state: StaffMessageDbState;
  failure: StaffMessageFailure | null;
  staff_name: string | null;
  client_id: string;
};

/**
 * The outcome of `POST /orders/:id/messages` — the controller maps it to
 * HTTP (brief م-ج §4 أ): `created` 201, `existing` 200 (this `clientId`
 * already on this order: the row as it is now).
 */
export type StaffMessageOutcome =
  | { kind: "created"; message: StaffOrderMessage }
  | { kind: "existing"; message: StaffOrderMessage }
  | { kind: "not_found" }
  | { kind: "client_id_reused" }
  | { kind: "reply_window_closed" };

type OrderListRow = {
  id: string;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  total: string;
  item_count: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string;
  items: { name: string; quantity: number; note: string | null }[];
  status_changed_at: string;
  cancellation_reason: string | null;
  unread_messages: number;
  last_message: { type: string; body: string | null } | null;
  staff_messaged_at: string | null;
};

/** A message of `messages` as SQL builds it; `toMessage` names its kind. */
type MessageRow = {
  id: string;
  direction: OrderMessage["direction"];
  type: string;
  text: string | null;
  location: { latitude: unknown; longitude: unknown } | null;
  at: string;
  // A staff message's (brief م-ج); NULL on the customer's and the bot's.
  send_state: StaffMessageDbState | null;
  failure: StaffMessageFailure | null;
  staff_name: string | null;
  client_id: string | null;
};

type OrderDetailRow = {
  id: string;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  subtotal: string;
  delivery_fee: string;
  total: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  delivery_address: string | null;
  cancellation_reason: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string;
  items: {
    name: string;
    quantity: number;
    unit_price: string;
    line_total: string;
    note: string | null;
  }[];
  history: {
    from: OrderStatus | null;
    to: OrderStatus;
    actor: HistoryActor;
    at: string;
  }[];
};

@Injectable()
export class OrdersService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * @param restaurantId from RestaurantContextGuard alone (brief D §8.1).
   *
   * The actual isolation is RLS, through the `runInTenant` context. The
   * explicit `restaurant_id` filter is defence in depth, not the protection:
   * without it the query returns the same rows.
   */
  async list(
    restaurantId: string,
    tab: OrderTab,
    page: number,
  ): Promise<OrderListResponse> {
    const statuses = sql.join(
      ORDER_TAB_STATUSES[tab].map((s) => sql`${s}::order_status`),
      sql`, `,
    );
    // `active`: oldest first, no pages. `history`: newest first, reading 21
    // to know `hasMore` without a COUNT. `id` breaks ties, always in the same
    // direction.
    const isHistory = tab === "history";
    const direction = sql.raw(isHistory ? "DESC" : "ASC");
    const window = isHistory
      ? sql`LIMIT ${HISTORY_PAGE_SIZE + 1} OFFSET ${(page - 1) * HISTORY_PAGE_SIZE}`
      : sql``;

    // `returned` with `active` alone: a second statement in the same
    // transaction (brief م-ب).
    const [res, returned] = await this.tenantDb.runInTenant(
      restaurantId,
      async (tx) =>
        [
          await tx.execute<OrderListRow>(sql`
            SELECT ${orderListColumns()}
              FROM orders o
              JOIN customers c ON c.id = o.customer_id
             WHERE o.restaurant_id = ${restaurantId}::uuid
               AND o.status IN (${statuses})
             ORDER BY o.created_at ${direction}, o.id ${direction}
             ${window}`),
          isHistory ? null : await this.returned(tx, restaurantId),
        ] as const,
    );

    const rows = res.rows;
    const hasMore = isHistory && rows.length > HISTORY_PAGE_SIZE;
    return {
      orders: rows
        .slice(0, isHistory ? HISTORY_PAGE_SIZE : undefined)
        .map(toListItem),
      page: isHistory ? page : 1,
      hasMore,
      returned: returned?.rows.map(toListItem) ?? [],
    };
  }

  /**
   * Brief م-ب: the closed orders a customer wrote to — a status of the
   * history tab, and an unread message relayed to the order received less
   * than 24 hours ago by the database's clock. Newest unread message first,
   * then `id`. Driven from the restaurant's recent messages, not its whole
   * history: `idx_inbound_messages_conversation` leads with `restaurant_id`.
   */
  private returned(tx: TenantTx, restaurantId: string) {
    const closed = sql.join(
      ORDER_TAB_STATUSES.history.map((s) => sql`${s}::order_status`),
      sql`, `,
    );
    return tx.execute<OrderListRow>(sql`
      WITH unread AS (
        SELECT i.order_id, max(i.received_at) AS last_at
          FROM inbound_messages i
          JOIN orders u ON u.id = i.order_id
                       AND u.restaurant_id = i.restaurant_id
         WHERE i.restaurant_id = ${restaurantId}::uuid
           AND i.order_id IS NOT NULL
           AND i.message_type <> 'reaction'
           AND i.received_at > now() - ${RETURNED_WINDOW}::interval
           AND i.received_at > COALESCE(u.customer_messages_seen_at,
                                        '-infinity'::timestamptz)
         GROUP BY i.order_id
      )
      SELECT ${orderListColumns()}
        FROM unread
        JOIN orders o ON o.id = unread.order_id
        JOIN customers c ON c.id = o.customer_id
       WHERE o.restaurant_id = ${restaurantId}::uuid
         AND o.status IN (${closed})
       ORDER BY unread.last_at DESC, o.id`);
  }

  /**
   * One order with its lines and history — brief D §3.2. `null` = not found
   * under the restaurant's context, whether no order has this id or it belongs
   * to another restaurant: the two are not told apart (§2.9).
   *
   * One statement, not three: under READ COMMITTED each statement has its own
   * snapshot, so three statements could return status `accepted` with a
   * history that already holds `preparing`, had it changed between them.
   *
   * 🔴 Name and price come from the snapshot, with no join to `menu_items`:
   *    the order keeps its name and price from the moment it was placed, and
   *    the customer paid the old one. `line_total` is computed in SQL.
   */
  async detail(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderDetail | null> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<OrderDetailRow>(sql`
        SELECT o.id,
               o.order_number,
               o.status,
               o.fulfillment_type,
               o.subtotal::text AS subtotal,
               o.delivery_fee::text AS delivery_fee,
               o.total::text AS total,
               o.payment_method,
               o.payment_status,
               o.delivery_address,
               o.cancellation_reason,
               ${isoUtc("o.created_at")} AS created_at,
               c.name AS customer_name,
               c.phone_number AS customer_phone,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'name', oi.item_name_snapshot,
                           'quantity', oi.quantity,
                           'unit_price', oi.unit_price_snapshot::text,
                           'line_total', (oi.quantity * oi.unit_price_snapshot)::text,
                           'note', oi.notes)
                         ORDER BY oi.item_name_snapshot, oi.id)
                    FROM order_items oi
                   WHERE oi.order_id = o.id),
                 '[]'::json) AS items,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'from', h.from_status,
                           'to', h.to_status,
                           'actor', h.actor,
                           'at', ${isoUtc("h.changed_at")})
                         ORDER BY h.changed_at, h.id)
                    FROM order_status_history h
                   WHERE h.order_id = o.id),
                 '[]'::json) AS history
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid`),
    );

    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      fulfillmentType: r.fulfillment_type,
      // 🔴 Money as the database returned it, as text. Never `Number()`.
      subtotal: r.subtotal,
      deliveryFee: r.delivery_fee,
      total: r.total,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      deliveryAddress: r.delivery_address,
      cancellationReason: r.cancellation_reason,
      createdAt: r.created_at,
      customer: { name: r.customer_name, phone: r.customer_phone },
      items: r.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        lineTotal: i.line_total,
        note: i.note,
      })),
      history: r.history,
    };
  }

  /**
   * `GET /orders/:id/messages` — brief I §4 (I-5): the order's conversation.
   * `null` = not found under the restaurant's context, as `detail` (§2.9).
   *
   * Which messages are the order's — the customer is the order's, and their
   * number is the very digits of `from_phone` and `to_phone` (I-0 #7):
   *   1. a bot message naming this order (`order_id`) is its;
   *   2. one naming another order is not, whatever its time;
   *   2b. a customer message the engine relayed to an order (its `order_id`,
   *      brief م-أ) is that order's, whatever its time — and never another's;
   *   3. a customer message relayed to none belongs to the first order of the
   *      same customer at the same restaurant made after it or at its moment —
   *      so from just after the order before, up to this one — and none older
   *      than 24 hours before the order (`inWindow`). `received_at`: the
   *      database's clock, as `created_at` is — the «أكّد» that made the
   *      order is received in the very transaction that writes it, at its
   *      moment;
   *   4. a bot message naming no order belongs where the customer's last
   *      message before it belongs (2b, else 3) — any message, an image too:
   *      the reply answered it;
   *   5. what comes after the customer's last order, relayed to none, is no
   *      order's yet.
   * A customer message with no text (a voice note, an image, a location…)
   * is shown only when relayed to this very order (2b, brief م-ب): rule 3's
   * window never brings one. A reaction never is. Each message comes with its
   * `kind` (`messageKind`, from `message_type` and the body) and, for a
   * location, its point from `payload->'location'` when both coordinates are
   * numbers. The latest 200, in time order then `id`. One statement, so the
   * order and its messages are one moment's.
   *
   * RLS keeps every table to the restaurant (`runInTenant`); the explicit
   * `restaurant_id` conditions are defence in depth, and the indexes'.
   *
   * Brief م-ج: a staff message written on this order is its — one row of
   * `staff_messages` (`direction: "staff"`), never another order's — at its
   * `created_at`, the moment staff pressed «send», within the same 200. With
   * them, `botSilence` — `app.bot_silence()` for the order's customer, the
   * rule in its one place (0018) — and `replyOpenUntil`, while it is still
   * ahead (`replyOpenUntil` above, the POST's very check).
   */
  async messages(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderMessagesResponse | null> {
    const window = env().REPLY_WINDOW_MINUTES;
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{
        found: boolean;
        messages: MessageRow[];
        bot_silence: { orderId: string; until: string } | null;
        reply_open_until: string | null;
      }>(sql`
        WITH o AS (
          SELECT o.id, o.restaurant_id, o.customer_id, o.created_at,
                 c.phone_number AS phone,
                 (SELECT p.created_at
                    FROM orders p
                   WHERE p.customer_id = o.customer_id
                     AND p.restaurant_id = o.restaurant_id
                     AND (p.created_at, p.id) < (o.created_at, o.id)
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT 1) AS prev_at
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
           WHERE o.id = ${orderId}::uuid
             AND o.restaurant_id = ${restaurantId}::uuid
        ),
        msgs AS (
          SELECT i.id, 'inbound' AS direction, i.message_type AS type,
                 i.body AS text, i.received_at AS at,
                 CASE WHEN jsonb_typeof(i.payload->'location'->'latitude') = 'number'
                       AND jsonb_typeof(i.payload->'location'->'longitude') = 'number'
                      THEN jsonb_build_object(
                             'latitude', i.payload->'location'->'latitude',
                             'longitude', i.payload->'location'->'longitude')
                 END AS location,
                 NULL::text AS send_state, NULL::text AS failure,
                 NULL::text AS staff_name, NULL::uuid AS client_id
            FROM o
            JOIN inbound_messages i
              ON i.restaurant_id = o.restaurant_id
             AND i.from_phone = o.phone
           WHERE (i.body IS NOT NULL OR i.order_id = o.id)
             AND i.message_type <> 'reaction'
             AND (i.order_id = o.id
                  OR (i.order_id IS NULL AND ${inWindow("i.received_at")}))
          UNION ALL
          SELECT m.id, 'outbound', 'text', m.body, m.sent_at, NULL::jsonb,
                 NULL, NULL, NULL, NULL
            FROM o
            JOIN outbound_messages m
              ON m.restaurant_id = o.restaurant_id
             AND m.to_phone = o.phone
            LEFT JOIN LATERAL (
              SELECT a.received_at, a.order_id
                FROM inbound_messages a
               WHERE a.restaurant_id = o.restaurant_id
                 AND a.from_phone = o.phone
                 AND a.received_at <= m.sent_at
               ORDER BY a.received_at DESC, a.id DESC
               LIMIT 1) last ON true
           WHERE m.order_id = o.id
              OR (m.order_id IS NULL
                  AND (last.order_id = o.id
                       OR (last.order_id IS NULL
                           AND ${inWindow("last.received_at")})))
          UNION ALL
          SELECT s.id, 'staff', 'text', s.body, s.created_at, NULL::jsonb,
                 s.send_state, s.failure,
                 a.name,
                 s.client_id
            FROM o
            JOIN staff_messages s
              ON s.order_id = o.id
             AND s.restaurant_id = o.restaurant_id
            LEFT JOIN staff_accounts a ON a.id = s.staff_account_id
        )
        SELECT EXISTS (SELECT 1 FROM o) AS found,
               (SELECT json_build_object(
                         'orderId', b.silenced_order_id,
                         'until', ${isoUtc("b.silenced_until")})
                  FROM o, app.bot_silence(o.customer_id) b) AS bot_silence,
               (SELECT CASE WHEN w.until > now() THEN ${isoUtc("w.until")} END
                  FROM (SELECT ${replyOpenUntil("o.restaurant_id", "o.phone", window)}
                                 AS until
                          FROM o) w) AS reply_open_until,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'id', l.id,
                           'direction', l.direction,
                           'type', l.type,
                           'text', l.text,
                           'location', l.location,
                           'at', ${isoUtc("l.at")},
                           'send_state', l.send_state,
                           'failure', l.failure,
                           'staff_name', l.staff_name,
                           'client_id', l.client_id)
                         ORDER BY l.at, l.id)
                    FROM (SELECT * FROM msgs
                           ORDER BY at DESC, id DESC
                           LIMIT ${MESSAGES_LIMIT}) l),
                 '[]'::json) AS messages`),
    );
    const row = res.rows[0];
    if (!row?.found) return null;
    return {
      messages: row.messages.map(toMessage),
      botSilence: row.bot_silence,
      replyOpenUntil: row.reply_open_until,
    };
  }

  /**
   * `POST /orders/:id/messages` — brief م-ج §4 أ: a staff member writes to
   * the order's customer. The checks after the DTO's, in order: 404 (not
   * ours, or no such order: one answer, §2.9) → a row with this `clientId`
   * (the same order: `existing`, as it is now, with no look at the 24 hours;
   * another order: `client_id_reused`) → `reply_window_closed` → the row.
   *
   * @param staffAccountId  from the token: who pressed «send» (decision 13).
   *
   * 🔴 Nothing is sent from here (decision 6): the row is `pending`, and the
   *    engine's queue sends it. `silence_until` is written on the
   *    database's clock — `now()` + BOT_SILENCE_MINUTES, the very `now()` of
   *    `created_at` — so the bot keeps quiet from this moment (decision 7).
   *
   * 🔴 Two presses at the same moment with one `clientId`: the INSERT is
   *    `ON CONFLICT DO NOTHING` on `(restaurant_id, client_id)`, so the second
   *    waits for the first's COMMIT, writes nothing, and reads the first's
   *    row — a 200, never a second row or a 500.
   */
  async createStaffMessage(
    restaurantId: string,
    staffAccountId: string,
    orderId: string,
    request: CreateStaffMessageRequest,
  ): Promise<StaffMessageOutcome> {
    const { BOT_SILENCE_MINUTES, REPLY_WINDOW_MINUTES } = env();
    return this.tenantDb.runInTenant(restaurantId, async (tx) => {
      // The order, with what check 4 needs — one statement, one moment.
      const found = await tx.execute<{ window_open: boolean | null }>(sql`
        SELECT ${replyOpenUntil("o.restaurant_id", "c.phone_number", REPLY_WINDOW_MINUTES)}
                 > now() AS window_open
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid`);
      const order = found.rows[0];
      if (!order) return { kind: "not_found" };

      // This message already sent: a second press, or the request again
      // after the network came back — before the 24 hours, so it never turns
      // into a 409 once they close.
      const earlier = await staffMessageByClientId(
        tx,
        restaurantId,
        request.clientId,
      );
      if (earlier) return sameMessage(earlier, orderId);

      // NULL — no message at all — is closed too.
      if (order.window_open !== true) return { kind: "reply_window_closed" };

      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO staff_messages
               (restaurant_id, order_id, staff_account_id, client_id, body,
                silence_until)
        VALUES (${restaurantId}::uuid, ${orderId}::uuid, ${staffAccountId}::uuid,
                ${request.clientId}::uuid, ${request.text},
                now() + make_interval(mins => ${BOT_SILENCE_MINUTES}))
        ON CONFLICT (restaurant_id, client_id) DO NOTHING
        RETURNING id`);
      // Read back with its author's name — the winner's row when this
      // request lost the race, committed by now (READ COMMITTED: a new
      // statement, a new snapshot).
      const row = await staffMessageByClientId(
        tx,
        restaurantId,
        request.clientId,
      );
      if (!row) throw new Error("staff message neither written nor found");
      return inserted.rows[0]
        ? { kind: "created", message: toStaffMessage(row) }
        : sameMessage(row, orderId);
    });
  }

  /**
   * `POST /orders/:id/resume-bot` — «رجّع للبوت» (brief م-ج §4 ب):
   * `customers.bot_resumed_at = now()` for the order's customer, so no staff
   * message before this moment keeps the bot quiet. Harmless when it is not
   * quiet. `false` = not found under the restaurant's context (§2.9).
   */
  async resumeBot(restaurantId: string, orderId: string): Promise<boolean> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{ id: string }>(sql`
        UPDATE customers c
           SET bot_resumed_at = now()
          FROM orders o
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid
           AND c.id = o.customer_id
        RETURNING c.id`),
    );
    return res.rows.length === 1;
  }

  /**
   * `POST /orders/:id/messages/seen` — brief م-ب: the restaurant has read
   * this order's customer messages up to `upTo`, the latest one the page
   * showed. `upTo` is a message of this restaurant from this order's
   * customer; anything else, or an order not ours, is `false` — one 404,
   * the two never told apart (§2.9).
   *
   * 🔴 `seen_at` is `upTo`'s own `received_at`, never `now()`: a message
   *    arriving between the page's read and this call stays unread. And it
   *    never moves backwards (`GREATEST`): a late call for an older message
   *    does not bring read ones back. Nothing else of the order changes —
   *    no status, no `notified`, no history row.
   */
  async markMessagesSeen(
    restaurantId: string,
    orderId: string,
    upTo: string,
  ): Promise<boolean> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{ id: string }>(sql`
        WITH target AS (
          SELECT i.received_at
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            JOIN inbound_messages i
              ON i.restaurant_id = o.restaurant_id
             AND i.from_phone = c.phone_number
           WHERE o.id = ${orderId}::uuid
             AND o.restaurant_id = ${restaurantId}::uuid
             AND i.id = ${upTo}::uuid
        )
        UPDATE orders o
           SET customer_messages_seen_at = GREATEST(
                 COALESCE(o.customer_messages_seen_at, '-infinity'::timestamptz),
                 target.received_at)
          FROM target
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid
        RETURNING o.id`),
    );
    return res.rows.length === 1;
  }

  /**
   * `PATCH /orders/:id/status` — brief D §3.3 with §8.2 and §8.6, in check
   * order.
   *
   * @param restaurantId    from RestaurantContextGuard alone (§8.1).
   * @param staffAccountId  from the token, for `actor_staff_id`.
   *
   * 🔴 The CAS is `AND o.status = from` **inside the UPDATE itself**, not a
   *    read before it. `from` is the status the staff member saw (§2.7); the
   *    server never reads the current one to build on. Under READ COMMITTED an
   *    UPDATE waiting on the row lock re-checks its condition against the new
   *    row version once the lock is released: of two requests at the same
   *    moment with the same `from`, the second finds zero rows.
   *
   * 🔴 One transaction: the history row comes after the UPDATE, in the same
   *    transaction, so any failure there rolls the status back with it. No
   *    order ever changes status without a history row.
   *
   * No WhatsApp message from here: `notified = false` is the only signal, and
   * the poller (FR-11) is what decides and sends.
   */
  async changeStatus(
    restaurantId: string,
    staffAccountId: string,
    orderId: string,
    change: UpdateOrderStatusRequest,
  ): Promise<StatusChangeOutcome> {
    const { from, to } = change;
    // Check 2: the transition itself is forbidden whatever the order, so it
    // comes before any query.
    if (!canStaffTransition(from, to))
      return { kind: "transition_not_allowed" };
    // Trimmed by the DTO. Empty after trimming is NULL (§2.8), and so is
    // anything that is not a cancellation (§8.6).
    const reason =
      to === "cancelled" ? change.cancellationReason || null : null;

    return this.tenantDb.runInTenant(restaurantId, async (tx) => {
      const updated = await tx.execute<OrderListRow>(sql`
        UPDATE orders o
           SET status = ${to}::order_status,
               notified = false,
               updated_at = now()${extraSets(to, reason)}
          FROM customers c
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid
           AND o.status = ${from}::order_status${paymentSettled(to)}
           AND c.id = o.customer_id
        RETURNING o.id`);

      if (!updated.rows[0]) {
        // Checks 3 and 4. The only reason to read the status here is to tell
        // 404 from 409, never to build the UPDATE on it (§2.7). In the same
        // transaction.
        const found = await tx.execute<{ status: OrderStatus }>(sql`
          SELECT status
            FROM orders
           WHERE id = ${orderId}::uuid
             AND restaurant_id = ${restaurantId}::uuid`);
        const current = found.rows[0];
        if (!current) return { kind: "not_found" };
        if (current.status !== from)
          return { kind: "status_conflict", currentStatus: current.status };
        // The status is `from`, so the only condition left in the WHERE is
        // the payment one. Not a race: transitions only move forward, so a
        // status once left never comes back.
        return { kind: "payment_not_settled" };
      }

      await tx.execute(sql`
        INSERT INTO order_status_history
               (order_id, restaurant_id, from_status, to_status,
                actor, actor_staff_id, reason)
        VALUES (${orderId}::uuid, ${restaurantId}::uuid, ${from}::order_status,
                ${to}::order_status, 'staff', ${staffAccountId}::uuid, ${reason})`);

      // Read back after the history row, in the same transaction, so that
      // `statusChangedAt` is this change and not the one before it — a
      // `RETURNING` on the UPDATE runs before the INSERT exists.
      const changed = await tx.execute<OrderListRow>(sql`
        SELECT ${orderListColumns()}
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid`);

      return { kind: "changed", order: toListItem(changed.rows[0]!) };
    });
  }
}

/**
 * What changes besides the status, by destination — in the same UPDATE
 * (brief D §3.3 and §8.6). The database constraints are the safety net, not a
 * substitute: completed ⇒ collected or paid, `cancelled_by` set ⟺ cancelled,
 * and `ready_at` only for an order that reached `ready`.
 */
function extraSets(to: StaffTargetStatus, reason: string | null): SQL {
  switch (to) {
    case "ready":
      // The 24-hour timeout (Sprint 2) reads it. `preparing → completed`
      // leaves it NULL.
      return sql`, ready_at = now()`;
    case "completed":
      // `collected` for cash alone. An online order arrives here `paid` (the
      // WHERE condition) and stays `paid`: `collected` is a cash-only status
      // (orders_collected_is_cash).
      return sql`,
               payment_status = CASE WHEN o.payment_method = 'cash'
                                     THEN 'collected'::payment_status
                                     ELSE o.payment_status END`;
    case "cancelled":
      // §8.2: a cancellation from the dashboard is `restaurant`, the key of
      // `ORDER_STATUS_MESSAGE_AR.cancelled`.
      return sql`,
               cancelled_by = 'restaurant',
               cancellation_reason = ${reason}`;
    default:
      return sql``;
  }
}

/**
 * §8.6: a non-cash order is not completed before it is paid. Without this
 * condition the constraint `orders_completed_payment_settled` rejects it with
 * a 500 instead of an intelligible 409.
 *
 * D-4.1: the same gate on `accepted` — `canAcceptOrder` in shared (FR-13), in
 * SQL. No constraint backs this one: without the condition an unpaid online
 * order is accepted with a 200. Cancelling stays open to it: `canAcceptOrder`
 * names it the one action before payment.
 */
const PAYMENT_GATED: readonly StaffTargetStatus[] = ["accepted", "completed"];

function paymentSettled(to: StaffTargetStatus): SQL {
  return PAYMENT_GATED.includes(to)
    ? sql`
           AND (o.payment_method = 'cash' OR o.payment_status = 'paid')`
    : sql``;
}

function toListItem(r: OrderListRow): OrderListItem {
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    fulfillmentType: r.fulfillment_type,
    // 🔴 As the database returned it. `Number()` here turns "13.50" into "13.5".
    total: r.total,
    itemCount: r.item_count,
    createdAt: r.created_at,
    customer: { name: r.customer_name, phone: r.customer_phone },
    items: r.items,
    statusChangedAt: r.status_changed_at,
    cancellationReason: r.cancellation_reason,
    unreadMessages: r.unread_messages,
    lastMessage: r.last_message && {
      kind: messageKind(r.last_message.type, r.last_message.body),
      text: r.last_message.body,
    },
    staffMessagedAt: r.staff_messaged_at,
  };
}

/** The row with this `clientId` at this restaurant, or `null`. */
async function staffMessageByClientId(
  tx: TenantTx,
  restaurantId: string,
  clientId: string,
): Promise<StaffMessageRow | null> {
  const res = await tx.execute<StaffMessageRow>(sql`
    SELECT ${staffMessageColumns()}
      FROM staff_messages s
      LEFT JOIN staff_accounts a ON a.id = s.staff_account_id
     WHERE s.restaurant_id = ${restaurantId}::uuid
       AND s.client_id = ${clientId}::uuid`);
  return res.rows[0] ?? null;
}

/** A `clientId` already used: this very message again, or another order's. */
function sameMessage(
  row: StaffMessageRow,
  orderId: string,
): StaffMessageOutcome {
  return row.order_id === orderId
    ? { kind: "existing", message: toStaffMessage(row) }
    : { kind: "client_id_reused" };
}

/** The database's `pending` and `sending` are both the screen's `pending`. */
const SEND_STATE: Record<StaffMessageDbState, StaffMessageSendState> = {
  pending: "pending",
  sending: "pending",
  sent: "sent",
  failed: "failed",
};

function toStaffMessage(
  r: Omit<StaffMessageRow, "order_id">,
): StaffOrderMessage {
  return {
    id: r.id,
    direction: "staff",
    kind: "text",
    text: r.text,
    location: null,
    at: r.at,
    sendState: SEND_STATE[r.send_state],
    failure: r.failure,
    staffName: r.staff_name,
    clientId: r.client_id,
  };
}

function toMessage(r: MessageRow): OrderMessage {
  if (r.direction === "staff")
    // Never NULL on a staff row: SQL takes them from `staff_messages`.
    return toStaffMessage({
      id: r.id,
      text: r.text!,
      at: r.at,
      send_state: r.send_state!,
      failure: r.failure,
      staff_name: r.staff_name,
      client_id: r.client_id!,
    });
  const kind = messageKind(r.type, r.text);
  return {
    id: r.id,
    direction: r.direction,
    kind,
    text: r.text,
    location: kind === "location" ? toLocation(r.location) : null,
    at: r.at,
  };
}

/** Numbers alone — SQL already checked `jsonb_typeof`; this is the type's. */
function toLocation(l: MessageRow["location"]): MessageLocation | null {
  return l && typeof l.latitude === "number" && typeof l.longitude === "number"
    ? { latitude: l.latitude, longitude: l.longitude }
    : null;
}
