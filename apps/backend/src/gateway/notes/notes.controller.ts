import { Controller, Get, Post, Param, Delete, Body, Put, Query } from '@nestjs/common';
import { NotesService } from '../../bll/notes/notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Query('q') q?: string, @Query('privateOnly') privateOnly?: string) {
    if (q) return this.notes.search(q, { privateOnly: privateOnly === 'true' });
    return this.notes.list();
  }

  @Post()
  create(@Body() body: { title: string; content: string; groupId?: string; isPrivate?: boolean; pinned?: boolean }) {
    return this.notes.create(body);
  }

  @Get(':id/content')
  content(@Param('id') id: string) {
    return this.notes.getContent(id);
  }

  @Put(':id/content')
  updateContent(@Param('id') id: string, @Body() body: { content: string }) {
    return this.notes.updateContent(id, body.content);
  }

  @Put(':id')
  updateMeta(@Param('id') id: string, @Body() body: { title?: string; groupId?: string | null; pinned?: boolean }) {
    return this.notes.updateMeta(id, body);
  }

  @Put(':id/private')
  setPrivate(@Param('id') id: string, @Body() body: { isPrivate: boolean }) {
    return this.notes.setPrivate(id, body.isPrivate);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }

  // ============ GROUPS (domain 'notes') ============

  @Get('groups')
  listGroups() {
    return this.notes.listGroups();
  }

  @Post('groups')
  createGroup(@Body() body: { name: string }) {
    return this.notes.createGroup(body.name);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string) {
    return this.notes.removeGroup(id);
  }
}