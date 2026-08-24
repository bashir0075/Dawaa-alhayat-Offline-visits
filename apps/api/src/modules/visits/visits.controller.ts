import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString,
  Min, Max, ValidateNested, ArrayMinSize, IsDateString,
} from 'class-validator';
import { CustomerType, ProductRole, VisitType, VisitSource } from '@prisma/client';
import { VisitsService } from './visits.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';

class VisitProductDto {
  @IsInt() @Min(1) productId!: number;
  @IsEnum(ProductRole) role!: ProductRole;
  @IsOptional() @IsInt() @Min(0) @Max(10000) quantity?: number;
}

class NewCustomerDto {
  @IsString() @IsNotEmpty({ message: 'اسم العميل مطلوب' }) nameAr!: string;
  @IsOptional() @IsInt() specialityId?: number;
  @IsOptional() @IsString() hospital?: string;
  @IsOptional() @IsEnum(['a', 'p']) workTime?: 'a' | 'p';
  @IsOptional() @IsInt() provinceId?: number;
  @IsOptional() @IsInt() areaId?: number;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsInt() classId?: number;
}

class CreateVisitDto {
  @IsEnum(VisitType) visitType!: VisitType;
  @IsEnum(CustomerType) customerType!: CustomerType;

  @IsOptional() @IsInt() @Min(1) customerId?: number;

  @IsOptional() @ValidateNested() @Type(() => NewCustomerDto) newCustomer?: NewCustomerDto;

  @IsDateString({}, { message: 'تاريخ الزيارة بصيغة YYYY-MM-DD' }) visitDate!: string;

  @IsOptional() @IsString() visitReason?: string;

  @IsArray() @ArrayMinSize(1, { message: 'اختر منتجاً أساسياً على الأقل' })
  @ValidateNested({ each: true }) @Type(() => VisitProductDto)
  products!: VisitProductDto[];

  @IsOptional() @IsInt() @Min(0) @Max(10000) sampleQuantity?: number;
  @IsOptional() @IsBoolean() promoGiven?: boolean;
  @IsOptional() @IsString() promoText?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsEnum(VisitSource) source?: VisitSource;
}

class CorrectionDto {
  @IsString() @IsNotEmpty() fieldName!: string;
  @IsString() newValue!: string;
  @IsString() @IsNotEmpty({ message: 'سبب التصحيح مطلوب' }) reason!: string;
}

class ReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() note?: string;
}

@ApiTags('الزيارات')
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('visits.create')
  @ApiOperation({ summary: 'تحذيرات شاشة المراجعة — قبل التأكيد النهائي' })
  preview(@CurrentUser() user: AuthUser, @Body() dto: CreateVisitDto) {
    return this.visits.previewWarnings(user, dto as any);
  }

  @Post()
  @RequirePermissions('visits.create')
  @ApiOperation({ summary: 'تسجيل زيارة — تُقفل فور الحفظ ولا تُعدَّل' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVisitDto) {
    return this.visits.create(user, dto as any);
  }

  @Get()
  @RequirePermissions('visits.view_own')
  @ApiOperation({ summary: 'قائمة الزيارات ضمن نطاق المستخدم' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('customerId') customerId?: string,
    @Query('visitType') visitType?: VisitType,
    @Query('customerType') customerType?: CustomerType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.visits.list(user, {
      from, to, visitType, customerType,
      userId: userId ? Number(userId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('visits.view_own')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.visits.findOne(user, id);
  }

  @Post(':id/corrections')
  @RequirePermissions('corrections.request')
  @ApiOperation({ summary: 'طلب تصحيح — البديل عن التعديل المباشر' })
  requestCorrection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CorrectionDto,
  ) {
    return this.visits.requestCorrection(user, id, dto);
  }

  @Post('corrections/:id/review')
  @HttpCode(200)
  @RequirePermissions('corrections.approve')
  @ApiOperation({ summary: 'مراجعة طلب تصحيح' })
  reviewCorrection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDto,
  ) {
    return this.visits.reviewCorrection(user, id, dto.approve, dto.note);
  }
}
