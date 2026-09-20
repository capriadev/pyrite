import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { TasksService, type MaterializationResult, type TaskView } from '../../bll/tasks/tasks.service';
import { type TaskInput, type TaskListQuery } from '../../bll/tasks/tasks-input';
import type { TaskExpectationRow } from '../../dal/tasks/tasks.repository';
import { isUuid } from '../../types/guards';

/**
 * Tasks gateway (spec 015). `materialize` is declared before the `:id` routes so
 * it never falls into the id parameter.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<TaskView[]> {
    const query: TaskListQuery = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (from) query.from = from;
    if (to) query.to = to;
    return this.tasks.list(query);
  }

  @Post()
  create(@Body() body: TaskInput): Promise<TaskView> {
    return this.tasks.create(body);
  }

  /** Manual trigger of the scheduled pass: rolls the window forward for every task. */
  @Post('materialize')
  materialize(): Promise<MaterializationResult> {
    return this.tasks.materializeAll();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.get(this.uuid(id));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: TaskInput): Promise<TaskView> {
    return this.tasks.update(this.uuid(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.tasks.remove(this.uuid(id));
  }

  @Get(':id/expectations')
  expectations(@Param('id') id: string): Promise<TaskExpectationRow[]> {
    return this.tasks.expectations(this.uuid(id));
  }

  /** Guard applied before any id reaches SQL. */
  private uuid(value: string): string {
    if (!isUuid(value)) throw new BadRequestException('invalid id');
    return value;
  }
}
