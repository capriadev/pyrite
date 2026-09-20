import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  TasksRepository,
  type ExpectationInsert,
  type TaskAggregate,
  type TaskExpectationRow,
  type TaskListFilters,
  type TaskPatch,
  type TaskPaymentRow,
  type TaskPriceTierRow,
  type TaskRecurrenceRow,
  type TaskRow,
} from '../../dal/tasks/tasks.repository';
import { TaskSectorsRepository, type TaskSectorRow } from '../../dal/tasks/task-sectors.repository';
import { GroupsService } from '../groups/groups.service';
import { isIsoDay, isUuid } from '../../types/guards';
import { MATERIALIZATION_HORIZON_DAYS, addDays, isoDay, occurrencesOf } from './recurrence-engine';
import {
  isCurrency,
  isFrequencyUnit,
  isPaymentMode,
  isRecurrenceEndMode,
  isTaskPriority,
  isTaskState,
  isTaskStatus,
  isTaskType,
  type TaskInput,
  type TaskListQuery,
  type TaskPaymentInput,
  type TaskPriority,
  type TaskRecurrenceInput,
  type TaskState,
  type TaskTierInput,
} from './tasks-input';

/** Domain of the group tree this service owns; other domains keep their own namespace. */
const TASK_DOMAIN = 'tasks';

/** One task as the API returns it: shell, ficha, rule, payload and tiers together. */
export interface TaskView {
  id: string;
  title: string;
  icon: string | null;
  type: TaskRow['type'];
  status: TaskRow['status'];
  description: string | null;
  notes: string | null;
  priority: TaskRow['priority'];
  state: TaskRow['state'];
  groupId: string | null;
  sectorId: string | null;
  linkedExpectationId: string | null;
  startsOn: string;
  createdAt: Date;
  updatedAt: Date;
  recurrence: TaskAggregate['recurrence'];
  payment: TaskAggregate['payment'];
  tiers: TaskAggregate['tiers'];
}

export interface MaterializationResult {
  tasks: number;
  created: number;
}

/**
 * Calendar/tasks logic (spec 015). Writes keep the rule, the payload and the
 * materialized expectations in sync; reads hand out estimates only. Finance
 * stays the single source of truth of real amounts, so nothing here is
 * authoritative beyond the dates it schedules.
 */
@Injectable()
export class TasksService {
  private readonly log = new Logger(TasksService.name);

  constructor(
    private readonly repo: TasksRepository,
    private readonly sectors: TaskSectorsRepository,
    private readonly groups: GroupsService,
  ) {}

  // ============ READS ============

  async list(query: TaskListQuery): Promise<TaskView[]> {
    const filters: TaskListFilters = {};
    if (query.type) {
      if (!isTaskType(query.type)) throw new BadRequestException('invalid task type');
      filters.type = query.type;
    }
    if (query.status) {
      if (!isTaskStatus(query.status)) throw new BadRequestException('invalid task status');
      filters.status = query.status;
    }
    if (query.from) filters.from = this.day(query.from, 'from');
    if (query.to) filters.to = this.day(query.to, 'to');
    if (query.group) filters.groupIds = await this.branchIds(query.group, query.includeDescendants === 'true');
    return (await this.repo.listAggregates(filters)).map((aggregate) => this.toView(aggregate));
  }

  /** A folder filter resolves to the node alone, or to the node plus its whole subtree. */
  private async branchIds(groupId: string, includeDescendants: boolean): Promise<string[]> {
    if (includeDescendants) return this.groups.subtreeIds(TASK_DOMAIN, groupId);
    const group = await this.groups.find(TASK_DOMAIN, groupId);
    return [group.id];
  }

  async get(id: string): Promise<TaskView> {
    return this.toView(await this.requireAggregate(id));
  }

  // ============ WRITES ============

  /** A task is created with its rule, payload and tiers, then materialized once. */
  async create(input: TaskInput): Promise<TaskView> {
    const title = this.requireTitle(input.title);
    const type = this.requireType(input.type);
    const startsOn = this.day(input.startsOn, 'startsOn');
    const recurrence = this.rule(input, type);
    const payment = this.payload(input, type);
    const tiers = this.tierRows(input.tiers);

    const task = await this.repo.create({
      title,
      type,
      startsOn,
      icon: input.icon ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      priority: this.priority(input.priority),
      state: this.state(input.state),
      groupId: await this.resolveGroup(input.groupId),
      sectorId: await this.resolveSector(input),
      linkedExpectationId: await this.resolveLink(input.linkedExpectationId),
    });
    if (recurrence) await this.repo.saveRecurrence(task.id, recurrence);
    if (payment) await this.repo.savePayment(task.id, payment);
    if (tiers.length > 0) await this.repo.replaceTiers(task.id, tiers);

    await this.materialize(task.id);
    this.log.log('tarea creada', { taskId: task.id, type });
    return this.get(task.id);
  }

  /**
   * An edit rewrites the rule and the payload, rebuilds only the future
   * expectations and leaves the past intact: what already happened is record.
   */
  async update(id: string, input: TaskInput): Promise<TaskView> {
    const current = await this.requireAggregate(id);
    const type = input.type === undefined ? current.task.type : this.requireType(input.type);
    if (type !== current.task.type) {
      if (type === 'recurrente' && !current.recurrence && !input.recurrence) {
        throw new BadRequestException('a recurring task needs a recurrence rule');
      }
      if (type === 'pago' && !current.payment && !input.payment) {
        throw new BadRequestException('a payment task needs a payment payload');
      }
    }

    const patch: TaskPatch = {};
    if (input.title !== undefined) patch.title = this.requireTitle(input.title);
    if (input.type !== undefined) patch.type = type;
    if (input.status !== undefined) patch.status = this.requireStatus(input.status);
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.description !== undefined) patch.description = input.description;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.priority !== undefined) patch.priority = this.priority(input.priority);
    if (input.state !== undefined) patch.state = this.state(input.state);
    if (input.groupId !== undefined) patch.groupId = await this.resolveGroup(input.groupId);
    if (input.sectorId !== undefined || input.sectorName !== undefined) {
      patch.sectorId = await this.resolveSector(input);
    }
    if (input.linkedExpectationId !== undefined) {
      patch.linkedExpectationId = await this.resolveLink(input.linkedExpectationId);
    }
    if (input.startsOn !== undefined) patch.startsOn = this.day(input.startsOn, 'startsOn');
    await this.repo.update(id, patch);

    if (input.recurrence !== undefined) {
      if (input.recurrence === null) await this.repo.deleteRecurrence(id);
      else await this.repo.saveRecurrence(id, this.ruleFrom(input.recurrence));
    }
    if (input.payment !== undefined) {
      if (input.payment === null) await this.repo.deletePayment(id);
      else await this.repo.savePayment(id, this.payloadFrom(input.payment));
    }
    if (input.tiers !== undefined) await this.repo.replaceTiers(id, this.tierRows(input.tiers));

    await this.repo.deleteExpectationsFrom(id, isoDay(new Date()));
    await this.materialize(id);
    this.log.log('tarea editada', { taskId: id });
    return this.get(id);
  }

  /** Soft delete: the record stays and the future stops being generated. */
  async remove(id: string): Promise<void> {
    await this.requireAggregate(id);
    await this.repo.update(id, { status: 'deleted' });
    await this.repo.deleteExpectationsFrom(id, isoDay(new Date()));
    this.log.log('tarea borrada', { taskId: id });
  }

  async expectations(id: string): Promise<TaskExpectationRow[]> {
    await this.requireAggregate(id);
    return this.repo.listExpectations(id);
  }

  // ============ MATERIALIZATION ============

  /** Rolls the window forward for one task. */
  async materialize(taskId: string): Promise<number> {
    const aggregate = await this.repo.findAggregate(taskId);
    if (!aggregate) throw new NotFoundException('task not found');
    return this.writeExpectations([aggregate]);
  }

  /** Pass over every active task: the scheduled catch-up of the whole calendar. */
  async materializeAll(): Promise<MaterializationResult> {
    const aggregates = await this.repo.listAggregates({ status: 'active' });
    const created = await this.writeExpectations(aggregates);
    if (created > 0) {
      this.log.log('expectativas materializadas', { tasks: aggregates.length, created });
    }
    return { tasks: aggregates.length, created };
  }

  private async writeExpectations(aggregates: TaskAggregate[]): Promise<number> {
    const today = isoDay(new Date());
    const horizon = addDays(today, MATERIALIZATION_HORIZON_DAYS);
    const rows: ExpectationInsert[] = [];
    for (const aggregate of aggregates) {
      for (const occurrence of occurrencesOf(aggregate, today, horizon)) {
        rows.push({
          taskId: aggregate.task.id,
          expectedOn: occurrence.expectedOn,
          estimatedAmount: occurrence.estimatedAmount,
          currency: occurrence.currency,
          tierPosition: occurrence.tierPosition,
        });
      }
    }
    return this.repo.insertExpectations(rows);
  }

  // ============ BOUNDARY VALIDATION ============

  private requireTitle(value: string | undefined): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('title is required');
    }
    return value.trim();
  }

  private requireType(value: string | undefined): TaskRow['type'] {
    if (!value || !isTaskType(value)) throw new BadRequestException('invalid task type');
    return value;
  }

  private requireStatus(value: string | undefined): TaskRow['status'] {
    if (!value || !isTaskStatus(value)) throw new BadRequestException('invalid task status');
    return value;
  }

  private day(value: string | undefined, field: string): string {
    if (!value || !isIsoDay(value)) throw new BadRequestException(`invalid ${field}`);
    return value;
  }

  private count(value: number | null | undefined, field: string, min: number): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isInteger(value) || value < min) throw new BadRequestException(`invalid ${field}`);
    return value;
  }

  /** Money travels as a string: numeric(14,2) is never a float in this API. */
  private amount(value: string | null | undefined, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) {
      throw new BadRequestException(`invalid ${field}`);
    }
    return value;
  }

  /** Rule of a recurring task: mandatory when the task is recurring. */
  private rule(input: TaskInput, type: TaskRow['type']): Omit<TaskRecurrenceRow, 'taskId'> | null {
    if (!input.recurrence) {
      if (type === 'recurrente') throw new BadRequestException('a recurring task needs a recurrence rule');
      return null;
    }
    return this.ruleFrom(input.recurrence);
  }

  private ruleFrom(input: TaskRecurrenceInput): Omit<TaskRecurrenceRow, 'taskId'> {
    if (!isFrequencyUnit(input.frequencyUnit)) throw new BadRequestException('invalid frequency unit');
    const endsMode = input.endsMode ?? 'never';
    if (!isRecurrenceEndMode(endsMode)) throw new BadRequestException('invalid end mode');
    return {
      frequencyUnit: input.frequencyUnit,
      interval: this.count(input.interval, 'interval', 1) ?? 1,
      endsMode,
      endsOn: endsMode === 'on_date' ? this.day(input.endsOn ?? undefined, 'endsOn') : null,
      occurrencesCount: endsMode === 'after_count' ? this.count(input.occurrencesCount, 'occurrencesCount', 1) : null,
    };
  }

  /** Financial payload: optional on purpose, a price-less payment is a variable service. */
  private payload(input: TaskInput, type: TaskRow['type']): Omit<TaskPaymentRow, 'taskId'> | null {
    if (!input.payment) {
      if (type === 'pago') throw new BadRequestException('a payment task needs a payment payload');
      return null;
    }
    return this.payloadFrom(input.payment);
  }

  private payloadFrom(input: TaskPaymentInput): Omit<TaskPaymentRow, 'taskId'> {
    if (!isPaymentMode(input.mode)) throw new BadRequestException('invalid payment mode');
    const currency = input.priceCurrency ?? 'ARS';
    if (!isCurrency(currency)) throw new BadRequestException('invalid currency');
    const priceFixed = input.priceFixed === true;
    const installmentsCount = input.mode === 'cuotas' ? this.count(input.installmentsCount, 'installmentsCount', 1) : null;
    if (input.mode === 'cuotas' && !installmentsCount) {
      throw new BadRequestException('installments mode needs an installment count');
    }
    return {
      mode: input.mode,
      priceFixed,
      priceAmount: priceFixed ? this.amount(input.priceAmount, 'priceAmount') : null,
      priceCurrency: currency,
      trialDays: this.count(input.trialDays, 'trialDays', 0) ?? 0,
      installmentsCount,
    };
  }

  /** Price tiers of a payment: positions are unique and define the hand-over order. */
  private tierRows(tiers: TaskTierInput[] | undefined): Array<Omit<TaskPriceTierRow, 'taskId' | 'id'>> {
    if (!tiers || tiers.length === 0) return [];
    const rows = tiers.map((tier) => {
      if (!Number.isInteger(tier.position) || tier.position < 1) {
        throw new BadRequestException('invalid tier position');
      }
      const currency = tier.currency ?? 'ARS';
      if (!isCurrency(currency)) throw new BadRequestException('invalid currency');
      return {
        position: tier.position,
        amount: this.amount(tier.amount, 'tier amount'),
        currency,
        appliesFromOccurrence: this.count(tier.appliesFromOccurrence, 'appliesFromOccurrence', 1) ?? 1,
      };
    });
    if (new Set(rows.map((row) => row.position)).size !== rows.length) {
      throw new BadRequestException('duplicated tier position');
    }
    return rows;
  }

  // ============ FICHA: GRUPO, SECTOR, PRIORIDAD, ESTADO Y VINCULO ============

  /** Folder assignment: null unassigns, anything else must exist in the tasks tree. */
  private async resolveGroup(groupId: string | null | undefined): Promise<string | null> {
    if (groupId === undefined || groupId === null) return null;
    const group = await this.groups.find(TASK_DOMAIN, groupId);
    return group.id;
  }

  /** Sector by id or by name: "otro" in the form arrives as `sectorName`. */
  private async resolveSector(input: TaskInput): Promise<string | null> {
    if (input.sectorId !== undefined) {
      if (input.sectorId === null) return null;
      if (!isUuid(input.sectorId)) throw new BadRequestException('invalid sector id');
      const sector = await this.sectors.findById(input.sectorId);
      if (!sector) throw new NotFoundException('sector not found');
      return sector.id;
    }
    if (input.sectorName !== undefined) {
      if (input.sectorName === null || input.sectorName.trim() === '') return null;
      return this.ensureSector(input.sectorName);
    }
    return null;
  }

  /** The catalogue reuses by name and revives a retired sector instead of duplicating it. */
  async ensureSector(name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('sector name is required');
    const existing = await this.sectors.findByName(trimmed);
    if (existing) {
      if (existing.status === 'deleted') await this.sectors.reactivate(existing.id);
      return existing.id;
    }
    return (await this.sectors.create(trimmed)).id;
  }

  /**
   * The link points at a payment expectation, which normally belongs to the subscription
   * task that generates it: "renovar el dominio" points at the domain's payment. Only its
   * existence is validated, because owning it is not required.
   */
  private async resolveLink(linkedExpectationId: string | null | undefined): Promise<string | null> {
    if (linkedExpectationId === undefined || linkedExpectationId === null) return null;
    if (!isUuid(linkedExpectationId)) throw new BadRequestException('invalid expectation id');
    const expectation = await this.repo.findExpectation(linkedExpectationId);
    if (!expectation) throw new NotFoundException('expectation not found');
    return expectation.id;
  }

  /** Both are nullable: a task without priority or state is a legitimate task. */
  private priority(value: TaskPriority | null | undefined): TaskPriority | null {
    if (value === undefined || value === null) return null;
    if (!isTaskPriority(value)) throw new BadRequestException('invalid priority');
    return value;
  }

  private state(value: TaskState | null | undefined): TaskState | null {
    if (value === undefined || value === null) return null;
    if (!isTaskState(value)) throw new BadRequestException('invalid state');
    return value;
  }

  // ============ SECTORS ============

  async listSectors(): Promise<TaskSectorRow[]> {
    return this.sectors.list();
  }

  async createSector(name: string): Promise<TaskSectorRow> {
    const id = await this.ensureSector(name);
    const sector = await this.sectors.findById(id);
    if (!sector) throw new NotFoundException('sector not found');
    return sector;
  }

  // ============ VIEW ============

  private toView(aggregate: TaskAggregate): TaskView {
    const { task, recurrence, payment, tiers } = aggregate;
    return {
      id: task.id,
      title: task.title,
      icon: task.icon,
      type: task.type,
      status: task.status,
      description: task.description,
      notes: task.notes,
      priority: task.priority,
      state: task.state,
      groupId: task.groupId,
      sectorId: task.sectorId,
      linkedExpectationId: task.linkedExpectationId,
      startsOn: task.startsOn,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      recurrence,
      payment,
      tiers,
    };
  }

  private async requireAggregate(id: string): Promise<TaskAggregate> {
    if (!isUuid(id)) throw new BadRequestException('invalid id');
    const aggregate = await this.repo.findAggregate(id);
    if (!aggregate) throw new NotFoundException('task not found');
    return aggregate;
  }
}
