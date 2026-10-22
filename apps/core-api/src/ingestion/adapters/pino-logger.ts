import type { LoggerPort } from '@iot/domain';
import type { Logger } from 'pino';

// LoggerPort com pino: uma linha JSON por registro, com os campos do filho (id_mensagem).
export class PinoLogger implements LoggerPort {
  constructor(private readonly logger: Logger) {}

  child(bindings: Record<string, unknown>): LoggerPort {
    return new PinoLogger(this.logger.child(bindings));
  }
  debug(fields: Record<string, unknown>, message: string): void {
    this.logger.debug(fields, message);
  }
  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }
  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }
}
