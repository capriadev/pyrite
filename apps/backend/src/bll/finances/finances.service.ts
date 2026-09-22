import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FinancesRepository } from '../../dal/finances/finances.repository';
import { DisputesIntakeService, type MovementIntake } from '../disputes/disputes-intake.service';

export interface NewMovementInput {
  type: 'income' | 'expense';
  amountCurrency: 'ARS' | 'USD';
  amount: number;
  paidCurrency: 'ARS' | 'USD';
  paidAmount: number;
  balanceSource: 'cash_ars' | 'digital_ars' | 'cash_usd' | 'digital_usd';
  categoryId: string;
  description: string;
  note?: string | null;
  /** A JSON client always sends a string; a Date is accepted for callers inside the app. */
  date?: Date | string;
  platformId?: string | null;
}

@Injectable()
export class FinancesService {
  private readonly log = new Logger(FinancesService.name);

  constructor(
    private readonly repo: FinancesRepository,
    private readonly intake: DisputesIntakeService,
  ) {}

  /**
   * Create a movement. If rate is not provided, compute the effective rate
   * as paidAmount/amount (immutable snapshot).
   *
   * The dispute engine gets a look at what was just saved (spec 021): the movement is already
   * written, so a failure of the engine is logged and never turns into a 500 - the answer
   * simply arrives without the intake suggestion.
   */
  async createMovement(input: NewMovementInput, rateUsed?: number): Promise<unknown> {
    const rate = rateUsed ?? (input.paidAmount / input.amount);
    const movement = await this.repo.createMovement({
      type: input.type,
      amountCurrency: input.amountCurrency,
      amount: String(input.amount),
      paidCurrency: input.paidCurrency,
      paidAmount: String(input.paidAmount),
      rateUsed: String(rate),
      balanceSource: input.balanceSource,
      categoryId: input.categoryId,
      description: input.description,
      note: input.note ?? null,
      date: this.movementDate(input.date),
      platformId: input.platformId ?? null,
    });

    // Apply to balance source
    const current = await this.repo.getBalance(input.balanceSource);
    // paidAmount is the real amount in the balance's currency
    const delta = input.type === 'income' ? input.paidAmount : -input.paidAmount;
    await this.repo.setBalance(input.balanceSource, current + delta);

    const intake = await this.intakeAfterSave(movement.id);
    return intake ? { ...movement, intake } : movement;
  }

  /** The engine's answer to what was just recorded, or nothing when it has nothing to say. */
  private async intakeAfterSave(movementId: string): Promise<MovementIntake | null> {
    try {
      return await this.intake.intakeFor(movementId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Intake skipped for movement ${movementId}: ${message}`);
      return null;
    }
  }

  async listMovements() {
    return this.repo.findMovements();
  }

  /**
   * The date of a movement is optional (now by default) but must be a real moment: a JSON
   * client sends a string and a malformed one used to reach the driver, which answered a 500.
   */
  private movementDate(value: Date | string | undefined): Date {
    if (value === undefined) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('invalid date');
    return date;
  }

  async softDeleteMovement(id: string): Promise<void> {
    const m = await this.repo.findMovement(id);
    if (!m) throw new Error('movement not found');
    // Restore balance (opposite of what the movement did)
    if (m.status !== 'deleted') {
      const delta = m.type === 'income' ? -Number(m.paidAmount) : Number(m.paidAmount);
      const current = await this.repo.getBalance(m.balanceSource as never);
      await this.repo.setBalance(m.balanceSource as never, current + delta);
    }
    await this.repo.softDeleteMovement(id);
  }

  async createCategory(name: string, type: 'income' | 'expense', isService = false): Promise<unknown> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('category name is required');
    return this.repo.createCategory(trimmed, type, isService === true);
  }

  /** Marks the category where services and subscriptions land: what turns the intake on. */
  async setCategoryService(id: string, isService: unknown): Promise<unknown> {
    const category = await this.repo.findCategory(id);
    if (!category) throw new BadRequestException('category not found');
    if (typeof isService !== 'boolean') throw new BadRequestException('isService must be a boolean');
    return this.repo.setCategoryService(id, isService);
  }

  async listCategories() {
    return this.repo.findCategories();
  }

  async createPlatform(name: string) {
    return this.repo.createPlatform(name);
  }

  async listPlatforms() {
    return this.repo.findPlatforms();
  }

  async getBalances() {
    const keys = ['cash_ars', 'digital_ars', 'cash_usd', 'digital_usd'] as const;
    const result: Record<string, number> = {};
    for (const k of keys) {
      result[k] = await this.repo.getBalance(k);
    }
    return result;
  }

  async setBalance(key: string, amount: number) {
    await this.repo.setBalance(key as never, amount);
    return this.getBalances();
  }
}