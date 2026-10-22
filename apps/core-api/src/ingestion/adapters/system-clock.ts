import type { ClockPort } from '@iot/domain';

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
