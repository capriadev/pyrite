import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { FinancesService, type NewMovementInput } from '../../bll/finances/finances.service';

@Controller('finances')
export class FinancesController {
  constructor(private readonly finances: FinancesService) {}

  @Get('movements')
  listMovements() {
    return this.finances.listMovements();
  }

  @Post('movements')
  createMovement(@Body() body: NewMovementInput & { rateUsed?: number }) {
    return this.finances.createMovement(body, body.rateUsed);
  }

  @Delete('movements/:id')
  softDeleteMovement(@Param('id') id: string) {
    return this.finances.softDeleteMovement(id);
  }

  @Get('categories')
  listCategories() {
    return this.finances.listCategories();
  }

  @Post('categories')
  createCategory(@Body() body: { name: string; type: 'income' | 'expense' }) {
    return this.finances.createCategory(body.name, body.type);
  }

  @Get('platforms')
  listPlatforms() {
    return this.finances.listPlatforms();
  }

  @Post('platforms')
  createPlatform(@Body() body: { name: string }) {
    return this.finances.createPlatform(body.name);
  }

  @Get('balances')
  getBalances() {
    return this.finances.getBalances();
  }

  @Post('balances')
  setBalance(@Body() body: { key: string; amount: number }) {
    return this.finances.setBalance(body.key, body.amount);
  }
}