import {
  Body,
  Controller,
  type CallHandler,
  type ExecutionContext,
  Get,
  Inject,
  Injectable,
  type NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  CheckinKey,
  ExerciseHistory,
  FreezeRequestSummary,
  Membership,
  PaymentProofSummary,
  ProgressSummary,
  SaveSessionsResponse,
  TodayPlan,
} from '@gym/shared';
import { catchError, type Observable, throwError } from 'rxjs';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { MAX_IMAGE_BYTES } from '../files/file-store';
import { IMAGE_TOO_LARGE, MeService, type UploadedFile as Upload } from './me.service';

/** Turns the upload library's "File too large" into the app's plain message. */
@Injectable()
class UploadErrors implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) =>
        throwError(() => (err instanceof PayloadTooLargeException ? new PayloadTooLargeException(IMAGE_TOO_LARGE) : err)),
      ),
    );
  }
}

/** §10 Member routes — member only (staff get 403). */
@Roles('member')
@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Get('membership')
  membership(@CurrentUser() user: Principal): Promise<Membership> {
    return this.me.membership(user);
  }

  @Get('progress')
  progress(@CurrentUser() user: Principal): Promise<ProgressSummary> {
    return this.me.progress(user);
  }

  @Get('checkin-key')
  checkinKey(@CurrentUser() user: Principal): Promise<CheckinKey> {
    return this.me.checkinKey(user);
  }

  @Get('history/:exerciseId')
  history(@CurrentUser() user: Principal, @Param('exerciseId') exerciseId: string): Promise<ExerciseHistory> {
    return this.me.history(user, exerciseId);
  }

  @Get('plan/today')
  todayPlan(@CurrentUser() user: Principal): Promise<TodayPlan | null> {
    return this.me.todayPlan(user);
  }

  @Post('sessions')
  saveSessions(@CurrentUser() user: Principal, @Body() body: unknown): Promise<SaveSessionsResponse> {
    return this.me.saveSessions(user, body);
  }

  @Post('payment-proofs')
  @UseInterceptors(UploadErrors, FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  uploadProof(@CurrentUser() user: Principal, @UploadedFile() file: Upload | undefined): Promise<PaymentProofSummary> {
    return this.me.uploadProof(user, file);
  }

  @Post('freeze')
  requestFreeze(@CurrentUser() user: Principal, @Body() body: unknown): Promise<FreezeRequestSummary> {
    return this.me.requestFreeze(user, body);
  }
}
