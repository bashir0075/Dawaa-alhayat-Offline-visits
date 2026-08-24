import { Controller, Get, Query, Res, StreamableFile, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService, REPORTS, type ReportRange } from './reports.service';
import { ExcelService, type SheetSpec } from './excel.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('التقارير')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly excel: ExcelService,
  ) {}

  private range(q: any): ReportRange {
    if (!q.from || !q.to) throw new BadRequestException('حدّد تاريخ البداية والنهاية');
    return {
      from: q.from,
      to: q.to,
      userId: q.userId ? Number(q.userId) : undefined,
      provinceId: q.provinceId ? Number(q.provinceId) : undefined,
      customerType: q.customerType,
    };
  }

  @Get()
  @ApiOperation({ summary: 'قائمة التقارير المتاحة' })
  list() {
    return REPORTS;
  }

  @Get('data')
  @RequirePermissions('reports.view_own')
  @ApiOperation({ summary: 'تشغيل تقرير وإرجاع بياناته JSON' })
  async data(@CurrentUser() user: AuthUser, @Query() q: any) {
    if (!q.key) throw new BadRequestException('حدّد مفتاح التقرير');
    const rows = await this.reports.run(user, q.key, this.range(q));
    return { key: q.key, count: rows.length, rows };
  }

  @Get('export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'تصدير تقرير واحد إلى Excel' })
  async exportOne(
    @CurrentUser() user: AuthUser,
    @Query() q: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!q.key) throw new BadRequestException('حدّد مفتاح التقرير');
    const meta = REPORTS.find((r) => r.key === q.key);
    if (!meta) throw new BadRequestException(`تقرير غير معروف: ${q.key}`);

    const range = this.range(q);
    const rows = await this.reports.run(user, q.key, range);

    const sheets: SheetSpec[] = [
      { name: meta.titleAr, rows, asTable: q.key === 'visits_detail', note: meta.description },
    ];

    // التغطية بلا قائمة غير المزارين نصف تقرير
    if (q.key === 'coverage') {
      sheets.push({
        name: 'لم تتم زيارتهم',
        rows: await this.reports.uncoveredCustomers(user, range),
        note: 'العملاء الذين لم تتم زيارتهم في الفترة',
      });
    }

    const buf = await this.excel.build({
      title: meta.titleAr,
      subtitle: `من ${range.from} إلى ${range.to}`,
      sheets,
      generatedBy: user.fullName,
    });

    return this.send(res, buf, `${q.key}_${range.from}_${range.to}.xlsx`);
  }

  @Get('export/full')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'مصنّف واحد بكل التقارير — جاهز فوراً بلا إعداد' })
  async exportFull(
    @CurrentUser() user: AuthUser,
    @Query() q: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const range = this.range(q);
    const sheets: SheetSpec[] = [];

    for (const meta of REPORTS) {
      try {
        const rows = await this.reports.run(user, meta.key, range);
        sheets.push({
          name: meta.titleAr,
          rows,
          asTable: meta.key === 'visits_detail',
          note: meta.description,
        });

        if (meta.key === 'coverage') {
          sheets.push({
            name: 'لم تتم زيارتهم',
            rows: await this.reports.uncoveredCustomers(user, range),
            note: 'العملاء الذين لم تتم زيارتهم في الفترة',
          });
        }
      } catch (e: any) {
        // تقرير التارغيت يفشل ما لم تُضبط تصنيفات A1…C2.
        // نُدرج ورقة تشرح السبب بدل إسقاط المصنّف كله.
        sheets.push({
          name: meta.titleAr,
          rows: [{ 'الحالة': 'غير متاح', 'السبب': e?.message ?? 'خطأ غير معروف' }],
          note: meta.description,
        });
      }
    }

    const buf = await this.excel.build({
      title: 'التقرير الشامل — نظام تسجيل الزيارات',
      subtitle: `من ${range.from} إلى ${range.to}`,
      sheets,
      generatedBy: user.fullName,
    });

    return this.send(res, buf, `full_report_${range.from}_${range.to}.xlsx`);
  }

  private send(res: Response, buf: Buffer, filename: string) {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
    });
    return new StreamableFile(buf);
  }
}
