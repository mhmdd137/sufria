import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from "@nestjs/common";
import type {
  RestaurantSettings,
  TransferDetailsRequiredBody,
  UpdateRestaurantSettingsResponse,
} from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { UpdateRestaurantSettingsDto } from "./dto/update-restaurant-settings.dto.js";
import { RestaurantSettingsService } from "./restaurant-settings.service.js";

/**
 * 🔴 No `:id` in the path at all (brief D §3.5). The restaurant is
 *    RestaurantContextGuard's — the `x-restaurant-id` header after the
 *    membership check — never the body or the query (§8.1).
 */
@Controller("restaurant/settings")
@UseGuards(RestaurantContextGuard)
export class RestaurantSettingsController {
  constructor(private readonly settings: RestaurantSettingsService) {}

  @Get()
  async get(
    @VerifiedRestaurantId() restaurantId: string,
  ): Promise<RestaurantSettings> {
    const settings = await this.settings.get(restaurantId);
    if (!settings) throw new NotFoundException();
    return settings;
  }

  /**
   * 400 (the DTO) → 400 `transfer_details_required` (brief م-هـ-أ §8.2) →
   * 200, the settings after the change.
   */
  @Patch()
  async update(
    @VerifiedRestaurantId() restaurantId: string,
    @Body() body: UpdateRestaurantSettingsDto,
  ): Promise<UpdateRestaurantSettingsResponse> {
    const outcome = await this.settings.update(restaurantId, body);
    switch (outcome.kind) {
      case "updated":
        return outcome.settings;
      case "not_found":
        throw new NotFoundException();
      case "transfer_details_required": {
        const error: TransferDetailsRequiredBody = {
          statusCode: 400,
          error: "Bad Request",
          code: "transfer_details_required",
          message:
            "a transfer restaurant needs transferDetails — send them, or keep the saved ones",
        };
        throw new BadRequestException(error);
      }
    }
  }
}
