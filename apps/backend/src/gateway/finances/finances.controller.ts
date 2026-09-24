import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { FinancesService, type NewMovementInput } from '../../bll/finances/finances.service';
import { DisputesIntakeService } from '../../bll/disputes/disputes-intake.service';

@Controller('finances')
export class FinancesController {
  constructor(
    private readonly finances: FinancesService,
    private readonly intake: DisputesIntakeService,
  ) {}

  @Get('movements')
  listMovements() {
    return this.finances.listMovements();
  }

  /**
   * The movement is saved by finances and then shown to the dispute engine (spec 025): the
   * composition lives here, in the gateway, so the finances domain does not import the engine and
   * the engine's answer is an extra on the response, never a condition to save.
   */
  @Post('movements')
  async createMovement(@Body() body: NewMovementInput & { rateUsed?: number }) {
    const movement = (await this.finances.createMovement(body, body.rateUsed)) as { id: string };
    const intake = await this.intake.intakeForSaved(movement.id);
    return intake ? { ...movement, intake } : movement;
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