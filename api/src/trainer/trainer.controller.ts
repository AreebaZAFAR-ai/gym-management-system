import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { ClientBest, CreatePlanResponse, TrainerClient, TrainerPlan, TrainerSession } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { TrainerService } from './trainer.service';

/**
 * §10 Trainer routes — trainer, owner:
 *   GET trainer/today · trainer/clients · trainer/clients/:id/bests · trainer/plans
 *   PATCH trainer/sessions/:id · POST trainer/plans · DELETE trainer/plans/:id
 *   POST trainer/sessions (from the sessions clarification; §10 lists no create route, so the path is provisional)
 */
@Roles('trainer')
@Controller('trainer')
export class TrainerController {
  constructor(@Inject(TrainerService) private readonly trainer: TrainerService) {}

  @Get('today')
  today(@CurrentUser() user: Principal): Promise<TrainerSession[]> {
    return this.trainer.today(user);
  }

  @Post('sessions')
  createSession(@CurrentUser() user: Principal, @Body() body: unknown): Promise<TrainerSession> {
    return this.trainer.createSession(user, body);
  }

  @Patch('sessions/:id')
  setDone(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: unknown): Promise<TrainerSession> {
    return this.trainer.setDone(user, id, body);
  }

  @Get('clients')
  clients(@CurrentUser() user: Principal): Promise<TrainerClient[]> {
    return this.trainer.clients(user);
  }

  @Get('clients/:id/bests')
  clientBests(@CurrentUser() user: Principal, @Param('id') id: string): Promise<ClientBest[]> {
    return this.trainer.clientBests(user, id);
  }

  @Get('plans')
  plans(@CurrentUser() user: Principal): Promise<TrainerPlan[]> {
    return this.trainer.plans(user);
  }

  @Post('plans')
  createPlan(@CurrentUser() user: Principal, @Body() body: unknown): Promise<CreatePlanResponse> {
    return this.trainer.createPlan(user, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  deletePlan(@CurrentUser() user: Principal, @Param('id') id: string): Promise<void> {
    return this.trainer.deletePlan(user, id);
  }
}
