import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appValidationPipe } from './common/pipes/app-validation.pipe';
import { AppConfig, configuration } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const cfg = app.get<AppConfig>(configuration.KEY);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(appValidationPipe);
  // 全局异常过滤器经 APP_FILTER 注册（见 app.module.ts）
  // 开发环境 CORS（携带凭证）
  app.enableCors({ origin: cfg.corsOrigin, credentials: true });

  await app.listen(cfg.port);
}

void bootstrap();
