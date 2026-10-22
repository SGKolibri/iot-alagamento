import type { LoggerService } from '@nestjs/common';
import type { Logger, Level } from 'pino';

// LoggerService do NestJS sobre o pino: os logs do framework também saem em JSON.
// O Nest passa o contexto como último parâmetro; em error, o primeiro extra é a pilha.
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    const stack = params.length >= 2 ? params[0] : undefined;
    this.write('error', message, params, stack === undefined ? {} : { pilha: stack });
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(
    level: Level,
    message: unknown,
    params: unknown[],
    extra: Record<string, unknown> = {},
  ): void {
    const last = params.at(-1);
    const context = typeof last === 'string' ? { contexto: last } : {};
    if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...context, ...extra, ...message });
      return;
    }
    this.logger[level]({ ...context, ...extra }, String(message));
  }
}
