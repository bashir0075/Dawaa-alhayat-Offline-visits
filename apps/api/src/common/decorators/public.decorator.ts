import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** يستثني المسار من التحقق من الـ JWT */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
