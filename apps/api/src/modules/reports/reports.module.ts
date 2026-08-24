import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ExcelService } from './excel.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ExcelService],
  exports: [ReportsService, ExcelService],
})
export class ReportsModule {}
