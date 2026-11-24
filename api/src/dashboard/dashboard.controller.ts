import { Controller, Get, Inject } from '@nestjs/common';
import type { DashboardSummary, ReportsSummary } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /** §10 Dashboard: GET dashboard — reception, owner. */
  @Roles('reception')
  @Get('dashboard')
  summary(@CurrentUser() user: Principal): Promise<DashboardSummary> {
    return this.dashboard.dashboard(user);
  }

  /** §10 Setup: GET reports — owner only ("Reception cannot open Reports", §13). */
  @Roles('owner')
  @Get('reports')
  reports(@CurrentUser() user: Principal): Promise<ReportsSummary> {
    return this.dashboard.reports(user);
  }
}
