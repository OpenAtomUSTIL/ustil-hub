import { Controller, Get, Header, Ip, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CaptchaService } from './captcha.service';

@Controller('auth')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  /** 敏感操作图形验证码：captchaId + PNG data URI（登录/注册等表单用，匿名可取）；theme 仅认 dark，其余值一律当浅色（向后兼容：不传 = 浅色） */
  @Public()
  @Get('captcha')
  @Header('Cache-Control', 'no-store')
  create(@Query('theme') theme?: string, @Ip() ip?: string): Promise<{ captchaId: string; image: string }> {
    return this.captchaService.create(theme === 'dark' ? 'dark' : 'light', ip);
  }
}
