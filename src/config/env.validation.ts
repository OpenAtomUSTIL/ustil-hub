import Joi from 'joi';

// 启动期环境变量校验（AGENTS.md §19）
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().positive().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().valid(0, 1).default(0),
  // 逗号分隔多源（v11.0：可加 https://docs.openatomustil.cn 供文档站试调）
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
  // cookie 域（可选）：如 .openatomustil.cn，使主站会话对子域可见（文档站试调用）；缺省 host-only
  COOKIE_DOMAIN: Joi.string().allow('').optional(),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  // 个人信息信封加密主密钥（v10.0）：32 字节 base64，生成方式见 .env.example；不入库不进日志
  APP_ENCRYPTION_KEY: Joi.string().base64().length(44)
    .message('APP_ENCRYPTION_KEY 必须是 32 字节 base64（node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"）')
    .required(),
  STORAGE_DRIVER: Joi.string().valid('local', 'r2').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./storage'),
  R2_ENDPOINT: Joi.string().allow('').when('STORAGE_DRIVER', {
    is: 'r2',
    then: Joi.string().required(),
  }),
  R2_ACCESS_KEY_ID: Joi.string().allow('').when('STORAGE_DRIVER', {
    is: 'r2',
    then: Joi.string().required(),
  }),
  R2_SECRET_ACCESS_KEY: Joi.string().allow('').when('STORAGE_DRIVER', {
    is: 'r2',
    then: Joi.string().required(),
  }),
  R2_BUCKET: Joi.string().allow('').when('STORAGE_DRIVER', {
    is: 'r2',
    then: Joi.string().required(),
  }),
  // 兼容旧配置；文件一律经鉴权 API 读取，不再需要公开 bucket URL。
  R2_PUBLIC_BASE_URL: Joi.string().allow('').optional(),
  UPLOAD_MAX_SIZE: Joi.number().integer().positive().default(10485760),
  ADMIN_EMAIL: Joi.string().allow('').optional(),
  ADMIN_PASSWORD: Joi.string().allow('').optional(),
});
