import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

const USER_INCLUDE = {
  role: { include: { permissions: { include: { permission: true } } } },
  extraPermissions: { include: { permission: true } },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * اسم المستخدم قد يُكتب بلاحقة أو بدونها — كلاهما يعمل.
   * المندوب يحفظ رقمه فقط، فلا نُرهقه باللاحقة.
   */
  private canonicalUsername(input: string): string {
    const suffix = this.config.get<string>('USERNAME_SUFFIX', '@dawaa-alhayat');
    const v = input.trim();
    return v.includes('@') ? v.toLowerCase() : `${v}${suffix}`.toLowerCase();
  }

  /** الأذونات الفعلية = أذونات الدور + الممنوح فردياً − المسحوب فردياً */
  private effectivePermissions(user: any): string[] {
    const fromRole = user.role.permissions.map((rp: any) => rp.permission.key);
    const granted = user.extraPermissions.filter((p: any) => p.granted).map((p: any) => p.permission.key);
    const revoked = new Set(
      user.extraPermissions.filter((p: any) => !p.granted).map((p: any) => p.permission.key),
    );
    return [...new Set([...fromRole, ...granted])].filter((k) => !revoked.has(k));
  }

  private toAuthUser(user: any): AuthUser {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullNameAr || user.fullNameEn,
      roleKey: user.role.key,
      permissions: this.effectivePermissions(user),
      departmentId: user.departmentId,
      managerId: user.managerId,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ────────────────────────────────────────────────────────────────

  async login(rawUsername: string, password: string, ip?: string, userAgent?: string) {
    const username = this.canonicalUsername(rawUsername);
    const maxAttempts = Number(this.config.get('MAX_LOGIN_ATTEMPTS', 5));
    const lockoutMinutes = Number(this.config.get('LOCKOUT_MINUTES', 15));

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: USER_INCLUDE,
    });

    // نفس الرسالة سواء كان الاسم خاطئاً أو كلمة المرور — لا نكشف أي حساب موجود
    const fail = async () => {
      await this.prisma.loginAttempt.create({
        data: { username, success: false, ipAddress: ip, userAgent },
      });
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    };

    if (!user || user.deletedAt) return fail();

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`الحساب مقفل مؤقتاً. حاول بعد ${minutes} دقيقة`);
    }

    if (!user.isActive) {
      throw new ForbiddenException('هذا الحساب معطّل. راجع الإدارة');
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const since = new Date(Date.now() - lockoutMinutes * 60_000);
      const recentFailures = await this.prisma.loginAttempt.count({
        where: { username, success: false, createdAt: { gte: since } },
      });

      // recentFailures لا يشمل المحاولة الحالية بعد، لذا نقارن بـ maxAttempts - 1
      if (recentFailures >= maxAttempts - 1) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) },
        });
        this.logger.warn(`قُفل الحساب ${username} بعد ${maxAttempts} محاولات فاشلة`);
      }
      return fail();
    }

    // نجح الدخول — نظّف القفل وسجّل
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lockedUntil: null },
      }),
      this.prisma.loginAttempt.create({
        data: { username, success: true, ipAddress: ip, userAgent },
      }),
      this.prisma.auditLog.create({
        data: { actorId: user.id, action: 'login', entityType: 'user', entityId: String(user.id), ipAddress: ip, userAgent },
      }),
    ]);

    const authUser = this.toAuthUser(user);
    const tokens = await this.issueTokens(authUser, userAgent, ip);

    return {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        fullName: authUser.fullName,
        role: user.role.key,
        roleName: user.role.nameAr,
        permissions: authUser.permissions,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  private async issueTokens(user: AuthUser, deviceInfo?: string, ip?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.roleKey },
      { expiresIn: this.config.get('JWT_EXPIRES_IN', '15m') },
    );

    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const days = parseInt(this.config.get('REFRESH_TOKEN_EXPIRES_IN', '30d'), 10) || 30;

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        deviceInfo: deviceInfo?.slice(0, 250),
        ipAddress: ip,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { user: { include: USER_INCLUDE } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('انتهت الجلسة. سجّل الدخول من جديد');
    }
    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new ForbiddenException('هذا الحساب معطّل');
    }

    // تدوير: كل استخدام يُبطل القديم ويصدر جديداً
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(this.toAuthUser(stored.user), userAgent, ip);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'تم تسجيل الخروج' };
  }

  /** يُستدعى من JwtStrategy في كل طلب */
  async validateUserById(id: number): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('الحساب غير متاح');
    }
    return this.toAuthUser(user);
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string, ip?: string) {
    if (newPassword.length < 8) {
      throw new BadRequestException('كلمة المرور يجب ألا تقل عن 8 محارف');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('كلمة المرور الجديدة مطابقة للحالية');
    }

    const rounds = Number(this.config.get('BCRYPT_ROUNDS', 12));

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await bcrypt.hash(newPassword, rounds),
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      }),
      // تغيير كلمة المرور يُنهي كل الجلسات على كل الأجهزة
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: { actorId: userId, action: 'change_password', entityType: 'user', entityId: String(userId), ipAddress: ip },
      }),
    ]);

    return { message: 'تم تغيير كلمة المرور. سجّل الدخول من جديد' };
  }

  /** توليد كلمة مرور قوية — يستخدمه الأدمن عند التصفير */
  static generatePassword(length = 12): string {
    // بلا محارف ملتبسة: 0/O · 1/l/I
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    return Array.from(crypto.randomBytes(length))
      .map((b) => chars[b % chars.length])
      .join('');
  }
}
