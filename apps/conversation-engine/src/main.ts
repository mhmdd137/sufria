import { ConversationService } from "./conversation/session.service.js";
import { env } from "./config/env.js";
import { TenantDb } from "./db/tenant-db.js";
import { createWebhookServer, WEBHOOK_PATH } from "./http/server.js";
import { logger } from "./logger.js";
import { MediaFetcher } from "./notify/media-fetcher.js";
import { OrderNotifier } from "./notify/order-notifier.js";
import { StaffReplySender } from "./notify/staff-replies.js";
import { SavingWhatsAppSender } from "./whatsapp/saving-sender.js";
import { MetaMediaDownloader } from "./whatsapp/media-downloader.js";
import { MetaWhatsAppSender } from "./whatsapp/sender.js";
import { WebhookService } from "./whatsapp/webhook.service.js";

async function bootstrap(): Promise<void> {
  // بيرمي الآن لو أي متغيّر بيئة ناقص — قبل ما ينفتح أي منفذ.
  const config = env();

  const db = new TenantDb();
  // بيرفض الإقلاع لو الاتصال كـsuperuser. قبل المنفذ كمان.
  await db.start();

  // The pool the saving wrapper writes outbound_messages through — its own:
  // most replies are sent inside the inbound message's transaction, which
  // holds a connection of `db` (brief I, I-4). Same role, same checks.
  const outboundDb = new TenantDb();
  await outboundDb.start();

  // 🔴 المسار الوحيد للإنتاج. RecordingWhatsAppSender بـwhatsapp/sender.ts
  //    موجود للاختبارات وللتشغيل المحلي بلا توكن، وما بينوصل من هون أبدا.
  //    Every message that went out is kept, for the order's conversation.
  const meta = new MetaWhatsAppSender();
  const sender = new SavingWhatsAppSender(meta, outboundDb);
  const conversation = new ConversationService(sender);
  // مُراقِب الإشعارات (FR-11): نفس المرسِل ونفس المخزن. `NOTIFY_POLL_MS=0` يطفئه.
  const notifier = new OrderNotifier(db, sender, {
    pollMs: config.NOTIFY_POLL_MS,
  });
  // The staff-reply queue (brief م-ج §6): the raw sender itself, not the
  // saving wrapper — a staff text lives in staff_messages alone, and the
  // queue's type takes only a sender that returns Meta's id.
  // `STAFF_REPLY_POLL_MS=0` turns it off.
  const staffReplies = new StaffReplySender(db, meta, {
    pollMs: config.STAFF_REPLY_POLL_MS,
    maxWaitSeconds: config.STAFF_REPLY_MAX_WAIT_SECONDS,
  });

  // The media queue (brief م-هـ-أ §7): a customer's media from Meta into
  // inbound_media. `MEDIA_POLL_MS=0` turns it off.
  const media = new MediaFetcher(db, new MetaMediaDownloader(), {
    pollMs: config.MEDIA_POLL_MS,
  });

  const server = createWebhookServer({
    service: new WebhookService(db, conversation),
    health: db,
    verifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: config.WHATSAPP_APP_SECRET,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "إيقاف محرّك المحادثة");
    server.close(() => {
      // المُراقِب قبل المخزن: بيستنّى دورته الشغّالة، فما بينسكّر المخزن تحتها.
      // The queue the same way, for its cycle.
      void notifier
        .stop()
        .then(() => staffReplies.stop())
        .then(() => media.stop())
        .then(() => db.stop())
        .then(() => outboundDb.stop())
        .then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.ENGINE_PORT, () => {
    logger.info(
      { port: config.ENGINE_PORT, path: WEBHOOK_PATH },
      "محرّك المحادثة يستمع",
    );
    notifier.start();
    logger.info(
      { pollMs: config.NOTIFY_POLL_MS },
      config.NOTIFY_POLL_MS === 0
        ? "مُراقِب الإشعارات مطفأ (NOTIFY_POLL_MS=0)"
        : "مُراقِب الإشعارات يعمل",
    );
    staffReplies.start();
    logger.info(
      { pollMs: config.STAFF_REPLY_POLL_MS },
      config.STAFF_REPLY_POLL_MS === 0
        ? "staff-reply queue off (STAFF_REPLY_POLL_MS=0)"
        : "staff-reply queue running",
    );
    media.start();
    logger.info(
      { pollMs: config.MEDIA_POLL_MS },
      config.MEDIA_POLL_MS === 0
        ? "media queue off (MEDIA_POLL_MS=0)"
        : "media queue running",
    );
  });
}

void bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "فشل إقلاع محرّك المحادثة");
  process.exit(1);
});
