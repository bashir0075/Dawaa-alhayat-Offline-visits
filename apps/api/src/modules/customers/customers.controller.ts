import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CustomerType } from '@prisma/client';
import { CustomersService } from './customers.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';

class CreateCustomerDto {
  @IsEnum(CustomerType) customerType!: CustomerType;
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

class ReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() note?: string;
}

@ApiTags('العملاء')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('search')
  @RequirePermissions('customers.view_own')
  @ApiOperation({ summary: 'بحث متسامح مع الأخطاء الإملائية العربية' })
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') q: string,
    @Query('type') type?: CustomerType,
    @Query('onlyMine') onlyMine?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customers.search(user, {
      q: q ?? '',
      customerType: type,
      onlyMine: onlyMine !== 'false',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('my-list')
  @RequirePermissions('customers.view_own')
  @ApiOperation({ summary: 'قائمتي — العملاء المسنَدون لي' })
  myList(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: CustomerType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.customers.myList(user, {
      customerType: type,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('requests/pending')
  @RequirePermissions('customers.approve')
  @ApiOperation({ summary: 'طلبات بانتظار موافقتي' })
  pending(@CurrentUser() user: AuthUser) {
    return this.customers.pendingRequests(user);
  }

  @Post('requests/:id/review')
  @HttpCode(200)
  @RequirePermissions('customers.approve')
  @ApiOperation({ summary: 'الموافقة على طلب أو رفضه' })
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDto,
  ) {
    return this.customers.review(user, id, dto.approve, dto.note);
  }

  @Post()
  @RequirePermissions('customers.create')
  @ApiOperation({ summary: 'إضافة عميل — يُسنَد لي فوراً وينتظر موافقة مديري' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('customers.view_own')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.customers.findOne(user, id);
  }
}
