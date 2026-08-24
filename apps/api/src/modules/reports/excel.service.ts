import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface SheetSpec {
  name: string;
  rows: any[];
  /** يبني جدول Excel حقيقي (ListObject) — شرط إدراج PivotTable لاحقاً */
  asTable?: boolean;
  note?: string;
}

const BRAND = 'FF1E40AF';
const BRAND_LIGHT = 'FFDBEAFE';
const ZEBRA = 'FFF8FAFC';

/** أعمدة تُنسَّق كنسبة مئوية مع تلوين تدرّجي */
const PERCENT_HINT = /%|نسبة/;
const DATE_HINT = /تاريخ|زيارة$|استخدام/;

@Injectable()
export class ExcelService {
  /**
   * يبني مصنّف Excel جاهزاً للتصدير.
   * ────────────────────────────────────────────────────────────────
   * كل ورقة RTL · رأس مجمّد · فلتر تلقائي · عرض أعمدة محسوب
   * ورقة البيانات جدول Excel حقيقي فيُدرَج عليها PivotTable بنقرتين
   */
  async build(opts: {
    title: string;
    subtitle?: string;
    sheets: SheetSpec[];
    generatedBy: string;
  }): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dawaa Al Hayat — نظام تسجيل الزيارات';
    wb.created = new Date();
    wb.title = opts.title;

    this.addCoverSheet(wb, opts);

    for (const spec of opts.sheets) {
      this.addDataSheet(wb, spec);
    }

    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  // ────────────────────────────────────────────────────────────────

  private addCoverSheet(wb: ExcelJS.Workbook, opts: {
    title: string; subtitle?: string; sheets: SheetSpec[]; generatedBy: string;
  }) {
    const ws = wb.addWorksheet('الغلاف', { views: [{ rightToLeft: true, showGridLines: false }] });
    ws.columns = [{ width: 4 }, { width: 34 }, { width: 52 }, { width: 14 }];

    ws.mergeCells('B2:D3');
    const t = ws.getCell('B2');
    t.value = opts.title;
    t.font = { size: 20, bold: true, color: { argb: BRAND } };
    t.alignment = { vertical: 'middle', horizontal: 'right' };

    if (opts.subtitle) {
      ws.mergeCells('B4:D4');
      const s = ws.getCell('B4');
      s.value = opts.subtitle;
      s.font = { size: 12, color: { argb: 'FF64748B' } };
      s.alignment = { horizontal: 'right' };
    }

    ws.getCell('B6').value = 'أُنشئ بواسطة';
    ws.getCell('C6').value = opts.generatedBy;
    ws.getCell('B7').value = 'تاريخ الإنشاء';
    ws.getCell('C7').value = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Baghdad' });
    for (const r of [6, 7]) {
      ws.getCell(`B${r}`).font = { bold: true, color: { argb: 'FF475569' } };
    }

    const header = ws.getRow(9);
    header.values = ['', 'الورقة', 'المحتوى', 'عدد الصفوف'];
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.height = 24;
    for (const c of ['B', 'C', 'D']) {
      ws.getCell(`${c}9`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      ws.getCell(`${c}9`).alignment = { vertical: 'middle', horizontal: 'center' };
    }

    let r = 10;
    for (const s of opts.sheets) {
      ws.getCell(`B${r}`).value = { text: s.name, hyperlink: `#'${s.name}'!A1` };
      ws.getCell(`B${r}`).font = { color: { argb: BRAND }, underline: true };
      ws.getCell(`C${r}`).value = s.note ?? '';
      ws.getCell(`D${r}`).value = s.rows.length;
      ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
      if (r % 2 === 0) {
        for (const c of ['B', 'C', 'D']) {
          ws.getCell(`${c}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        }
      }
      r++;
    }

    // تعليمات جدول Pivot — ExcelJS لا يكتب PivotTable أصلياً،
    // لكن ورقة البيانات جدول حقيقي فالإدراج يستغرق نقرتين.
    const pivotSheet = opts.sheets.find((s) => s.asTable);
    if (pivotSheet) {
      r += 1;
      ws.mergeCells(`B${r}:D${r + 3}`);
      const tip = ws.getCell(`B${r}`);
      tip.value =
        `📊 لإنشاء جدول Pivot:\n` +
        `اضغط أي خلية في ورقة «${pivotSheet.name}» ← إدراج ← PivotTable ← موافق.\n` +
        `البيانات مُعرَّفة كجدول Excel، فتظهر كل الأعمدة جاهزة للسحب.`;
      tip.alignment = { wrapText: true, vertical: 'middle', horizontal: 'right' };
      tip.font = { size: 11, color: { argb: 'FF1E3A5F' } };
      tip.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    }
  }

  private addDataSheet(wb: ExcelJS.Workbook, spec: SheetSpec) {
    // Excel يرفض أسماء الأوراق فوق 31 محرفاً أو الحاوية على : \ / ? * [ ]
    const safeName = spec.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
    const ws = wb.addWorksheet(safeName, {
      views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
    });

    if (!spec.rows.length) {
      ws.getCell('A1').value = 'لا توجد بيانات في هذه الفترة';
      ws.getCell('A1').font = { italic: true, color: { argb: 'FF94A3B8' }, size: 12 };
      ws.getColumn(1).width = 40;
      return;
    }

    const headers = Object.keys(spec.rows[0]);

    if (spec.asTable) {
      // جدول Excel حقيقي — يجعل PivotTable و Slicers متاحة مباشرة
      ws.addTable({
        name: safeName.replace(/[^\p{L}\p{N}]/gu, '_').slice(0, 30) || 'Data',
        ref: 'A1',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: headers.map((h) => ({ name: h, filterButton: true })),
        rows: spec.rows.map((r) => headers.map((h) => this.cellValue(r[h]))),
      });
    } else {
      ws.addRow(headers);
      for (const row of spec.rows) {
        ws.addRow(headers.map((h) => this.cellValue(row[h])));
      }

      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      head.height = 30;

      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      ws.eachRow((row, n) => {
        if (n > 1 && n % 2 === 0) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        }
      });
    }

    this.formatColumns(ws, headers, spec.rows);
  }

  private formatColumns(ws: ExcelJS.Worksheet, headers: string[], rows: any[]) {
    headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);

      // عرض محسوب من أطول قيمة، بحدّين لتفادي أعمدة مجهرية أو عملاقة
      const sample = rows.slice(0, 200);
      const longest = Math.max(
        h.length,
        ...sample.map((r) => String(r[h] ?? '').length),
      );
      col.width = Math.min(Math.max(longest + 3, 10), 45);

      if (PERCENT_HINT.test(h)) {
        col.numFmt = '0.0';
        col.alignment = { horizontal: 'center' };
      } else if (DATE_HINT.test(h)) {
        col.numFmt = 'yyyy-mm-dd';
        col.alignment = { horizontal: 'center' };
      } else if (typeof rows[0]?.[h] === 'number') {
        col.numFmt = '#,##0';
        col.alignment = { horizontal: 'center' };
      }
    });

    // تدرّج لوني لأعمدة النسبة: الأحمر منخفض ← الأخضر مرتفع
    headers.forEach((h, i) => {
      if (!PERCENT_HINT.test(h)) return;
      const letter = this.columnLetter(i + 1);
      ws.addConditionalFormatting({
        ref: `${letter}2:${letter}${rows.length + 1}`,
        rules: [
          {
            type: 'colorScale',
            priority: 1,
            cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 50 }, { type: 'num', value: 100 }],
            color: [{ argb: 'FFF87171' }, { argb: 'FFFDE047' }, { argb: 'FF4ADE80' }],
          } as any,
        ],
      });
    });
  }

  private columnLetter(n: number): string {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - m) / 26);
    }
    return s;
  }

  /** Prisma يعيد Decimal و Date و BigInt — Excel يحتاج قيماً أصلية */
  private cellValue(v: any): any {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }
}
