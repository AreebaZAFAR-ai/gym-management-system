import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
import { DevicesController } from './devices.controller';
import { DoorService } from './door.service';

@Module({
  controllers: [DevicesController, CheckinsController],
  providers: [DoorService],
  exports: [DoorService],
})
export class DoorModule {}
