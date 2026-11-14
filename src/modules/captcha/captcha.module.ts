import { Module } from '@nestjs/common';
import { redisProvider } from '../../db/redis';
import { CaptchaController } from './captcha.controller';
import { CaptchaService } from './captcha.service';

@Module({
  controllers: [CaptchaController],
  providers: [CaptchaService, redisProvider],
  exports: [CaptchaService],
})
export class CaptchaModule {}
