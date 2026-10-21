import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `:id` and `:mediaId` in `/orders/:id/media/:mediaId` (brief م-هـ-أ §8.4).
 * Not a UUID → 400 before the database, as `OrderIdParamDto` — `z.guid()`
 * for the reason given there.
 */
const OrderMediaParamSchema = z.object({
  id: z.guid(),
  mediaId: z.guid(),
});

export class OrderMediaParamDto extends createZodDto(OrderMediaParamSchema) {}
