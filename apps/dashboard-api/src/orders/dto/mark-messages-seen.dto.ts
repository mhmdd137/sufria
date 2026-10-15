import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body of `POST /orders/:id/messages/seen` (brief م-ب): `upTo`, the id of
 * the latest customer message the page showed. Missing or not a UUID → 400.
 * `z.guid()` for the reason `OrderIdParamDto` gives.
 */
const MarkMessagesSeenSchema = z.object({
  upTo: z.guid(),
});

export class MarkMessagesSeenDto extends createZodDto(MarkMessagesSeenSchema) {}
