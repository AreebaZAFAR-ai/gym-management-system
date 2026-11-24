import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { FreezeRequestItem, PaymentProofItem, RecordPaymentResponse, RequestStatus } from '@gym/shared';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { CurrentUser, type Principal, Public, Roles } from '../auth/auth.decorators';
import { verifySignedPath } from '../common/signed-url';
import { uuidParam } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { paymentProofs } from '../db/schema';
import { FileStore } from '../files/file-store';
import { ApprovalsService, proofImagePath } from './approvals.service';

/** §10 Approvals — reception, owner. */
@Roles('reception')
@Controller()
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @Get('payment-proofs')
  listProofs(@CurrentUser() user: Principal, @Query() query: unknown): Promise<PaymentProofItem[]> {
    return this.approvals.listProofs(user, query);
  }

  @Post('payment-proofs/:id/approve')
  @HttpCode(200)
  approveProof(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: unknown): Promise<RecordPaymentResponse> {
    return this.approvals.approveProof(user, id, body);
  }

  @Post('payment-proofs/:id/reject')
  @HttpCode(200)
  rejectProof(@CurrentUser() user: Principal, @Param('id') id: string): Promise<{ id: string; status: RequestStatus }> {
    return this.approvals.rejectProof(user, id);
  }

  @Get('freeze-requests')
  listFreezes(@CurrentUser() user: Principal, @Query() query: unknown): Promise<FreezeRequestItem[]> {
    return this.approvals.listFreezes(user, query);
  }

  @Post('freeze-requests/:id/approve')
  @HttpCode(200)
  approveFreeze(@CurrentUser() user: Principal, @Param('id') id: string): Promise<FreezeRequestItem> {
    return this.approvals.approveFreeze(user, id);
  }

  @Post('freeze-requests/:id/reject')
  @HttpCode(200)
  rejectFreeze(@CurrentUser() user: Principal, @Param('id') id: string): Promise<FreezeRequestItem> {
    return this.approvals.rejectFreeze(user, id);
  }
}

/**
 * GET /v1/files/proofs/:id?exp&sig — serves a screenshot only with a valid,
 * unexpired signature (§11: not public URLs). No bearer token, so an <img> tag works.
 */
@Public()
@Controller('files')
export class FilesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  @Get('proofs/:id')
  async proof(@Param('id') id: string, @Query('exp') exp: unknown, @Query('sig') sig: unknown, @Res() res: Response): Promise<void> {
    if (!uuidParam.safeParse(id).success || !verifySignedPath(this.env.JWT_SECRET, proofImagePath(id), exp, sig)) {
      throw new NotFoundException('This link has expired.');
    }
    const [proof] = await this.db.select({ key: paymentProofs.imageUrl }).from(paymentProofs).where(eq(paymentProofs.id, id));
    const file = proof ? await this.files.read(proof.key) : null;
    if (!file) throw new NotFoundException('This link has expired.');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.data);
  }
}
