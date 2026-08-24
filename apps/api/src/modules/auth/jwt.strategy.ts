import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // نعيد تحميل المستخدم من قاعدة البيانات في كل طلب:
  // سحب صلاحية أو تعطيل حساب يسري فوراً بلا انتظار انتهاء التوكن
  async validate(payload: { sub: number }): Promise<AuthUser> {
    return this.auth.validateUserById(payload.sub);
  }
}
