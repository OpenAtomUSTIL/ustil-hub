import { Module } from '@nestjs/common';
import { CRYPTO_MASTER_KEY, CryptoService } from './crypto.service';

/** 个人信息信封加密（v10.0）：主密钥来自环境变量 APP_ENCRYPTION_KEY（32 字节 base64），不入库不进日志 */
export const cryptoProvider = {
  provide: CRYPTO_MASTER_KEY,
  useValue: process.env.APP_ENCRYPTION_KEY ?? '',
};

@Module({
  providers: [cryptoProvider, CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
