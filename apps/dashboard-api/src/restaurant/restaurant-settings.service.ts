import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  Currency,
  OpeningHours,
  OrdersPauseResponse,
  RestaurantSettings,
  UpdateRestaurantSettingsRequest,
} from "@sufria/shared";
import { isoUtc } from "../db/iso-utc.js";
import { TenantDbService } from "../db/tenant-db.service.js";

type SettingsRow = {
  currency: Currency;
  payment_method: "cash" | "transfer";
  transfer_details: string | null;
  offers_delivery: boolean;
  delivery_fee: string;
  contact_phone: string | null;
  business_hours: RestaurantSettings["openingHours"];
  orders_paused_at: string | null;
};

/** One projection for GET and for the PATCH reply. Assumes `restaurants r`. */
const settingsColumns = () => sql`
  r.currency,
  r.payment_method::text AS payment_method,
  r.transfer_details,
  r.offers_delivery,
  r.delivery_fee::text AS delivery_fee,
  r.contact_phone,
  r.business_hours,
  ${isoUtc("r.orders_paused_at")} AS orders_paused_at`;

/**
 * The outcome of a PATCH — the controller maps it to HTTP: `updated` 200,
 * `not_found` 404 (unreachable past the guard), `transfer_details_required`
 * 400 (brief م-هـ-أ §8.2).
 */
export type SettingsUpdateOutcome =
  | { kind: "updated"; settings: RestaurantSettings }
  | { kind: "not_found" }
  | { kind: "transfer_details_required" };

@Injectable()
export class RestaurantSettingsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * `GET /restaurant/settings` — brief D §3.5. No `:id` anywhere: the
   * restaurant is the one RestaurantContextGuard verified (§8.1). `null` only
   * if that restaurant is not visible under its own context, which the guard
   * makes unreachable.
   */
  async get(restaurantId: string): Promise<RestaurantSettings | null> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<SettingsRow>(sql`
        SELECT ${settingsColumns()}
          FROM restaurants r
         WHERE r.id = ${restaurantId}::uuid`),
    );
    const row = res.rows[0];
    return row ? toSettings(row) : null;
  }

  /**
   * `PATCH /restaurant/settings` — brief D §3.5 with §8.6 and §8.8. Only the
   * fields sent are written; `updated_at = now()` in the same UPDATE.
   *
   * 🔴 `openingHours` goes in exactly as the DTO let it through — the
   *    canonical shape the engine reads — with no mapping on the way. The
   *    whole week is replaced at once, never merged day by day.
   *
   * The fee goes in as text and becomes money in SQL (§0). A new fee touches
   * no session that already chose delivery and no order: both hold their own
   * copy («الرسوم وعد»).
   */
  async update(
    restaurantId: string,
    change: UpdateRestaurantSettingsRequest,
  ): Promise<SettingsUpdateOutcome> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (change.paymentMethod !== undefined)
      sets.push(sql`payment_method = ${change.paymentMethod}::payment_method`);
    // `null` clears them — refused below while the restaurant is `transfer`.
    if (change.transferDetails !== undefined)
      sets.push(sql`transfer_details = ${change.transferDetails}`);
    if (change.deliveryFee !== undefined)
      sets.push(sql`delivery_fee = ${change.deliveryFee}::numeric(12,2)`);
    // `null` passes this check on purpose: it clears the number (D-6.1).
    if (change.contactPhone !== undefined)
      sets.push(sql`contact_phone = ${change.contactPhone}`);
    if (change.openingHours !== undefined)
      sets.push(sql`business_hours = ${hoursJson(change.openingHours)}::jsonb`);

    return this.tenantDb.runInTenant(restaurantId, async (tx) => {
      // 🔴 Brief م-هـ-أ §8.2: `transfer` needs details — sent now, or saved
      //    and not cleared. Read under the row's lock, so a second PATCH
      //    clearing them at the same moment is judged on this one's result.
      //    0021's CHECK is the net behind it, never the answer (no 500).
      const current = await tx.execute<{
        payment_method: string;
        transfer_details: string | null;
      }>(sql`
        SELECT payment_method::text AS payment_method, transfer_details
          FROM restaurants
         WHERE id = ${restaurantId}::uuid
         FOR UPDATE`);
      const now = current.rows[0];
      if (!now) return { kind: "not_found" };
      const method = change.paymentMethod ?? now.payment_method;
      const details =
        change.transferDetails !== undefined
          ? change.transferDetails
          : now.transfer_details;
      if (method === "transfer" && details === null)
        return { kind: "transfer_details_required" };

      const res = await tx.execute<SettingsRow>(sql`
        UPDATE restaurants r
           SET ${sql.join(sets, sql`, `)}
         WHERE r.id = ${restaurantId}::uuid
        RETURNING ${settingsColumns()}`);
      const row = res.rows[0];
      return row
        ? { kind: "updated", settings: toSettings(row) }
        : { kind: "not_found" };
    });
  }

  /**
   * `PATCH /restaurant/orders-pause` — brief ي-أ §5. Pausing while paused
   * keeps the first moment (`COALESCE`); resuming writes NULL whatever it
   * was. The engine reads the column with every message, so the next message
   * already gets the paused text — or, resumed, the menu.
   */
  async setOrdersPaused(
    restaurantId: string,
    paused: boolean,
  ): Promise<OrdersPauseResponse | null> {
    const pausedAt = paused
      ? sql`COALESCE(r.orders_paused_at, now())`
      : sql`NULL`;
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{ orders_paused_at: string | null }>(sql`
        UPDATE restaurants r
           SET orders_paused_at = ${pausedAt}, updated_at = now()
         WHERE r.id = ${restaurantId}::uuid
        RETURNING ${isoUtc("r.orders_paused_at")} AS orders_paused_at`),
    );
    const row = res.rows[0];
    return row ? { ordersPausedAt: row.orders_paused_at } : null;
  }
}

function hoursJson(hours: OpeningHours): string {
  return JSON.stringify(hours);
}

function toSettings(r: SettingsRow): RestaurantSettings {
  return {
    currency: r.currency,
    paymentMethod: r.payment_method,
    transferDetails: r.transfer_details,
    offersDelivery: r.offers_delivery,
    // 🔴 As the database returned it. `Number()` here turns "1.50" into "1.5".
    deliveryFee: r.delivery_fee,
    contactPhone: r.contact_phone,
    openingHours: r.business_hours,
    ordersPausedAt: r.orders_paused_at,
  };
}
