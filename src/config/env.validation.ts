import Joi from 'joi';

// 启动期环境变量校验（AGENTS.md §19）
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().positive().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
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
  R2_PUBLIC_BASE_URL: Joi.string().allow('').when('STORAGE_DRIVER', {
    is: 'r2',
    then: Joi.string().required(),
  }),
  UPLOAD_MAX_SIZE: Joi.number().integer().positive().default(10485760),
  ADMIN_EMAIL: Joi.string().allow('').optional(),
  ADMIN_PASSWORD: Joi.string().allow('').optional(),
});
