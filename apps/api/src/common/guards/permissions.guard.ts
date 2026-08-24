import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const user: AuthUser = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('غير مصرّح');

    // Super Admin يتجاوز كل شيء — لا قائمة أذونات تحدّه
    if (user.roleKey === 'super_admin') return true;

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) {
      throw new ForbiddenException(`لا تملك صلاحية: ${missing.join('، ')}`);
    }
    return true;
  }
}
