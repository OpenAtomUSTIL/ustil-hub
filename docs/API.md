# USTIL Hub 接口文档

> 依据 `src/modules/**` 控制器与 service 层权限校验整理，标注的权限即服务端实际强制执行的规则。
> 更新代码后 `MUST` 同步更新本文档。

## 通用约定

- **路由前缀**：所有接口以 `/api/v1` 开头。
- **认证方式**：httpOnly Cookie 双 token，前端无需手动携带 Header。
  | Cookie | 内容 | TTL | Path |
  |---|---|---|---|
  | `access_token` | JWT（`sub` = userId，`role`） | 15 分钟 | `/` |
  | `refresh_token` | JWT（`sub` + `jti`），刷新时轮换 | 7 天 | `/api/v1/auth` |
- **成功响应**：直接返回业务数据体（对象或数组），不包裹 `code/message/data`。
- **失败响应**（全局 `AllExceptionsFilter` 统一产出）：
  ```json
  {
    "statusCode": 403,
    "error": "Forbidden",
    "message": "无权访问该资源",
    "path": "/api/v1/articles/1",
    "timestamp": "2026-11-09T03:04:10.212Z"
  }
  ```
  - `message` 可为 `string` 或 `string[]`（校验错误）。
- **错误码语义**：
  | 状态码 | 含义 |
  |---|---|
  | 400 | 参数校验失败 / 文件不合规 |
  | 401 | 未登录或登录已过期 |
  | 403 | 已登录但无权限 / 被封禁 / 超出提交时间 |
  | 404 | 资源不存在或不可见 |
  | 409 | 状态冲突（如邮箱/手机号已注册） |
  | 429 | 登录失败次数过多，临时锁定 |
- **分页**：请求 `?page=1&pageSize=20`（`pageSize` 上限 100，超出直接 400 拒绝）；响应：
  ```json
  { "items": [], "total": 0, "page": 1, "pageSize": 20 }
  ```
- **时间**：一律 ISO 8601 UTC 字符串（`2026-11-09T03:04:10.212Z`）。
- **校验**：全局 `ValidationPipe` 开启 `whitelist + forbidNonWhitelisted`，请求体中出现未声明字段直接 400。

### 角色（RBAC）

| 枚举 | 中文 | 定位 |
|---|---|---|
| `VISITOR` | 临时访客 | 非邀请码注册；7 天内未转正自动删除；可读文章、参与讨论（仅回复），禁止查阅作业 |
| `MEMBER` | 学习成员 | 邀请码注册即入；发起讨论、提交作业；注册满 4 年自动升 `ALUMNI` |
| `ALUMNI` | 校友 | 历届最终学员：发布文章、布置作业、答疑，无管理权 |
| `WHEEL` | 负责人 | 生成/作废邀请码、剔除学员、提前提拔、变更 issue 状态 |
| `ADMIN` | 管理员 | 公共账号：任免 `WHEEL`、封禁、删他人内容、最高权限 |

### 权限标注图例

| 标注 | 含义 |
|---|---|
| 🌐 公开 | 无需登录（`@Public()`） |
| 🔐 登录 | 任意已登录角色可访问 |
| 🛡️ 角色限制 | 需指定角色（`@Roles()`） |
| 👤 所有者 | 需登录 + service 层校验资源归属（作者/发布者本人，ADMIN 视接口而定） |
| ⏰ 状态限制 | 额外受业务状态/时间窗口约束 |

### 公共数据结构

```ts
// 用户公开资料（出现在 author / publisher / submitter 等字段）
UserPublic = {
  id: string;          // uuid v7
  nickname: string;
  avatarUrl: string | null;
  role: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL' | 'ADMIN';
}

// 本人资料（仅本人接口返回，含私有字段）
UserSelf = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL' | 'ADMIN';
  status: 'ACTIVE' | 'BANNED';
  email?: string;      // 绑定才返回
  phone?: string;      // 绑定才返回
  createdAt: string;
  updatedAt: string;
}

// 附件
AttachmentView = {
  id: string;
  key: string;          // 存储 key（UUID + 扩展名）
  originalName: string;
  size: number;         // 字节
  mime: string;
  url: string;
}
```

---

## 1. 认证 `/api/v1/auth`

### 1.1 注册 `POST /api/v1/auth/register`

- 权限：🌐 公开
- 请求体：
  ```json
  {
    "identifier": "user@example.com 或 13800138000",  // 邮箱或手机号，二选一
    "password": "至少 8 位，最长 128 位",
    "nickname": "昵称，最长 50 字符",
    "inviteCode": "可选，邀请码"
  }
  ```
- 角色规则：携带有效邀请码（`ACTIVE`、未用尽、未过期）→ 注册为 `MEMBER` 并核销一人名额；无邀请码 → 注册为 `VISITOR`（7 天内未持码转正将被自动删除）
- 成功：`201`，返回 `UserSelf`，并写入 `access_token` / `refresh_token` Cookie
- 失败：`409` 邮箱/手机号已被注册，或邀请码无效/已作废/已过期/已被用尽（`message` 区分）；`400` 参数非法

### 1.2 登录 `POST /api/v1/auth/login`

- 权限：🌐 公开
- 请求体：
  ```json
  { "identifier": "邮箱或手机号", "password": "密码" }
  ```
- 成功：`201`，返回 `UserSelf`，写入双 token Cookie
- 失败：
  - `401` 统一提示"账号或密码错误"（不区分用户不存在/密码错误）
  - `429` 同一账号 + IP 15 分钟内失败 5 次，锁定 15 分钟

### 1.3 刷新令牌 `POST /api/v1/auth/refresh`

- 权限：🌐 公开（依赖 `refresh_token` Cookie）
- 说明：轮换 token —— 旧 `jti` 立即作废并签发新对；旧 `jti` 复用视为窃取，清除该用户全部 refresh 并强制重登
- 成功：`201`，返回 `UserSelf`，写入新双 token Cookie
- 失败：`401` refresh 缺失/无效/已作废

### 1.4 登出 `POST /api/v1/auth/logout`

- 权限：🌐 公开
- 成功：`204`，清除双 token Cookie 并作废 refresh

### 1.5 修改密码 `POST /api/v1/auth/password`

- 权限：🔐 登录
- 请求体：
  ```json
  { "currentPassword": "当前密码", "newPassword": "新密码（8~128 位）" }
  ```
- 成功：`204`；修改后清除该用户全部 refresh（其它端需重新登录）
- 失败：`400` 当前密码错误

### 1.6 获取当前用户 `GET /api/v1/auth/me`

- 权限：🔐 登录
- 成功：`200`，返回 `UserSelf`

### 1.7 持码转正 `POST /api/v1/auth/invite-code`

- 权限：👤 仅 `VISITOR`（其他角色 403）
- 请求体：`{ "inviteCode": "邀请码" }`
- 说明：核销一人名额，`VISITOR` → `MEMBER`，旧 token 全部作废并换发双 token Cookie
- 成功：`201`，返回 `UserSelf`，写入新双 token Cookie
- 失败：`409` 邀请码无效/已作废/已过期/已被用尽；`403` 非 `VISITOR`

---

## 2. 用户 `/api/v1/users`

### 2.1 修改本人资料 `PATCH /api/v1/users/me`

- 权限：🔐 登录（仅本人）
- 请求体（字段均可选）：
  ```json
  { "nickname": "新昵称（≤50 字符）", "avatarUrl": "头像地址（≤1024 字符）" }
  ```
- 成功：`200`，返回 `UserSelf`

### 2.2 更换绑定邮箱/手机号 `PUT /api/v1/users/me/identifier`

- 权限：🔐 登录（仅本人）
- 请求体：
  ```json
  { "type": "email | phone", "value": "新邮箱或手机号", "password": "当前密码" }
  ```
- 说明：一个账号只绑定一个邮箱**或**一个手机号；更换需校验当前密码
- 成功：`200`，返回 `UserSelf`
- 失败：`400` 密码错误/格式非法；`409` 已被其它账号绑定

### 2.3 上传头像 `POST /api/v1/users/me/avatar`

- 权限：🔐 登录（仅本人）
- 请求体：`multipart/form-data`，字段 `file`
- 限制：格式白名单 `doc docx pdf png jpg jpeg zip`（扩展名 + mime 双校验），单文件 ≤ 10MB
- 成功：`201`，返回 `UserSelf`
- 失败：`400` 格式或大小不合规

### 2.4 封禁账号 `POST /api/v1/users/:id/ban`

- 权限：🛡️ 仅 `ADMIN`
- 成功：`201`，返回 `{ "id": string, "status": "BANNED" }`
- 说明：封禁后该用户所有已登录会话直接 403，refresh 全部清除

### 2.5 解封账号 `POST /api/v1/users/:id/unban`

- 权限：🛡️ 仅 `ADMIN`
- 成功：`201`，返回 `{ "id": string, "status": "ACTIVE" }`

### 2.6 查看他人公开资料 `GET /api/v1/users/:id`

- 权限：🔐 登录
- 成功：`200`，返回 `UserPublic`（仅昵称/头像/角色；**任何人**不可查看他人邮箱、手机号）

---

## 3. 文章 `/api/v1/articles`

### 3.1 文章列表 `GET /api/v1/articles`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`keyword`（可选，标题模糊搜索，≤100 字符）
- 成功：`200`，返回 `Page<ArticleListItem>`
  ```ts
  ArticleListItem = {
    id, title, excerpt, author: UserPublic,
    createdAt, updatedAt
  }
  ```

### 3.2 文章详情 `GET /api/v1/articles/:id`

- 权限：🔐 登录
- 成功：`200`，返回 `ArticleDetail`（`ArticleListItem` 去掉 `excerpt` 加 `content`）

### 3.3 创建文章 `POST /api/v1/articles`

- 权限：🛡️ 仅 `ADMIN`、`ALUMNI`、`WHEEL`
- 请求体：
  ```json
  { "title": "标题（≤200 字符）", "content": "正文" }
  ```
- 成功：`201`，返回 `ArticleDetail`（作者为当前用户）

### 3.4 编辑文章 `PATCH /api/v1/articles/:id`

- 权限：👤 仅作者本人（**ADMIN 也不能编辑他人文章**）
- 请求体（字段可选）：`{ "title"?: string, "content"?: string }`
- 成功：`200`，返回 `ArticleDetail`
- 失败：`403` 非作者；`404` 文章不存在

### 3.5 删除文章 `DELETE /api/v1/articles/:id`

- 权限：👤 作者本人，或 🛡️ `ADMIN` 删除任意文章
- 成功：`204`
- 失败：`403` 非作者且非管理员

---

## 4. 作业 `/api/v1/assignments`

作业状态由时间派生（服务端判定，前端倒计时仅展示）：
| 状态 | 条件 | 说明 |
|---|---|---|
| `NOT_STARTED` | `now < startAt` | 不可提交 |
| `OPEN` | `startAt ≤ now ≤ deadlineAt` | 可提交 |
| `CLOSED` | `now > deadlineAt` | 已截止，提交返回 403 |

### 4.1 作业列表 `GET /api/v1/assignments`

- 权限：🔐 登录（`VISITOR` 禁止查阅，403）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<AssignmentItem>`
  ```ts
  AssignmentItem = {
    id, title, description,
    startAt, deadlineAt,
    state: 'NOT_STARTED' | 'OPEN' | 'CLOSED',
    canSubmit: boolean,           // 仅 MEMBER / ALUMNI 且状态为 OPEN 时为 true
    publisher: UserPublic,
    mySubmission: SubmissionView | null,   // 本人提交记录（无则 null）
    createdAt, updatedAt
  }
  ```

### 4.2 作业详情 `GET /api/v1/assignments/:id`

- 权限：🔐 登录（`VISITOR` 禁止查阅，403）
- 成功：`200`，返回 `AssignmentItem`

### 4.3 发布作业 `POST /api/v1/assignments`

- 权限：🛡️ 仅 `ADMIN`、`ALUMNI`、`WHEEL`
- 请求体：
  ```json
  {
    "title": "标题（≤200 字符）",
    "description": "描述",
    "startAt": "2026-11-01T00:00:00.000Z",
    "deadlineAt": "2026-11-30T23:59:59.000Z"
  }
  ```
- 成功：`201`，返回 `AssignmentItem`

### 4.4 编辑作业 `PATCH /api/v1/assignments/:id`

- 权限：👤 仅发布者本人，或 🛡️ `ADMIN`
- 请求体（字段可选）：`{ "title"?, "description"?, "startAt"?, "deadlineAt"? }`
- 成功：`200`，返回 `AssignmentItem`
- 失败：`403` 非发布者且非管理员

### 4.5 提交作业 `POST /api/v1/assignments/:id/submissions`

- 权限：👤 仅 `MEMBER` / `ALUMNI` + ⏰ 处于可提交窗口（`OPEN`）
- 请求体：`multipart/form-data`
  | 字段 | 类型 | 必填 | 说明 |
  |---|---|---|---|
  | `file` | 文件 | 是 | 白名单 `doc docx pdf png jpg jpeg zip`，≤10MB |
  | `note` | string | 否 | 备注，≤1000 字符 |
- 说明：重复提交覆盖旧提交（保留 `updated_at`）；截止判断以服务端时间为准
- 成功：`201`，返回 `SubmissionView`
  ```ts
  SubmissionView = {
    id, assignmentId,
    submitter: UserPublic,
    note: string | null,
    attachment: AttachmentView,
    createdAt, updatedAt
  }
  ```
- 失败：`403` 非 `MEMBER`/`ALUMNI` 或不在提交窗口；`400` 文件格式或大小不合规

### 4.6 查看作业提交列表 `GET /api/v1/assignments/:id/submissions`

- 权限：👤 仅发布者本人，或 🛡️ `ADMIN`（提交者本人可经 `mySubmission` 字段看到自己的提交）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<SubmissionView>`
- 失败：`403` 非发布者且非管理员

---

## 5. 讨论 Issue `/api/v1/issues`

状态枚举固定三项：`OPEN`（未解决）→ `ANSWERED`（已解答）/ `ON_HOLD`（搁置）。
创建默认 `OPEN`；流转到 `ANSWERED` 时记录 `answeredBy` / `answeredAt`。

### 5.1 Issue 列表 `GET /api/v1/issues`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`status`（可选，`OPEN | ANSWERED | ON_HOLD`）、`keyword`（可选，标题模糊搜索）
- 成功：`200`，返回 `Page<IssueListItem>`
  ```ts
  IssueListItem = {
    id, title,
    status: 'OPEN' | 'ANSWERED' | 'ON_HOLD',
    author: UserPublic,
    replyCount: number,
    answeredBy: UserPublic | null,
    answeredAt: string | null,
    createdAt, updatedAt
  }
  ```

### 5.2 Issue 详情 `GET /api/v1/issues/:id`

- 权限：🔐 登录
- 成功：`200`，返回 `IssueDetail`（`IssueListItem` + `content` + `replies`）
  ```ts
  ReplyView = { id, content, author: UserPublic, createdAt }
  ```

### 5.3 创建 Issue `POST /api/v1/issues`

- 权限：🔐 登录（`VISITOR` 仅可回复、不可创建，403）
- 请求体：`{ "title": "标题（≤200 字符）", "content": "内容" }`
- 成功：`201`，返回 `IssueDetail`（状态 `OPEN`）

### 5.4 回复 Issue `POST /api/v1/issues/:id/replies`

- 权限：🔐 登录（所有角色）
- 请求体：`{ "content": "回复内容" }`
- 成功：`201`，返回 `ReplyView`

### 5.5 变更 Issue 状态 `PATCH /api/v1/issues/:id/status`

- 权限：🛡️ 仅 `ADMIN`、`ALUMNI`、`WHEEL`
- 请求体：`{ "status": "OPEN | ANSWERED | ON_HOLD" }`
- 成功：`200`，返回 `IssueDetail`

---

## 6. 文件 `/api/v1/storage`

### 6.1 读取文件 `GET /api/v1/storage/files/:key`

- 权限：🔐 登录
- 路径参数：`key` = 存储 key（UUID + 扩展名，如 `0f8fad5b-d9cb-469f-a165-70867728950e.pdf`）；非法 key 格式返回 404
- 成功：`200`，返回文件二进制（`Content-Type` 按扩展名推断，`Content-Disposition: inline`）
- 说明：上传接口（头像、作业提交）返回的 `AttachmentView.url` 即指向该接口

---

## 7. 管理后台 `/api/v1/admin`（`WHEEL` / `ADMIN`）

### 7.1 批量生成邀请码 `POST /api/v1/admin/invite-codes`

- 权限：🛡️ `WHEEL` / `ADMIN`
- 请求体：
  ```json
  { "count": 5, "maxUses": 10, "expiresAt": "2027-01-01T00:00:00.000Z" }
  ```
  - `count` 生成码个数（1-50，默认 1）；`maxUses` 每码可用人数（1-100，默认 1）；`expiresAt` 可选过期时间（ISO 8601 UTC）
- 成功：`201`，返回 `{ "items": [InviteCode] }`

### 7.2 邀请码列表 `GET /api/v1/admin/invite-codes?status=&page=&pageSize=`

- 权限：🛡️ `WHEEL` / `ADMIN`
- `status` 可选：`ACTIVE` / `REVOKED`
- 成功：`200`，返回分页 `{ items, total, page, pageSize }`

### 7.3 作废邀请码 `POST /api/v1/admin/invite-codes/:id/revoke`

- 权限：🛡️ `WHEEL` / `ADMIN`
- 成功：`204`；失败：`404` 邀请码不存在

```ts
InviteCode = {
  id: string;          // uuid v7
  code: string;        // ≥8 位随机码
  status: 'ACTIVE' | 'REVOKED';
  maxUses: number;     // 单码可用人数上限
  usedCount: number;   // 已核销人数
  remaining: number;   // 剩余名额（maxUses - usedCount）
  expiresAt: string | null;
  createdAt: string;
}
```

### 7.4 用户列表 `GET /api/v1/admin/users?keyword=&role=&status=&page=&pageSize=`

- 权限：🛡️ `WHEEL` / `ADMIN`
- `keyword` 匹配昵称/邮箱/手机号；`role`、`status` 可选筛选
- 成功：`200`，返回分页 `{ items, total, page, pageSize }`
  ```ts
  AdminUser = {
    id: string;
    nickname: string;
    contact: string | null;   // 脱敏联系方式（a***@example.com / 138****8000）
    role: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL' | 'ADMIN';
    status: 'ACTIVE' | 'BANNED';
    createdAt: string;
  }
  ```

### 7.5 修改用户角色 `PATCH /api/v1/admin/users/:id/role`

- 权限：🛡️ 仅 `ADMIN`
- 请求体：`{ "role": "VISITOR | MEMBER | ALUMNI | WHEEL" }`（`MUST NOT` 传 `ADMIN`，400）
- 成功：`200`，返回 `AdminUser`，并吊销该用户全部 refresh（强制重登）
- 失败：`403` 目标是 `ADMIN` 账号；`404` 用户不存在

### 7.6 提前提拔 `POST /api/v1/admin/users/:id/promote`

- 权限：🛡️ `WHEEL` / `ADMIN`
- 说明：`MEMBER` → `ALUMNI`，并强制重登
- 成功：`201`，返回 `AdminUser`
- 失败：`403` 目标不是 `MEMBER`；`404` 用户不存在

### 7.7 剔除学员 `DELETE /api/v1/admin/users/:id`

- 权限：🛡️ `WHEEL` / `ADMIN`
- 说明：硬删 `MEMBER` / `VISITOR` 账号（级联其讨论/回复/作业提交/附件记录），并吊销其 refresh
- 成功：`204`
- 失败：`403` 目标是 `ALUMNI` 及以上；`404` 用户不存在

### 7.8 概览统计 `GET /api/v1/admin/stats`

- 权限：🛡️ `WHEEL` / `ADMIN`
- 成功：`200`
  ```json
  {
    "users": { "VISITOR": 0, "MEMBER": 0, "ALUMNI": 0, "WHEEL": 0, "ADMIN": 1 },
    "activeInviteCodes": 0,
    "visitorPendingCleanup": 0
  }
  ```
  - `visitorPendingCleanup`：创建已满 7 天仍为 `VISITOR`（待定时清理）的人数

---

## 附录：权限矩阵（速查）

| 能力 | VISITOR | MEMBER | ALUMNI | WHEEL | ADMIN |
|---|:---:|:---:|:---:|:---:|:---:|
| 注册 / 登录 / 刷新 / 登出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 改本人密码 / 资料 / 绑定 / 头像 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看他人公开资料 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看他人邮箱、手机号 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 浏览文章 / issue、回复 issue | ✅ | ✅ | ✅ | ✅ | ✅ |
| 创建 issue / 变更 issue 状态 | ❌ | ✅ / ❌ | ✅ | ✅ | ✅ |
| 浏览作业 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 创建文章 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 编辑文章 | ❌ | ❌ | 仅本人 | 仅本人 | 任意 |
| 删除文章 | ❌ | ❌ | 仅本人 | 仅本人 | 任意 |
| 发布 / 编辑作业 | ❌ | ❌ | ✅ / 仅本人 | ✅ / 仅本人 | ✅ / 任意 |
| 提交作业 | ❌ | ✅（仅 OPEN 窗口） | ✅（仅 OPEN 窗口） | ❌ | ❌ |
| 查看作业提交列表 | ❌ | ❌ | 仅本人发布的 | 仅本人发布的 | ✅ |
| 生成 / 作废邀请码 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 剔除学员（删 MEMBER/VISITOR） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 提前提拔 MEMBER→ALUMNI | ❌ | ❌ | ❌ | ✅ | ✅ |
| 改角色 / 封禁 / 解封账号 | ❌ | ❌ | ❌ | ❌ | ✅ |
