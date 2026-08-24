import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';

class LoginDto {
  @IsString() @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsString() @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty()
  refreshToken!: string;
}

class ChangePasswordDto {
  @IsString() @IsNotEmpty({ message: 'كلمة المرور الحالية مطلوبة' })
  currentPassword!: string;

  @IsString() @MinLength(8, { message: 'كلمة المرور يجب ألا تقل عن 8 محارف' })
  newPassword!: string;
}

const ip = (req: Request) => req.ip ?? req.socket?.remoteAddress ?? undefined;
const ua = (req: Request) => req.headers['user-agent'];

@ApiTags('المصادقة')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'تسجيل الدخول — اسم المستخدم يعمل بلاحقة أو بدونها' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.username, dto.password, ip(req), ua(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'تجديد التوكن' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ip(req), ua(req));
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'تسجيل الخروج' })
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'بيانات المستخدم الحالي وصلاحياته' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'تغيير كلمة المرور — يُنهي كل الجلسات' })
  changePassword(
    @CurrentUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(userId, dto.currentPassword, dto.newPassword, ip(req));
  }
}
