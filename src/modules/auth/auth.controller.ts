import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestWithCookies } from '../../common/types';
import { AppConfig, configuration } from '../../config/configuration';
import { AuthService } from './auth.service';
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from './cookies';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RedeemInviteCodeDto } from './dto/redeem-invite-code.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(configuration.KEY) private readonly cfg: AppConfig,
  ) {}

  private get cookieFlags(): { secure: boolean } {
    return { secure: this.cfg.nodeEnv === 'production' };
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.register(dto);
    setAuthCookies(res, tokens, this.cookieFlags);
    return user;
  }

  @Post('invite-code')
  async redeemInviteCode(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: RedeemInviteCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user: updated, tokens } = await this.authService.redeemInviteCode(user.id, dto);
    setAuthCookies(res, tokens, this.cookieFlags);
    return updated;
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.login(dto, ip, userAgent);
    setAuthCookies(res, tokens, this.cookieFlags);
    return user;
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    const { user, tokens } = await this.authService.refresh(refreshToken);
    setAuthCookies(res, tokens, this.cookieFlags);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: RequestWithCookies,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req.cookies?.[REFRESH_TOKEN_COOKIE], ip, userAgent);
    clearAuthCookies(res, this.cookieFlags);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(user.id, dto);
  }

  @Get('me')
  me(@CurrentUser() user: CurrentAuthUser) {
    return this.authService.getMe(user.id);
  }
}
