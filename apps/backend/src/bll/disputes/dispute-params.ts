import { BadRequestException } from '@nestjs/common';
import { isUuid } from '../../types/guards';

/**
 * The few validations the dispute services share (spec 022), so the same id rule and the same
 * task statuses are not written twice in the domain.
 */

/** An id that is about to reach SQL: rejected before it gets there. */
export function requireUuid(value: unknown, label: string): string {
  const text = String(value ?? '');
  if (!isUuid(text)) throw new BadRequestException(`invalid ${label}`);
  return text;
}

/** A task status the resolutions can apply, or null when the answer does not mention one. */
export function optionalTaskStatus(value: unknown): 'active' | 'paused' | 'deleted' | null {
  if (value === undefined || value === null) return null;
  if (value !== 'active' && value !== 'paused' && value !== 'deleted') {
    throw new BadRequestException('taskStatus must be active, paused or deleted');
  }
  return value;
}
