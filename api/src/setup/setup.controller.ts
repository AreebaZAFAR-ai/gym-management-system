import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import type { Exercise, FeePlan, GymBrand, GymSettings, StaffMember } from '@gym/shared';
import { CurrentUser, type Principal, Public, Roles } from '../auth/auth.decorators';
import { SetupService } from './setup.service';

/**
 * §10 Brand (public): GET gyms/:id · Shared (any): GET exercises
 * Setup: GET plans · GET staff (reception, owner) · POST/PATCH plans, POST/PATCH staff, GET/PATCH settings (owner)
 */
@Controller()
export class SetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}

  @Public()
  @Get('gyms/:id')
  brand(@Param('id') id: string): Promise<GymBrand> {
    return this.setup.brand(id);
  }

  @Get('exercises')
  exercises(@CurrentUser() user: Principal): Promise<Exercise[]> {
    return this.setup.exercises(user);
  }

  @Roles('reception')
  @Get('plans')
  plans(@CurrentUser() user: Principal): Promise<FeePlan[]> {
    return this.setup.plans(user);
  }

  @Roles('owner')
  @Post('plans')
  createPlan(@CurrentUser() user: Principal, @Body() body: unknown): Promise<FeePlan> {
    return this.setup.createPlan(user, body);
  }

  @Roles('owner')
  @Patch('plans/:id')
  updatePlan(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: unknown): Promise<FeePlan> {
    return this.setup.updatePlan(user, id, body);
  }

  // §10 Setup: "GET plans · GET staff — Reception, owner" (reception picks a trainer at registration).
  @Roles('reception')
  @Get('staff')
  staff(@CurrentUser() user: Principal): Promise<StaffMember[]> {
    return this.setup.staff(user);
  }

  @Roles('owner')
  @Post('staff')
  createStaff(@CurrentUser() user: Principal, @Body() body: unknown): Promise<StaffMember> {
    return this.setup.createStaff(user, body);
  }

  @Roles('owner')
  @Patch('staff/:id')
  updateStaff(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: unknown): Promise<StaffMember> {
    return this.setup.updateStaff(user, id, body);
  }

  @Roles('owner')
  @Get('settings')
  settings(@CurrentUser() user: Principal): Promise<GymSettings> {
    return this.setup.settings(user);
  }

  @Roles('owner')
  @Patch('settings')
  updateSettings(@CurrentUser() user: Principal, @Body() body: unknown): Promise<GymSettings> {
    return this.setup.updateSettings(user, body);
  }
}
