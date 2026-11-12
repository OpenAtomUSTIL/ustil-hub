# AGENTS.md — ustil-hub 后端 + 跨端契约

> 本文件是给 AI 编码助手（Claude Code / Codex / Cursor / DSH 等）和人类协作者共同遵守的工作约定。
> `MUST` = 必须遵守；`MUST NOT` = 禁止；`SHOULD` = 默认这么做，偏离需在 PR 里说明理由。
>
>
> **优先级**：本文件 > 任何个人习惯 > 模型默认偏好。若与代码现状冲突，先按本文件修正代码，不要反过来改文档。

---

## 1. 项目定位

USTIL 官网/门户，本质是一个 **RBAC（基于角色的权限控制）系统**。

- 采用敏捷开发：**先做出可上线的最小版本，再迭代**。
- `MUST NOT` 提前实现"后续功能"（见 §2）。
- `MUST NOT` 为假设中的未来需求做抽象（唯一例外是 §12.1 的 `StorageService` 接口）。

## 2. MVP 边界（non-goals）

以下功能已明确**不属于当前阶段**。AI 不得自行实现、不得预留半成品代码、不得新增相关依赖：

| 功能 | 状态 |
|---|---|
| 邮箱验证码注册验证 / 发信（Resend） | 🔴 后续 |
| 私信、关注成员、内容推送 | 🔴 后续 |
| 邮件 / 站内异步队列（BullMQ 等） | 🔴 后续 |
| 私信已读状态 | 🔴 后续 |
| Backblaze B2 存储 | 🔴 后续 |
| 积分 / 奖励点机制 | ❌ 不做（仅保留 issue 三状态） |

用户若要求实现以上任一项，先确认再动手。

「后台管理界面、邀请码注册、五角色等级体系（VISITOR/MEMBER/ALUMNI/WHEEL/ADMIN）」为当前迭代已确认范围，见 §3 / §10。

## 3. 角色定义（唯一权威）

全项目只允许使用以下五个枚举值，`MUST NOT` 自造角色名：

| 枚举 | 中文 | 说明 |
|---|---|---|
| `VISITOR` | 临时访客 | 非邀请码注册；7 天内未持码转正则账号自动删除；可读文章、参与讨论（仅回复）；**禁止查阅作业** |
| `MEMBER` | 学习成员 | 邀请码注册即入；发起讨论、提交作业（强制）；注册满 4 年自动升 `ALUMNI`，或被 `WHEEL`/`ADMIN` 提前提拔 |
| `ALUMNI` | 校友 | 历届最终学员：发布文章、布置作业、答疑、参与作业；**无管理权** |
| `WHEEL` | 负责人 | 生成/作废邀请码、剔除过期学员（删 `MEMBER`/`VISITOR`）、提前提拔、发布内容、变更 issue 状态 |
| `ADMIN` | 管理员 | 公共账号：任免 `WHEEL`、封禁、删他人内容、最高权限；`ADMIN` `MUST NOT` 被改角色/删除/封禁 |

## 4. 跨端契约（前端 `web/AGENTS.md` 引用本节）

前后端联调的唯一事实来源。改动本节 `MUST` 同步更新前端文件。

### 4.1 路由前缀
- 所有接口以 `/api/v1` 开头。版本号写进 URL，`MUST NOT` 用 header 传版本。

### 4.2 响应体
- **成功**：直接返回业务数据体（对象或数组），`MUST NOT` 再包一层 `{ code, message, data }`。
- **失败**：固定结构，字段一个不多一个不少：
  ```json
  { "statusCode": 403, "error": "Forbidden", "message": "无权访问该资源", "path": "/api/v1/articles/1", "timestamp": "2026-11-09T03:04:10.212Z" }
  ```
  - `message` 可以是 `string` 或 `string[]`（校验错误为数组）。
  - 由全局 `AllExceptionsFilter` 统一产出，`MUST NOT` 在 controller 里手写错误体。

### 4.3 分页
- 请求：`?page=1&pageSize=20`
- 响应：`{ "items": [], "total": 0, "page": 1, "pageSize": 20 }`
- `pageSize` 默认 `20`，上限 `100`（超出必须被拒绝，不是静默截断）。

### 4.4 时间
- DB 列一律 `timestamptz`。
- 传输、日志、JSON 一律 ISO 8601 UTC 字符串：`2026-11-09T03:04:10.212Z`。
- `MUST NOT` 传 Unix 时间戳，`MUST NOT` 传本地时区字符串。

### 4.5 标识与命名
- 主键：`uuid`（v7），`MUST NOT` 用自增整数暴露给前端。
- 数据库列：`snake_case`；JSON 字段：`camelCase`。由 Drizzle 映射层转换，`MUST NOT` 让前端迁就 `snake_case`。

### 4.6 语言
- 用户可见文案：中文。
- 标识符、日志、commit message、代码结构名：英文。
- 注释：中文。

## 5. 技术栈锁定

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node.js 24 LTS | 见 `.nvmrc`，`MUST NOT` 升级 |
| 包管理器 | pnpm | `MUST NOT` 用 npm / yarn |
| 框架 | NestJS（**CJS** + TS `strict: true`） | `MUST NOT` 切 ESM |
| 数据库 | PostgreSQL | |
| ORM | `drizzle-orm`（查询）+ `drizzle-kit`（迁移） | |
| 缓存/限流 | Redis | 见 §15 |

**禁改清单 — `MUST NOT` 引入：**
- `express` 直接使用（Nest 已封装，绕开 Nest 直接挂 Express 中间件等于放弃架构）
- TypeORM / Prisma / Mongoose 等其它 ORM
- 任何"顺便重构"式的大范围改动（一次 PR 只做一件事）

## 6. 目录结构

```
src/
  main.ts
  app.module.ts
  common/
    decorators/        # @Roles() @Public() @CurrentUser()
    guards/            # RolesGuard, JwtAuthGuard
    filters/           # AllExceptionsFilter
    interceptors/
    pipes/
  config/              # env 校验与类型化配置
  db/
    index.ts           # drizzle 客户端实例
    schema/            # 每张表一个文件，index.ts 统一导出
  modules/
    auth/
      auth.controller.ts
      auth.service.ts
      dto/
      strategies/
    users/
    articles/
    assignments/
    issues/
    storage/
    admin/             # 邀请码 + 用户管理 + 统计（/admin/*，WHEEL,ADMIN）
    audit/             # 请求日志拦截器 + 操作审计（request_logs / audit_logs）
    announcements/     # 公告（可 notify 全员）
    notifications/     # 站内通知
    resources/         # 资源库（外链）
    tags/              # 统一标签（taggings 覆盖 ARTICLE/ISSUE/RESOURCE）
  migrations/          # drizzle-kit 产出，必须提交到 git
drizzle.config.ts
.env.example
```

新增功能 = 在 `modules/` 下新增一个模块目录。`MUST NOT` 把业务逻辑堆在 `app.module.ts` 或 `common/`。

## 7. 分层与依赖方向

```
controller → service → repository(db)
```

- `MUST`：controller 只做「解析请求 → 调用 service → 返回结果」，不写业务判断。
- `MUST`：service 是唯一有权做权限校验、状态机判断、事务的地方。
- `MUST NOT`：controller 内直接 `import { db }`。
- `MUST NOT`：service 直接读 `req` / `res`（用 `@CurrentUser()` 注入当前用户）。
- 跨模块调用：`MUST` 通过 service 暴露的方法，`MUST NOT` 跨模块直接查对方的表。

## 8. Drizzle 与迁移

- schema 文件放在 `src/db/schema/`，每张表一个文件，表名用 `snake_case` 复数。
- 所有查询走 Drizzle Query Builder。
- **`MUST NOT`** 用 `sql` 模板字面量拼接任何用户输入。确需原生 SQL（统计、复杂聚合）时，`MUST` 用参数占位形式 ``sql`... where id = ${id}` ``（drizzle 会自动参数化），并在 PR 说明原因。
- 外键 `MUST` 显式声明 `onDelete` 策略（默认 `restrict`，内容类可 `cascade` 前想清楚）。
- 索引：外键列、所有用于过滤/排序的列 `MUST` 建索引。

### 迁移流程（唯一合法路径）
1. 改 schema 文件
2. `pnpm db:generate --name <功能名>` 生成 SQL 到 `src/migrations/`，使用英文 snake_case 描述具体变更（如 `add_user_session_version`），`MUST NOT` 使用默认随机名称。`meta/000N_snapshot.json` 保留 Drizzle 的编号约定。
3. **人工 review 生成的 SQL**，确认没有 drop 数据
4. 提交 SQL 与 schema 到同一个 commit
5. 部署时由 CI 的**幂等 job** 执行 `pnpm db:migrate`

- **`MUST NOT`** 用 `drizzle-kit push` 操作任何共享/生产数据库。
- **`MUST NOT`** 手改已提交的迁移文件（发现错误就新增一个迁移修）。
- 启动时 `MUST NOT` 自动跑迁移（会多实例并发）；迁移只由部署 job 执行。

## 9. DTO、校验与异常

- 入口 DTO `MUST` 用 `class-validator` 装饰器声明。
- 全局 `ValidationPipe` 固定配置：
  ```ts
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  ```
  → 未声明字段直接 400 拒绝，防止前端/AI 顺手多塞字段。
- 出参 `MUST` 显式挑选字段返回，`MUST NOT` 直接返回 DB 行对象（会泄露 `password_hash`、`email`、`phone`）。
- 异常只用 Nest 内置类型（`UnauthorizedException` / `ForbiddenException` / `NotFoundException` / `ConflictException` / `BadRequestException`），`MUST NOT` `throw new Error('...')` 当业务错误。
- 错误码语义：401 未登录、403 已登录但无权、404 资源不存在或不可见、409 状态冲突、422/400 校验失败、429 限流。

## 10. RBAC 权限矩阵

实现方式：全局 `RolesGuard` + `@Roles()` 装饰器；公开接口用 `@Public()` 显式放行（默认全站需登录，`MUST NOT` 默认放行）。

| 能力 | VISITOR | MEMBER | ALUMNI | WHEEL | ADMIN |
|---|:---:|:---:|:---:|:---:|:---:|
| 注册 / 登录 / 改本人密码 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看本人完整资料 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看他人**基础**资料（昵称/头像/角色） | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看他人邮箱、手机号等私有字段 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 浏览文章 / issue、回复 issue | ✅ | ✅ | ✅ | ✅ | ✅ |
| 创建 issue | ❌ | ✅ | ✅ | ✅ | ✅ |
| 变更 issue 状态（已解答 / 搁置） | ❌ | ❌ | ✅ | ✅ | ✅ |
| 浏览作业 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 创建、编辑、删除**本人**文章 | ❌ | ✅（先审后发） | ✅（先发后审） | ✅ | ✅ |
| 删除**他人**文章 / 删除他人内容 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 审核文章（通过/拒绝/隐藏） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 发布、编辑作业 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 提交作业 | ❌ | ✅ | ✅ | ❌ | ❌ |
| 查看作业提交（仅该作业发布者或管理员） | ❌ | ❌ | ✅ | ✅ | ✅ |
| 生成 / 作废邀请码 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 剔除学员（删 `MEMBER`/`VISITOR` 账号） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 提前提拔 `MEMBER`→`ALUMNI` | ❌ | ❌ | ❌ | ✅ | ✅ |
| 改角色（任免 `WHEEL` 等）、封禁账号 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 考试 / 测试题（预留，未实现） | ❌ | 强制 | 可参与 | 发布 | ✅ |

补充规则：
- 校友（`ALUMNI`）**只读密码以外无权限**——他们能看 issue、能回复、能发内容，但**不能**管理他人、**不能**看他人联系方式。
- 所有涉及"本人"的操作，`MUST` 在 service 层校验 `resource.authorId === currentUser.id`，`MUST NOT` 只靠前端隐藏按钮。
- 被封禁账号（`users.status = 'BANNED'`）`MUST` 在 `JwtAuthGuard` 里直接 403，不进入业务逻辑。
- `ADMIN` 公共账号 `MUST NOT` 被改角色/删除/封禁，service 层拦截（403）。
- `VISITOR` `MUST NOT` 查阅/提交作业：作业列表/详情/提交接口对其 403，前端仅隐藏入口。
- 剔除学员 = 硬删 `MEMBER`/`VISITOR` 账号并级联其 issues/replies；`ALUMNI` 及以上不可被剔除。

## 11. 认证与密码

### 11.1 密码
- 算法 **Argon2id**，参数固定：
  ```
  memoryCost: 19456  (19 MiB)
  timeCost:   2
  parallelism: 1
  ```
- 列名 `password_hash`，`MUST NOT` 任何地方出现明文密码、`MUST NOT` 日志打印密码或请求体。

### 11.2 Token
- 双 token，均放 **httpOnly cookie**（JS 不可读，防 XSS 窃取）：

| Cookie | 内容 | TTL | Path | 说明 |
|---|---|---|---|---|
| `access_token` | JWT，含 `sub`(userId) + `role` | 15m | `/` | SameSite=Lax，`Secure` 恒开 |
| `refresh_token` | JWT，含 `sub` + `jti` | 7d | `/api/v1/auth` | 仅刷新/登出接口可见 |

- cookie `Secure` 恒开（2026-11-12 安全修复）：全站 HTTPS（nginx 443 + 80 跳转），本地开发走 `https://localhost`（自签证书见 `deploy/init-certs.sh`）。
- `POST /auth/refresh` 响应 `MUST` 只含脱敏公开字段（UserPublic：id/nickname/avatarUrl/role），`MUST NOT` 返回 `email`/`phone`；前端登录态恢复一律以 `GET /auth/me` 为来源。

- `refresh_token` 的 `jti` `MUST` 存 Redis 白名单，key = `refresh:{userId}:{jti}`，TTL = 7d。
- 刷新时**轮换**：旧 `jti` 立即删除，签发新的。检测到已删除的 `jti` 被复用 → 视为窃取，删除该用户全部 refresh 并强制重登。
- 改密码 / 登出 / 封禁 / 角色变更 → `MUST` 清除该用户全部 refresh 记录，并递增 `users.session_version`，使旧 access / refresh 同时失效。
- access / refresh JWT 携带内部 `sessionVersion`；鉴权与刷新均与数据库版本比较，不通过业务响应暴露。
- `MUST NOT` 把 token 放 localStorage（前端文件同样禁止）。

### 11.3 登录防护
- Redis 计数器：同一 `identifier`（邮箱/手机）+ IP 组合，15 分钟内失败 5 次 → 返回 429 并锁定 15 分钟。
- 登录失败响应 `MUST` 统一为"账号或密码错误"，`MUST NOT` 区分"用户不存在"与"密码错误"（防账号枚举）。
- 注册时邮箱/手机号唯一性冲突用 409 返回，这是少数允许明确告知的场景。

### 11.4 账号绑定
- 一个账号 `MUST` 只绑定**一个**邮箱或**一个**手机号（满足即可注册）。
- 绑定新邮箱/手机号 `MUST` 校验当前密码。

## 12. 存储与文件上传

### 12.1 抽象接口（唯一的"提前抽象"）
`StorageService` 接口固定为：
```ts
interface StorageService {
  put(key: string, file: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): string;
  remove(key: string): Promise<void>;
}
```
- R2 bucket `MUST` 关闭公共访问，文件 URL 一律经受控 API；`MUST NOT` 返回绕过鉴权的公开对象 URL。
- MVP 通过 `STORAGE_DRIVER=local | r2` 切换实现。业务代码 `MUST` 只依赖接口，`MUST NOT` 直接 import R2 SDK。
- 未来接 B2 只新增一个实现类，`MUST NOT` 改业务代码。

### 12.2 上传规则
- 提交作业允许格式白名单：`doc` `docx` `pdf` `png` `jpg` `jpeg` `zip`。
- 单文件上限 **10MB**（`UPLOAD_MAX_SIZE` 可配），服务端 `MUST` 校验，`MUST NOT` 只信前端。
- 校验 `MUST` 同时检查扩展名与 mime type，任一不符即 400。
- 存储 key `MUST` 用 UUID 生成，`MUST NOT` 用用户上传的原始文件名做路径（防目录穿越）。
- 数据库保留 `attachments` 表记录 `key / original_name / size / mime / uploader_id`。

## 13. 作业领域规则

- 状态由时间派生，`MUST NOT` 定时任务改状态：
  - `now < startAt` → 未开始（不可提交）
  - `startAt ≤ now ≤ deadlineAt` → 可提交
  - `now > deadlineAt` → 已截止（提交返回 403）
- **截止判断以服务端时间为准**。前端倒计时仅为展示，`MUST NOT` 由前端决定能否提交。
- 提交 `MUST` 校验：当前用户是 `MEMBER` 或 `ALUMNI`（`VISITOR` 禁止查阅/提交作业）、作业处于可提交窗口、文件符合白名单与大小。
- 允许重复提交 `SHOULD` 覆盖旧提交（保留 `updated_at`），`MUST NOT` 允许删除已归档的提交。

## 14. Issue 领域规则

- 状态枚举固定三项：`OPEN`（未解决）、`ANSWERED`（已解答）、`ON_HOLD`（搁置）。
- 创建 issue 默认 `OPEN`（`VISITOR` 仅可回复、不可创建），`ADMIN` / `ALUMNI` / `WHEEL` 可变更状态。
- `MUST NOT` 实现积分：答对不加分，只有状态流转。
- 未解决 → 已解答时记录 `answeredBy` 与 `answeredAt`。

## 15. Redis 职责（MVP 仅两项）

1. 登录失败限流（§11.3）
2. `refresh_token` 白名单 / 黑名单（§11.2）

`MUST NOT` 在 MVP 引入 BullMQ 或其它队列。key 命名统一 `{业务}:{标识}:{id}`，全部设置 TTL。

## 16. 安全红线

以下任一条违反即视为必须打回的缺陷：

1. 明文存储或日志输出密码、token、验证码。
2. 越权：service 层缺 `resource.authorId === currentUser.id` 校验。
3. `sql` 模板字面量里拼接用户输入。
4. 未做白名单的文件上传，或未校验大小的上传。
5. 把 `DB_URL`、密钥等写进代码或提交 `.env`。
6. 直接返回 DB 实体（泄露私有字段）。
7. 分页无上限（可被拉全表）。

## 17. 测试

- 每个 service 至少覆盖：**1 条正常路径** + **1 条权限/边界失败路径**。
- 鉴权相关（`JwtAuthGuard` / `RolesGuard`）`MUST` 有 e2e 冒烟测试。
- `SHOULD NOT` 追求覆盖率数字，`MUST NOT` 为凑覆盖率写无断言的测试。

## 18. Git 与提交

- Conventional Commits：`feat:` `fix:` `refactor:` `chore:` `docs:` `test:`，scope 用模块名，如 `feat(auth): 支持手机号登录`。
- 一个 PR 只做一件事；顺手重构 `MUST` 单独开 PR。
- `MUST NOT` force push `main`；`MUST NOT` 直接提交到 `main`（走 PR）。
- `.env` `MUST NOT` 入库；新增环境变量 `MUST` 同步更新 `.env.example`。

## 19. 常用命令

```bash
pnpm install
pnpm start:dev          # 本地开发（watch）
pnpm build              # nest build
pnpm lint
pnpm test               # 单测
pnpm test:e2e           # e2e
pnpm db:generate        # drizzle-kit generate -> src/migrations
pnpm db:migrate         # drizzle-kit migrate（部署 job / 本地手动）
```

## 20. 提交前自检清单

- [ ] 我改动的每个接口都过了权限校验，且是 service 层拦的，不是前端按钮隐藏
- [ ] 没有 `sql` 拼接用户输入，没有 `as any` 绕过类型
- [ ] 返回体没有泄露 `password_hash` / `email` / `phone`
- [ ] 改 schema 了 → 有对应迁移文件，且已人工 review 生成的 SQL
- [ ] 新增环境变量 → 已加进 `.env.example`
- [ ] 没有实现 §2 里标 🔴/❌ 的后续功能
- [ ] 新增 service 方法配了正常 + 失败两条测试

## 21. 待定项（不要自行决定，先问）

- 文章是否支持富文本 / Markdown 渲染（影响存储与 XSS 过滤）
- 作业是否需要"评分"字段（当前只做提交，不做评分）
- 邮件通知的发送时机与模板（后续阶段）
- ~~软删除 vs 硬删除策略（当前默认硬删除，封禁用 `status` 字段）~~ → **已拍板（2026-11-11）**：内容类（articles / announcements / resources / issue_replies）的业务 DELETE = 软删除（`deleted_at`），后台回收站可恢复（真回滚）；用户剔除仍为硬删 FK 级联；封禁继续用 `status` 字段。
- 前端仓库最终位置（当前前端约定见 `web/AGENTS.md`，若改为 monorepo 需 `git mv`）
