import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { CustomerScopeService } from './customer-scope.service';

@Global()
@Module({
  providers: [ScopeService, CustomerScopeService],
  exports: [ScopeService, CustomerScopeService],
})
export class ScopeModule {}
