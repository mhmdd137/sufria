import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type {
  CreateStaffMessageResponse,
  MediaNotFoundBody,
  OrderDetail,
  OrderListResponse,
  OrderMessagesResponse,
  OrderStatusConflictBody,
  StaffMessageConflictBody,
  StaffMessageConflictCode,
  UpdateOrderStatusResponse,
} from "@sufria/shared";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { CreateStaffMessageDto } from "./dto/create-staff-message.dto.js";
import { ListOrdersQueryDto } from "./dto/list-orders.dto.js";
import { MarkMessagesSeenDto } from "./dto/mark-messages-seen.dto.js";
import { OrderMediaParamDto } from "./dto/order-media.dto.js";
import { mediaHeaders } from "./media-headers.js";
import { OrderIdParamDto } from "./dto/order-id.dto.js";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto.js";
import { OrdersService } from "./orders.service.js";

/**
 * 🔴 The restaurant is RestaurantContextGuard's (the `x-restaurant-id` header
 *    after the membership check), never the path or the query. And no path
 *    parameter may be named `restaurantId`: the guard reads
 *    `req.params.restaurantId` before the header, so such a parameter would
 *    silently change where the restaurant comes from (brief D §8.1).
 */
@Controller("orders")
@UseGuards(RestaurantContextGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @VerifiedRestaurantId() restaurantId: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListResponse> {
    return this.orders.list(restaurantId, query.tab, query.page ?? 1);
  }

  /**
   * A non-existent order and another restaurant's get the same 404 with the
   * same body (brief D §2.9): the other restaurant is not told the order
   * exists. RLS cannot tell the two apart anyway.
   */
  @Get(":id")
  async detail(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderIdParamDto,
  ): Promise<OrderDetail> {
    const order = await this.orders.detail(restaurantId, params.id);
    if (!order) throw new NotFoundException();
    return order;
  }

  /**
   * Brief I §4 (I-5): the order's conversation. Another restaurant's order is
   * the very 404 a non-existent one gets — and not one message of it.
   */
  @Get(":id/messages")
  async messages(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderIdParamDto,
  ): Promise<OrderMessagesResponse> {
    const conversation = await this.orders.messages(restaurantId, params.id);
    if (!conversation) throw new NotFoundException();
    return conversation;
  }

  /**
   * Brief م-هـ-أ §8.4: a customer's image, voice note or PDF, as stored.
   * Not stored yet, another order's, another restaurant's — one 404,
   * `media_not_found`, never told apart (brief D §2.9).
   */
  @Get(":id/media/:mediaId")
  async media(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderMediaParamDto,
    @Res({ passthrough: true }) res: HeaderSetter,
  ): Promise<StreamableFile> {
    const file = await this.orders.mediaFile(
      restaurantId,
      params.id,
      params.mediaId,
    );
    if (!file) {
      const body: MediaNotFoundBody = {
        statusCode: 404,
        error: "Not Found",
        code: "media_not_found",
        message: "no stored media of this order with this id",
      };
      throw new NotFoundException(body);
    }
    for (const [name, value] of Object.entries(mediaHeaders(file)))
      res.setHeader(name, value);
    return new StreamableFile(file.content);
  }

  /**
   * Brief م-ب: the order's customer messages are read up to `upTo`. 204 with
   * no body. A message that is not this order's customer's, and an order
   * that is not ours, get the very same 404 (brief D §2.9).
   */
  @Post(":id/messages/seen")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markMessagesSeen(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderIdParamDto,
    @Body() body: MarkMessagesSeenDto,
  ): Promise<void> {
    const marked = await this.orders.markMessagesSeen(
      restaurantId,
      params.id,
      body.upTo,
    );
    if (!marked) throw new NotFoundException();
  }

  /**
   * Brief م-ج §4 أ: a staff member writes to the order's customer. In check
   * order: 400 (the DTO) → 404 → 200 (this `clientId` already on this order:
   * the row as it is now) or 409 `client_id_reused` → 409
   * `reply_window_closed` → 201, the new row, `pending`. Nothing is sent
   * from here: the engine's queue sends it (decision 6).
   *
   * `staff_account_id` comes from the token (`CurrentUser`), the restaurant
   * from the guard.
   */
  @Post(":id/messages")
  async createStaffMessage(
    @VerifiedRestaurantId() restaurantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrderIdParamDto,
    @Body() body: CreateStaffMessageDto,
    @Res({ passthrough: true }) res: StatusOnly,
  ): Promise<CreateStaffMessageResponse> {
    const outcome = await this.orders.createStaffMessage(
      restaurantId,
      user.staffAccountId,
      params.id,
      body,
    );
    switch (outcome.kind) {
      case "created":
        return outcome.message;
      case "existing":
        res.status(HttpStatus.OK);
        return outcome.message;
      case "not_found":
        throw new NotFoundException();
      case "client_id_reused":
        throw staffMessageConflict(
          "client_id_reused",
          "this clientId is another order's staff message",
        );
      case "reply_window_closed":
        throw staffMessageConflict(
          "reply_window_closed",
          "the customer wrote nothing but reactions within the reply window",
        );
    }
  }

  /**
   * Brief م-ج §4 ب: «رجّع للبوت». 204 with no body, whether or not the bot
   * was quiet; another restaurant's order is the very 404 a non-existent one
   * gets (brief D §2.9).
   */
  @Post(":id/resume-bot")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resumeBot(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderIdParamDto,
  ): Promise<void> {
    if (!(await this.orders.resumeBot(restaurantId, params.id)))
      throw new NotFoundException();
  }

  /**
   * Brief D §3.3, in check order: 400 (the DTO) → 409 `transition_not_allowed`
   * → 404 → 409 `status_conflict` or `payment_not_settled`. The 200 is the
   * order in the shape of a `GET /orders` item.
   *
   * `actor_staff_id` comes from the token (`CurrentUser`), the restaurant from
   * the guard.
   */
  @Patch(":id/status")
  async changeStatus(
    @VerifiedRestaurantId() restaurantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrderIdParamDto,
    @Body() body: UpdateOrderStatusDto,
  ): Promise<UpdateOrderStatusResponse> {
    const outcome = await this.orders.changeStatus(
      restaurantId,
      user.staffAccountId,
      params.id,
      body,
    );
    switch (outcome.kind) {
      case "changed":
        return outcome.order;
      case "not_found":
        throw new NotFoundException();
      case "transition_not_allowed":
        throw conflict({
          code: "transition_not_allowed",
          message: `${body.from} → ${body.to} is not a staff transition`,
        });
      case "status_conflict":
        throw conflict({
          code: "status_conflict",
          message: `the order is ${outcome.currentStatus}, not ${body.from}`,
          currentStatus: outcome.currentStatus,
        });
      case "payment_not_settled":
        throw conflict({
          code: "payment_not_settled",
          message: `only a cash order, or a paid one, can be ${body.to}`,
        });
    }
  }
}

type ConflictDetail = OrderStatusConflictBody extends infer B
  ? B extends OrderStatusConflictBody
    ? Omit<B, "statusCode" | "error">
    : never
  : never;

/**
 * A 409 in Nest's default shape plus `code` — brief D §8.7. The screen reads
 * `code`; `message` is English, for the developer.
 */
function conflict(detail: ConflictDetail): ConflictException {
  const body: OrderStatusConflictBody = {
    statusCode: 409,
    error: "Conflict",
    ...detail,
  };
  return new ConflictException(body);
}

/**
 * The one thing taken from the platform's response: its status, for the 200
 * of a `clientId` seen before (`passthrough` keeps the return value the
 * body). Structural, so the API needs no `express` types.
 */
type StatusOnly = { status(code: number): unknown };

/** The same for the file's headers (brief م-هـ-أ §8.4), set before the body. */
type HeaderSetter = { setHeader(name: string, value: string): unknown };

/** The 409 of `POST /orders/:id/messages`, in the same shape (brief م-ج §3). */
function staffMessageConflict(
  code: StaffMessageConflictCode,
  message: string,
): ConflictException {
  const body: StaffMessageConflictBody = {
    statusCode: 409,
    error: "Conflict",
    code,
    message,
  };
  return new ConflictException(body);
}
