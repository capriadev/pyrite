import { currencyEnum, frequencyUnitEnum, paymentModeEnum, recurrenceEndModeEnum, taskPriorityEnum, taskStateEnum, taskStatusEnum, taskTypeEnum } from '../../../drizzle/schema';
import type { Currency, TaskPaymentRow, TaskRecurrenceRow, TaskStatus, TaskType } from '../../dal/tasks/tasks.repository';

/** Column enums derive from the schema, so a new value is one edit in one place. */
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type TaskState = (typeof taskStateEnum.enumValues)[number];

/**
 * Input contract of the calendar/tasks API plus its boundary guards. Validation
 * lives here so every entry point shares one source, same rule as counts-input.
 */

export type FrequencyUnit = TaskRecurrenceRow['frequencyUnit'];
export type RecurrenceEndMode = TaskRecurrenceRow['endsMode'];
export type PaymentMode = TaskPaymentRow['mode'];

export interface TaskRecurrenceInput {
  frequencyUnit: FrequencyUnit;
  /** "every N": 1 by default, 3 + `year` is every three years. */
  interval?: number;
  endsMode?: RecurrenceEndMode;
  endsOn?: string | null;
  occurrencesCount?: number | null;
}

/** A price tier: the promo that hands over to the regular price. */
export interface TaskTierInput {
  position: number;
  amount?: string | null;
  currency?: Currency;
  appliesFromOccurrence?: number;
}

/**
 * Financial payload of a payment task. A price is optional on purpose: a variable
 * service (rent, utilities) is declared without one and finance fills the real
 * amount later, so the system never invents an estimate.
 */
export interface TaskPaymentInput {
  mode: PaymentMode;
  priceFixed?: boolean;
  priceAmount?: string | null;
  priceCurrency?: Currency;
  trialDays?: number;
  installmentsCount?: number | null;
}

export interface TaskInput {
  title?: string;
  icon?: string | null;
  type?: TaskType;
  status?: TaskStatus;
  /** What has to be done: the focus of the task. */
  description?: string | null;
  /** Extra annotation, kept from v1. */
  notes?: string | null;
  priority?: TaskPriority | null;
  /** What a kanban board renders; null means the task is in no board. */
  state?: TaskState | null;
  groupId?: string | null;
  sectorId?: string | null;
  /** "Otro" in the form: the sector is created (or revived) by name and reused. */
  sectorName?: string | null;
  linkedExpectationId?: string | null;
  startsOn?: string;
  recurrence?: TaskRecurrenceInput | null;
  payment?: TaskPaymentInput | null;
  tiers?: TaskTierInput[];
}

export interface TaskListQuery {
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  /** Branch filter: the folder and everything under it. */
  group?: string;
  includeDescendants?: string;
}

function fromEnum<T extends string>(values: readonly string[], value: string): value is T {
  return values.includes(value);
}

export function isTaskType(value: string): value is TaskType {
  return fromEnum<TaskType>(taskTypeEnum.enumValues, value);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return fromEnum<TaskStatus>(taskStatusEnum.enumValues, value);
}

export function isFrequencyUnit(value: string): value is FrequencyUnit {
  return fromEnum<FrequencyUnit>(frequencyUnitEnum.enumValues, value);
}

export function isRecurrenceEndMode(value: string): value is RecurrenceEndMode {
  return fromEnum<RecurrenceEndMode>(recurrenceEndModeEnum.enumValues, value);
}

export function isPaymentMode(value: string): value is PaymentMode {
  return fromEnum<PaymentMode>(paymentModeEnum.enumValues, value);
}

export function isCurrency(value: string): value is Currency {
  return fromEnum<Currency>(currencyEnum.enumValues, value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return fromEnum<TaskPriority>(taskPriorityEnum.enumValues, value);
}

export function isTaskState(value: string): value is TaskState {
  return fromEnum<TaskState>(taskStateEnum.enumValues, value);
}
