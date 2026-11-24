import { Module } from '@nestjs/common';
import { ApprovalsController, FilesController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DbModule } from './db/db.module';
import { DoorModule } from './door/door.module';
import { FileStore } from './files/file-store';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { SetupController } from './setup/setup.controller';
import { SetupService } from './setup/setup.service';
import { TrainerController } from './trainer/trainer.controller';
import { TrainerService } from './trainer/trainer.service';

@Module({
  imports: [ConfigModule, DbModule, AuthModule, DoorModule],
  controllers: [
    HealthController,
    MeController,
    MembersController,
    PaymentsController,
    ApprovalsController,
    FilesController,
    DashboardController,
    MessagesController,
    SetupController,
    TrainerController,
  ],
  providers: [
    FileStore,
    MeService,
    MembersService,
    PaymentsService,
    ApprovalsService,
    DashboardService,
    MessagesService,
    SetupService,
    TrainerService,
  ],
})
export class AppModule {}
