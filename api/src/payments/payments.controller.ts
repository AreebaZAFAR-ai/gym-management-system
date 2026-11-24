import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import type { Payment, RecordPaymentResponse } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { PaymentsService } from './payments.service';

/** §10 Fees: POST payments · GET payments?from&to&member — reception, owner. */
@Roles('reception')
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  record(@CurrentUser() user: Principal, @Body() body: unknown): Promise<RecordPaymentResponse> {
    return this.payments.record(user, body);
  }

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: unknown): Promise<Payment[]> {
    return this.payments.list(user, query);
  }
}
