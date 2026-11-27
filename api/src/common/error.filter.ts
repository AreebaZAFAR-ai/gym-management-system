import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { pgErrorOf } from './db-errors';

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Every error leaves the API as `{ message }` in plain English that the apps
 * can show as is (spec §10). Unexpected errors are logged, never leaked.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ message: messageOf(exception, status) });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    const pg = pgErrorOf(exception);
    if (pg) this.logger.error(`PostgreSQL error ${JSON.stringify(pg)}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: GENERIC_ERROR });
  }
}

function messageOf(exception: HttpException, status: number): string {
  if (status === HttpStatus.NOT_FOUND && exception.message.startsWith('Cannot ')) return 'Not found.';
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('. ');
  return exception.message;
}
