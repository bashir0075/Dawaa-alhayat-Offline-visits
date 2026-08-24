import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('القوائم المرجعية')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('bootstrap')
  @ApiOperation({ summary: 'كل قوائم شاشة الزيارة في طلب واحد' })
  bootstrap() {
    return this.catalog.bootstrap();
  }

  @Get('products')
  listProducts(@Query('includeInactive') inc?: string) {
    return this.catalog.listProducts(inc === 'true');
  }

  @Post('products')
  @RequirePermissions('catalog.manage_products')
  upsertProduct(@CurrentUser('id') userId: number, @Body() body: any) {
    return this.catalog.upsertProduct(userId, body);
  }

  @Post('products/:id/deactivate')
  @RequirePermissions('catalog.manage_products')
  @ApiOperation({ summary: 'تعطيل منتج — لا حذف، الزيارات القديمة تبقى سليمة' })
  deactivateProduct(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.catalog.deactivateProduct(userId, id);
  }

  @Post('products/:id/aliases')
  @RequirePermissions('catalog.manage_products')
  addAlias(@Param('id', ParseIntPipe) id: number, @Body('alias') alias: string) {
    return this.catalog.addAlias(id, alias);
  }

  @Post('provinces')
  @RequirePermissions('catalog.manage_geography')
  upsertProvince(@CurrentUser('id') userId: number, @Body() body: any) {
    return this.catalog.upsertProvince(userId, body);
  }

  @Post('areas')
  @RequirePermissions('catalog.manage_geography')
  upsertArea(@CurrentUser('id') userId: number, @Body() body: any) {
    return this.catalog.upsertArea(userId, body);
  }

  @Post('areas/merge')
  @RequirePermissions('catalog.manage_geography')
  @ApiOperation({ summary: 'دمج منطقتين مكرّرتين' })
  mergeAreas(@CurrentUser('id') userId: number, @Body() body: { sourceId: number; targetId: number }) {
    return this.catalog.mergeAreas(userId, body.sourceId, body.targetId);
  }

  @Get('classes')
  listClasses() {
    return this.catalog.listClasses();
  }

  @Post('classes/targets')
  @RequirePermissions('catalog.manage_classes')
  @ApiOperation({ summary: 'ضبط عدد الزيارات الشهرية لكل تصنيف A1…C2' })
  setClassTargets(@CurrentUser('id') userId: number, @Body() body: { targets: { code: string; monthlyTarget: number }[] }) {
    return this.catalog.setClassTargets(userId, body.targets);
  }

  @Post('specialities')
  @RequirePermissions('catalog.manage_lookups')
  upsertSpeciality(@CurrentUser('id') userId: number, @Body() body: any) {
    return this.catalog.upsertSpeciality(userId, body);
  }
}
