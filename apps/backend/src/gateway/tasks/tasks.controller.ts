import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { TasksService, type MaterializationResult, type TaskView } from '../../bll/tasks/tasks.service';
import { GroupsService } from '../../bll/groups/groups.service';
import { type TaskInput, type TaskListQuery } from '../../bll/tasks/tasks-input';
import type { GroupNode, GroupRow } from '../../dal/groups/groups.repository';
import type { TaskExpectationRow } from '../../dal/tasks/tasks.repository';
import type { TaskSectorRow } from '../../dal/tasks/task-sectors.repository';
import { isUuid } from '../../types/guards';

/** The tasks controller owns the folder tree of its own domain and nothing else. */
const TASK_DOMAIN = 'tasks';

/**
 * Tasks gateway (spec 015 and 016). The fixed routes (`materialize`, `groups`, `sectors`)
 * are declared before the `:id` ones so they never fall into the id parameter.
 */
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly groups: GroupsService,
  ) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group') group?: string,
    @Query('includeDescendants') includeDescendants?: string,
  ): Promise<TaskView[]> {
    const query: TaskListQuery = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (from) query.from = from;
    if (to) query.to = to;
    if (group) query.group = group;
    if (includeDescendants) query.includeDescendants = includeDescendants;
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

  // ============ GROUPS (folder tree of this domain) ============

  @Get('groups')
  listGroups(@Query('parentId') parentId?: string): Promise<GroupRow[]> {
    return this.groups.children(TASK_DOMAIN, parentId ? this.uuid(parentId) : null);
  }

  @Get('groups/tree')
  groupTree(): Promise<GroupNode[]> {
    return this.groups.tree(TASK_DOMAIN);
  }

  @Post('groups')
  createGroup(@Body() body: { name: string; parentId?: string | null }): Promise<GroupRow> {
    const parentId = body.parentId ? this.uuid(body.parentId) : null;
    return this.groups.create(TASK_DOMAIN, body.name, parentId);
  }

  @Put('groups/:id')
  updateGroup(
    @Param('id') id: string,
    @Body() body: { name?: string; parentId?: string | null },
  ): Promise<GroupRow> {
    const input: { name?: string; parentId?: string | null } = {};
    if (body.name !== undefined) input.name = body.name;
    if (body.parentId !== undefined) input.parentId = body.parentId === null ? null : this.uuid(body.parentId);
    return this.groups.update(TASK_DOMAIN, this.uuid(id), input);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string): Promise<void> {
    return this.groups.remove(TASK_DOMAIN, this.uuid(id));
  }

  // ============ SECTORS ============

  @Get('sectors')
  listSectors(): Promise<TaskSectorRow[]> {
    return this.tasks.listSectors();
  }

  /** "Otro" in the form: the sector is created (or revived) and reused from then on. */
  @Post('sectors')
  createSector(@Body() body: { name: string }): Promise<TaskSectorRow> {
    if (!body?.name) throw new BadRequestException('name is required');
    return this.tasks.createSector(body.name);
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
