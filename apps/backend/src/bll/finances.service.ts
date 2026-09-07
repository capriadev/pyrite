import { Injectable } from '@nestjs/common';
import { FinancesRepository } from '../dal/finances.repository';

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
  date?: Date;
  platformId?: string | null;
}

@Injectable()
export class FinancesService {
  constructor(private readonly repo: FinancesRepository) {}

  /**
   * Create a movement. If rate is not provided, compute the effective rate
   * as paidAmount/amount (immutable snapshot).
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
      date: input.date ?? new Date(),
      platformId: input.platformId ?? null,
    });

    // Apply to balance source
    const current = await this.repo.getBalance(input.balanceSource);
    // paidAmount is the real amount in the balance's currency
    const delta = input.type === 'income' ? input.paidAmount : -input.paidAmount;
    await this.repo.setBalance(input.balanceSource, current + delta);

    return movement;
  }

  async listMovements() {
    return this.repo.findMovements();
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

  async createCategory(name: string, type: 'income' | 'expense') {
    return this.repo.createCategory(name, type);
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