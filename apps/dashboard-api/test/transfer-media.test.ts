/**
 * mha-6 — the transfer payment and a customer's media, on the dashboard API
 * (brief م-هـ-أ §8): the payment gate and `completed` for a transfer order,
 * the restaurant's payment method in the settings, the payment on every list
 * item, the media and the caption in the conversation, and the file route.
 *
 * The harness of staff-messages.test.ts: the real AppModule over real HTTP,
 * as `sufria_dashboard` with RLS live; fixtures written — and audited —
 * through MIGRATION_DATABASE_URL, the media rows as the engine writes them.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type {
  CustomerOrBotMessage,
  OrderListItem,
  OrderListResponse,
  OrderMessagesResponse,
  RestaurantSettings,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `mha6-${process.pid}-${Date.now()}`;
const DETAILS = "جوال باي 059XXXXXXX (عرض تجريبي)";
const MEDIA_NOT_FOUND = {
  statusCode: 404,
  error: "Not Found",
  code: "media_not_found",
  message: "no stored media of this order with this id",
};
/** A PNG's signature and IHDR, 1080×1920, then padding. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0x04, 0x38, 0, 0, 0x07, 0x80, 8, 6, 0, 0, 0, 1, 2, 3,
]);

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let restaurantA = "";
let restaurantB = "";
let staffA = "";
let customers = 0;
let nextNumber = 701;
let wamid = 0;

async function createRestaurant(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, currency)
     VALUES ($1, $2, 'active', 'ILS') RETURNING id`,
    [`مطعم ${label} ${RUN}`, `PHONE_${label}_${RUN}`],
  );
  const id = rows[0]!.id;
  createdRestaurants.push(id);
  return id;
}

interface Customer {
  id: string;
  phone: string;
  restaurant: string;
}

async function customer(restaurant = restaurantA): Promise<Customer> {
  const phone = `9705${String(++customers).padStart(2, "0")}${String(process.pid).padStart(6, "0").slice(-6)}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [restaurant, phone],
  );
  return { id: rows[0]!.id, phone, restaurant };
}

type Method = "cash" | "transfer" | "online";

/** An order of `c`'s, `status`, paid as `method` (pending until completed). */
async function createOrder(
  c: Customer,
  status = "pending_acceptance",
  method: Method = "transfer",
): Promise<{ id: string; number: number }> {
  const number = nextNumber++;
  const pending =
    method === "transfer"
      ? "pending_transfer"
      : method === "cash"
        ? "pending_cash"
        : "pending_online";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, subtotal,
                         delivery_fee, total, created_at)
     VALUES ($1, $2, $3, 'pickup', $4::payment_method, $5::order_status,
             $6::payment_status, 5.00, 0, 5.00, now() - interval '30 minutes')
     RETURNING id`,
    [c.restaurant, c.id, number, method, status, pending],
  );
  return { id: rows[0]!.id, number };
}

/** A message from `c`, relayed to `orderId`, of `type` with `payload`. */
async function inbound(
  c: Customer,
  orderId: string,
  type: string,
  payload: unknown,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_messages (restaurant_id, wa_message_id, phone_number_id,
                                   from_phone, message_type, body, payload,
                                   received_at, order_id)
     VALUES ($1, $2, 'PHONE_TEST', $3, $4, NULL, $5::jsonb,
             now() - interval '5 minutes', $6)
     RETURNING id`,
    [
      c.restaurant,
      `wamid.${RUN}.${++wamid}`,
      c.phone,
      type,
      JSON.stringify(payload),
      orderId,
    ],
  );
  return rows[0]!.id;
}

/** The media row of `messageId`, as the engine's queue leaves it. */
async function media(
  restaurant: string,
  messageId: string,
  spec: {
    kind?: "image" | "audio" | "pdf";
    mime?: string;
    state?: "pending" | "stored" | "too_large" | "failed";
    content?: Buffer;
    size?: number;
    width?: number;
    height?: number;
    fileName?: string;
  } = {},
): Promise<string> {
  const state = spec.state ?? "stored";
  const content = state === "stored" ? (spec.content ?? PNG) : null;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_media (restaurant_id, inbound_message_id, kind, wa_media_id,
                                mime_type, file_name, state, attempts, content,
                                size_bytes, width, height, finished_at)
     VALUES ($1, $2, $3, 'MEDIA', $4, $5, $6, 1, $7, $8, $9, $10,
             CASE WHEN $6 <> 'pending' THEN now() END)
     RETURNING id`,
    [
      restaurant,
      messageId,
      spec.kind ?? "image",
      spec.mime ?? "image/png",
      spec.fileName ?? null,
      state,
      content,
      content?.length ?? spec.size ?? null,
      spec.width ?? null,
      spec.height ?? null,
    ],
  );
  return rows[0]!.id;
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

function headers(restaurant = restaurantA): Record<string, string> {
  return {
    authorization: `Bearer ${token(staffA)}`,
    "x-restaurant-id": restaurant,
    "content-type": "application/json",
  };
}

const status = (orderId: string, from: string, to: string): Promise<Response> =>
  fetch(`${baseUrl}/orders/${orderId}/status`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ from, to }),
  });

const patchSettings = (body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/restaurant/settings`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });

async function settings(): Promise<RestaurantSettings> {
  const res = await fetch(`${baseUrl}/restaurant/settings`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RestaurantSettings;
}

async function storedPayment(): Promise<{
  payment_method: string;
  transfer_details: string | null;
}> {
  const { rows } = await audit.query<{
    payment_method: string;
    transfer_details: string | null;
  }>(
    `SELECT payment_method::text, transfer_details FROM restaurants WHERE id = $1`,
    [restaurantA],
  );
  return rows[0]!;
}

async function conversation(orderId: string): Promise<CustomerOrBotMessage[]> {
  const res = await fetch(`${baseUrl}/orders/${orderId}/messages`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as OrderMessagesResponse)
    .messages as CustomerOrBotMessage[];
}

const file = (
  orderId: string,
  mediaId: string,
  restaurant = restaurantA,
): Promise<Response> =>
  fetch(`${baseUrl}/orders/${orderId}/media/${mediaId}`, {
    headers: headers(restaurant),
  });

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example لـ.env.");
  audit = new Pool({ connectionString: url, max: 3 });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  jwt = app.get(JwtService);

  restaurantA = await createRestaurant("mha6-a");
  restaurantB = await createRestaurant("mha6-b");
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', 'موظف mha6') RETURNING id`,
    [`mha6-a-${RUN}@sufria.test`],
  );
  staffA = rows[0]!.id;
  createdStaff.push(staffA);
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffA, restaurantA],
  );
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (createdRestaurants.length > 0)
      await audit.query(`DELETE FROM restaurants WHERE id = ANY($1::uuid[])`, [
        createdRestaurants,
      ]);
    if (createdStaff.length > 0)
      await audit.query(
        `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
        [createdStaff],
      );
    await audit.end();
  }
});

// ---------------------------------------------------------------------------
// The payment — §8.1
// ---------------------------------------------------------------------------
describe("a transfer order's status (§8.1)", () => {
  it("🔴 «اقبل» on a transfer order → 200, still pending_transfer", async () => {
    const o = await createOrder(await customer());

    const res = await status(o.id, "pending_acceptance", "accepted");

    expect(res.status).toBe(200);
    expect((await res.json()) as OrderListItem).toMatchObject({
      status: "accepted",
      paymentMethod: "transfer",
      paymentStatus: "pending_transfer",
    });
  });

  it("🔴 «تم» on a transfer order → 200 and collected, like cash (decision 5)", async () => {
    const o = await createOrder(await customer(), "preparing");

    const res = await status(o.id, "preparing", "completed");

    expect(res.status).toBe(200);
    expect((await res.json()) as OrderListItem).toMatchObject({
      status: "completed",
      paymentMethod: "transfer",
      paymentStatus: "collected",
    });
  });

  it("a cash order completed → collected, as before", async () => {
    const o = await createOrder(await customer(), "preparing", "cash");

    const res = await status(o.id, "preparing", "completed");

    expect(res.status).toBe(200);
    expect(((await res.json()) as OrderListItem).paymentStatus).toBe(
      "collected",
    );
  });

  it("an online order not paid → 409 payment_not_settled, as before", async () => {
    const o = await createOrder(
      await customer(),
      "pending_acceptance",
      "online",
    );

    const res = await status(o.id, "pending_acceptance", "accepted");

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "payment_not_settled" });
  });

  it("every list item carries paymentMethod and paymentStatus", async () => {
    const cash = await createOrder(await customer(), "accepted", "cash");
    const transfer = await createOrder(
      await customer(),
      "accepted",
      "transfer",
    );

    const res = await fetch(`${baseUrl}/orders?tab=active`, {
      headers: headers(),
    });
    const items = ((await res.json()) as OrderListResponse).orders;

    expect(items.find((i) => i.id === cash.id)).toMatchObject({
      paymentMethod: "cash",
      paymentStatus: "pending_cash",
    });
    expect(items.find((i) => i.id === transfer.id)).toMatchObject({
      paymentMethod: "transfer",
      paymentStatus: "pending_transfer",
    });
  });
});

// ---------------------------------------------------------------------------
// The settings — §8.2. One restaurant, in order: each test leaves it as the
// next one expects it.
// ---------------------------------------------------------------------------
describe("the payment method in the settings (§8.2)", () => {
  it("GET: cash and no details by default", async () => {
    expect(await settings()).toMatchObject({
      paymentMethod: "cash",
      transferDetails: null,
    });
  });

  it("🔴 transfer with no details, none saved → 400 transfer_details_required, nothing written", async () => {
    const res = await patchSettings({ paymentMethod: "transfer" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      statusCode: 400,
      code: "transfer_details_required",
    });
    expect(await storedPayment()).toEqual({
      payment_method: "cash",
      transfer_details: null,
    });
  });

  it("the details, refused: blank, 301 characters, 6 lines, a tab, a lone \\r", async () => {
    for (const transferDetails of [
      " \n\t ",
      "ب".repeat(301),
      "1\n2\n3\n4\n5\n6",
      "جوال\tباي",
      "جوال\rباي",
    ]) {
      const res = await patchSettings({
        paymentMethod: "transfer",
        transferDetails,
      });
      expect(res.status).toBe(400);
    }
    expect((await storedPayment()).payment_method).toBe("cash");
  });

  it("paymentMethod online, or anything else → 400", async () => {
    for (const paymentMethod of ["online", "bank", 1])
      expect((await patchSettings({ paymentMethod })).status).toBe(400);
  });

  it("300 characters on 5 lines are accepted", async () => {
    const details = ["ب".repeat(292), "1", "2", "3", "4"].join("\n");
    expect([...details].length).toBe(300);

    const res = await patchSettings({ transferDetails: details });

    expect(res.status).toBe(200);
    expect((await storedPayment()).transfer_details).toBe(details);
  });

  it("🔴 transfer with its details: «\\r\\n» read as «\\n», both ends trimmed — and the reply is the settings", async () => {
    const res = await patchSettings({
      paymentMethod: "transfer",
      transferDetails: `  ${DETAILS}\r\nأو بنك فلسطين 12345 \n`,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RestaurantSettings;
    expect(body).toMatchObject({
      paymentMethod: "transfer",
      transferDetails: `${DETAILS}\nأو بنك فلسطين 12345`,
    });
    expect(body).toEqual(await settings());
  });

  it("🔴 clearing the details while transfer → 400 transfer_details_required", async () => {
    const res = await patchSettings({ transferDetails: null });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "transfer_details_required",
    });
    expect((await storedPayment()).payment_method).toBe("transfer");
  });

  it("back to cash: the details stay; transfer again with no details sent → 200, the saved ones", async () => {
    expect((await patchSettings({ paymentMethod: "cash" })).status).toBe(200);
    expect(await storedPayment()).toEqual({
      payment_method: "cash",
      transfer_details: `${DETAILS}\nأو بنك فلسطين 12345`,
    });

    expect((await patchSettings({ paymentMethod: "transfer" })).status).toBe(
      200,
    );
    expect((await settings()).paymentMethod).toBe("transfer");
  });

  it("cash and the details cleared together → 200", async () => {
    const res = await patchSettings({
      paymentMethod: "cash",
      transferDetails: null,
    });

    expect(res.status).toBe(200);
    expect(await storedPayment()).toEqual({
      payment_method: "cash",
      transfer_details: null,
    });
  });
});

// ---------------------------------------------------------------------------
// The conversation — §8.3
// ---------------------------------------------------------------------------
describe("the media in the conversation (§8.3)", () => {
  it("a stored image with its pixels and its caption, trimmed; text stays null", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const msg = await inbound(c, o.id, "image", {
      type: "image",
      image: {
        id: "IMG",
        mime_type: "image/png",
        caption: "  إشعار التحويل \n",
      },
    });
    const id = await media(restaurantA, msg, { width: 1080, height: 1920 });

    const [m] = await conversation(o.id);

    expect(m).toMatchObject({
      id: msg,
      direction: "inbound",
      kind: "image",
      text: null,
      caption: "إشعار التحويل",
      media: {
        id,
        kind: "image",
        state: "stored",
        mimeType: "image/png",
        sizeBytes: PNG.length,
        width: 1080,
        height: 1920,
        fileName: null,
      },
    });
    expect(JSON.stringify(m)).not.toContain("content");
  });

  it("pending, and too_large with Meta's size", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const a = await inbound(c, o.id, "audio", { audio: { id: "A" } });
    await media(restaurantA, a, {
      kind: "audio",
      mime: "audio/ogg",
      state: "pending",
    });
    const d = await inbound(c, o.id, "document", {
      document: { id: "D", caption: "   " },
    });
    await media(restaurantA, d, {
      kind: "pdf",
      mime: "application/pdf",
      state: "too_large",
      size: 9_000_000,
      fileName: "إيصال.pdf",
    });

    const messages = await conversation(o.id);

    expect(
      messages.map((m) => [
        m.kind,
        m.media?.state,
        m.media?.sizeBytes,
        m.caption,
      ]),
    ).toEqual([
      ["audio", "pending", null, null],
      ["document", "too_large", 9_000_000, null],
    ]);
    expect(messages[1]!.media?.fileName).toBe("إيصال.pdf");
  });

  it("no media → media null, caption null; a bot message the same", async () => {
    const c = await customer();
    const o = await createOrder(c);
    await inbound(c, o.id, "video", { video: { id: "V" } });
    await audit.query(
      `INSERT INTO outbound_messages (restaurant_id, to_phone, body, order_id)
       VALUES ($1, $2, 'أكّدنا طلبك', $3)`,
      [restaurantA, c.phone, o.id],
    );

    const messages = await conversation(o.id);

    expect(messages.map((m) => [m.direction, m.media, m.caption])).toEqual([
      ["inbound", null, null],
      ["outbound", null, null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The file — §8.4
// ---------------------------------------------------------------------------
describe("GET /orders/:id/media/:mediaId (§8.4)", () => {
  it("🔴 200: the bytes, and every header", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const id = await media(
      restaurantA,
      await inbound(c, o.id, "image", { image: { id: "I" } }),
    );

    const res = await file(o.id, id);

    expect(res.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG)).toBe(0);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG.length));
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(res.headers.get("content-disposition")).toBe("inline");
  });

  it("a voice note: its MIME type as stored, inline", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const id = await media(
      restaurantA,
      await inbound(c, o.id, "audio", { audio: { id: "A" } }),
      {
        kind: "audio",
        mime: "audio/ogg; codecs=opus",
        content: Buffer.from([1, 2, 3]),
      },
    );

    const res = await file(o.id, id);

    expect(res.headers.get("content-type")).toBe("audio/ogg; codecs=opus");
    expect(res.headers.get("content-disposition")).toBe("inline");
  });

  it("🔴 a PDF named with «\"» and «/»: our English name, and the customer's cleaned after it", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const id = await media(
      restaurantA,
      await inbound(c, o.id, "document", { document: { id: "D" } }),
      {
        kind: "pdf",
        mime: "application/pdf",
        content: Buffer.from("%PDF-1.4"),
        fileName: 'إيصال "جوال"/باي\r\n.pdf',
      },
    );

    const res = await file(o.id, id);

    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toBe(
      `inline; filename="order-${o.number}.pdf"; filename*=UTF-8''${encodeURIComponent("إيصال جوالباي.pdf")}`,
    );
  });

  it("pending → 404 media_not_found", async () => {
    const c = await customer();
    const o = await createOrder(c);
    const id = await media(
      restaurantA,
      await inbound(c, o.id, "image", { image: { id: "I" } }),
      { state: "pending" },
    );

    const res = await file(o.id, id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(MEDIA_NOT_FOUND);
  });

  it("🔴 another order's media → 404, even the same customer's", async () => {
    const c = await customer();
    const mine = await createOrder(c);
    const other = await createOrder(c);
    const id = await media(
      restaurantA,
      await inbound(c, other.id, "image", { image: { id: "I" } }),
    );

    const res = await file(mine.id, id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(MEDIA_NOT_FOUND);
    expect((await file(other.id, id)).status).toBe(200);
  });

  it("🔴 another restaurant's media, under this restaurant's header → 404", async () => {
    const c = await customer(restaurantB);
    const o = await createOrder(c);
    const id = await media(
      restaurantB,
      await inbound(c, o.id, "image", { image: { id: "I" } }),
    );

    const res = await file(o.id, id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(MEDIA_NOT_FOUND);
  });

  it("an id that is not a UUID → 400", async () => {
    const c = await customer();
    const o = await createOrder(c);

    expect((await file(o.id, "not-a-uuid")).status).toBe(400);
  });
});
