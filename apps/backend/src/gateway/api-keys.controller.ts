import { Controller, Get, Post, Param, Delete, Body, Put } from '@nestjs/common';
import { ApiKeysService } from '../bll/api-keys.service';

@Controller('apis')
export class ApiKeysController {
  constructor(private readonly apis: ApiKeysService) {}

  @Get()
  list() {
    return this.apis.list();
  }

  @Post()
  create(@Body() body: { provider: string; label: string; key: string }) {
    return this.apis.create(body);
  }

  @Get(':id/value')
  async value(@Param('id') id: string) {
    return { key: await this.apis.getValue(id) };
  }

  @Post(':id/validate')
  async validate(@Param('id') id: string) {
    return { status: await this.apis.validate(id) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apis.remove(id);
  }

  @Put(':id/label')
  updateLabel(@Param('id') id: string, @Body() body: { label: string }) {
    return this.apis.updateLabel(id, body.label);
  }
}