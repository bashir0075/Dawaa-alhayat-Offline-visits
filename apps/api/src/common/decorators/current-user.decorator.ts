import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  roleKey: string;
  permissions: string[];
  departmentId: number | null;
  managerId: number | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user: AuthUser = ctx.switchToHttp().getRequest().user;
    return data ? user?.[data] : user;
  },
);
