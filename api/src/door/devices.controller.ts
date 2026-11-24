import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { ScanResult } from '@gym/shared';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators';
import { DoorService } from './door.service';

/**
 * §10 Door: POST /v1/devices/:gymId/fingerprint {fingerprintId}, header x-device-key.
 * No staff login: the device authenticates with the gym's device key (§6 Settings).
 *
 * The device brand, model and protocol are not decided yet. Whatever the real
 * device is, it (or a small bridge next to it) only has to send this request;
 * scripts/demo-fingerprint-device.mjs plays that role for now.
 */
const fingerprintBody = z.object({
  fingerprintId: z
    .union([z.string(), z.number().int().nonnegative()])
    .transform((v) => String(v).trim())
    .pipe(z.string().min(1)),
});

@Public() // authenticated by x-device-key, not a user token (§10)
@Controller('devices')
export class DevicesController {
  constructor(@Inject(DoorService) private readonly door: DoorService) {}

  @Post(':gymId/fingerprint')
  @HttpCode(200)
  async fingerprint(
    @Param('gymId') gymId: string,
    @Headers('x-device-key') deviceKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ScanResult> {
    const gym = await this.door.authenticateDevice(gymId, deviceKey);
    const parsed = fingerprintBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException('fingerprintId is required.');
    return this.door.fingerprintCheckin(gym, parsed.data.fingerprintId);
  }
}
