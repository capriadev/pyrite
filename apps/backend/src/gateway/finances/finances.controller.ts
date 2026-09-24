import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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
  createCategory(@Body() body: { name: string; type: 'income' | 'expense'; isService?: boolean }) {
    return this.finances.createCategory(body.name, body.type, body.isService === true);
  }

  /** Marks the category where services and subscriptions land: turns the intake on for it. */
  @Put('categories/:id/service')
  setCategoryService(@Param('id') id: string, @Body() body: { isService: boolean }) {
    return this.finances.setCategoryService(id, body?.isService);
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