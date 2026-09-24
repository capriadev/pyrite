import { BadRequestException, Injectable } from '@nestjs/common';
import { FinancesRepository } from '../../dal/finances/finances.repository';

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
  constructor(private readonly repo: FinancesRepository) {}

  /**
   * Create a movement. If rate is not provided, compute the effective rate
   * as paidAmount/amount (immutable snapshot).
   *
   * The balance moves with an atomic increment (spec 025): the arithmetic happens in SQL, so two
   * concurrent saves cannot read the same value and overwrite each other. The dispute engine gets
   * a look at what was just saved from the gateway, not from here: finances does not know about it.
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

    // paidAmount is the real amount in the balance's currency.
    const delta = input.type === 'income' ? input.paidAmount : -input.paidAmount;
    await this.repo.incrementBalance(input.balanceSource, delta);

    return movement;
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
    // Restore the balance (opposite of what the movement did), atomically and only once.
    if (m.status !== 'deleted') {
      const delta = m.type === 'income' ? -Number(m.paidAmount) : Number(m.paidAmount);
      await this.repo.incrementBalance(m.balanceSource, delta);
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