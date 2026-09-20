import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CalendarService, type CalendarDay } from '../../bll/calendar/calendar.service';

/** Calendar gateway (spec 015): a range read, nothing to write here. */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  range(@Query('from') from?: string, @Query('to') to?: string): Promise<CalendarDay[]> {
    if (!from || !to) throw new BadRequestException('from and to are required');
    return this.calendar.range(from, to);
  }
}
