import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { WHATSAPP_TEXT_LIMIT, whatsappTextLength } from "@sufria/shared";

/**
 * Body of `POST /orders/:id/messages` — brief م-ج §4 أ, check 1: everything
 * here is a 400 before the order or the database is reached.
 *
 * - `text` is trimmed at both ends and nothing else — the staff member's
 *   words, never their digits turned Western (`toWesternDigits` is for
 *   prices) — then neither empty nor longer than WhatsApp takes, counted as
 *   WhatsApp counts (`whatsappTextLength`, the engine's own check).
 * - `clientId` is the screen's id for this message. `z.guid()` for the
 *   reason `OrderIdParamDto` gives.
 * - `strictObject`, as `UpdateOrderStatusDto`: an extra key is a 400, not
 *   silently swallowed.
 */
const CreateStaffMessageSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .refine((text) => whatsappTextLength(text) <= WHATSAPP_TEXT_LIMIT, {
      message: `longer than ${WHATSAPP_TEXT_LIMIT} characters, as WhatsApp counts them`,
    }),
  clientId: z.guid(),
});

export class CreateStaffMessageDto extends createZodDto(
  CreateStaffMessageSchema,
) {}
