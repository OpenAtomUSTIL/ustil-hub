import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CaptchaService } from './captcha.service';

@Controller('auth')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  /** 敏感操作图形验证码：captchaId + SVG data URI（登录/注册等表单用，匿名可取） */
  @Public()
  @Get('captcha')
  create(): Promise<{ captchaId: string; image: string }> {
    return this.captchaService.create();
  }
}
