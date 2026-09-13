import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { runWithRequestContext } from './request-context';

interface RequestWithId extends Request {
  reqId?: string;
}

/**
 * Assigns a correlation id to every request and logs its outcome.
 *
 * Only method, route, status and duration are recorded: request bodies are
 * never logged, so credentials cannot leak through the access log. The id is
 * propagated via AsyncLocalStorage so business logs emitted while handling the
 * request inherit the same reqId.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithId>();
    const res = context.switchToHttp().getResponse<Response>();
    const reqId = `req-${randomUUID().slice(0, 8)}`;
    req.reqId = reqId;
    res.setHeader('x-request-id', reqId);
    const startedAt = Date.now();

    return new Observable((subscriber) => {
      runWithRequestContext({ reqId }, () => {
        next
          .handle()
          .pipe(
            tap({
              next: () => this.record(req, res, reqId, startedAt),
              error: (err: unknown) => {
                const status = typeof err === 'object' && err !== null && 'status' in err
                  ? Number((err as { status: unknown }).status)
                  : 500;
                res.status(Number.isNaN(status) ? 500 : status);
                this.record(req, res, reqId, startedAt);
              },
            }),
          )
          .subscribe(subscriber);
      });
    });
  }

  private record(req: Request, res: Response, reqId: string, startedAt: number): void {
    const duration = Date.now() - startedAt;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    const meta = { reqId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: duration };
    if (res.statusCode >= 500) this.log.error(message, meta);
    else if (res.statusCode >= 400) this.log.warn(message, meta);
    else this.log.log(message, meta);
  }
}
