# USTIL Hub 接口文档

> 依据 `src/modules/**` 控制器与 service 层权限校验整理，标注的权限即服务端实际强制执行的规则。
> 契约细节以 `AGENTS.md` §4 为准；更新代码后 `MUST` 同步更新本文档。

## 通用约定

- **路由前缀**：所有接口以 `/api/v1` 开头。
- **认证方式**：httpOnly Cookie 双 token，前端无需手动携带 Header。
  | Cookie | 内容 | TTL | Path |
  |---|---|---|---|
  | `access_token` | JWT（`sub` = userId，`role`） | 15 分钟 | `/` |
  | `refresh_token` | JWT（`sub` + `jti`），刷新时轮换 | 7 天 | `/api/v1/auth` |
- **会话失效**：改密码 / 登出 / 封禁 / 角色变更 → 清空该用户全部 refresh 并递增 `sessionVersion`，旧 access/refresh 同时失效（后续请求 401）。
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
  | 400 | 参数校验失败 / 文件不合规 / 当前密码错误 |
  | 401 | 未登录或登录已过期 |
  | 403 | 已登录但无权限 / 被封禁 / 超出提交时间 / `VISITOR` 访问作业 |
  | 404 | 资源不存在或不可见 |
  | 409 | 状态冲突（标识被占用、邀请码无效/作废/过期/用尽） |
  | 429 | 登录失败次数过多，临时锁定 |
- **分页**：请求 `?page=1&pageSize=20`（`pageSize` 上限 100，超出直接 400 拒绝）；响应：
  ```json
  { "items": [], "total": 0, "page": 1, "pageSize": 20 }
  ```
- **时间**：一律 ISO 8601 UTC 字符串（`2026-11-09T03:04:10.212Z`）。
- **校验**：全局 `ValidationPipe` 开启 `whitelist + forbidNonWhitelisted`，请求体中出现未声明字段直接 400。
- **标题与昵称**：创建、更新时去除首尾空白后校验；纯空白返回 400，标题最长 200 字符、昵称最长 50 字符。
- **slug 寻址（去 id 化）**：文章 / 作业 / 公告 / 资源 / Issue 创建时由标题生成唯一 slug（URL 不暴露裸 id）。
  **读接口**（详情类 `GET .../:id`）的 `:id` 可传 **uuid 或 slug**（uuid 优先匹配）；**写接口**（编辑 / 删除 / 审核 / 状态变更 / 回复 / 提交）仅接受 uuid，传 slug 返回 400。
  用户接口 `:id` 可传 **uuid 或 username**（`POST :id/ban`、`POST :id/unban` 除外，仅 uuid）。
- **标签**：`tags` 可省略，更新时 `[]` 表示清空；显式 `null` 返回 400。
- **公告布尔值**：`pinned`、`notify` 可省略，必须是布尔值；`null` 或字符串 `"false"` 返回 400。
- **作业输入时间**：`startAt`、`deadlineAt` 必须是带 `Z` 的 ISO 8601 UTC 字符串（秒必填，毫秒可选、最多 3 位）；数字时间戳、无时区时间及无效日历日期返回 400。
- **资源地址**：创建、更新均只允许带协议的 HTTP / HTTPS 链接，FTP 等其他协议返回 400。
- **文件上传**（头像、作业提交共用规则）：扩展名 + mime 双校验，白名单 `doc docx pdf png jpg jpeg zip`，单文件 ≤ 10MB（`UPLOAD_MAX_SIZE` 可配）。

### 角色（RBAC，五级）

| 枚举 | 中文 | 定位 |
|---|---|---|
| `VISITOR` | 临时访客 | 非邀请码注册；7 天内未持码转正自动删号；可读内容、讨论仅回复；**禁止查阅/提交作业** |
| `MEMBER` | 学习成员 | 持邀请码注册；发起讨论、提交作业；注册满 4 年自动升 `ALUMNI`（或被提前提拔） |
| `ALUMNI` | 校友 | 发文章、布置作业、答疑、参与作业；无管理权 |
| `WHEEL` | 负责人 | 邀请码管理、剔除学员、提前提拔、发布内容、变更 issue 状态 |
| `ADMIN` | 管理员 | 任免 `WHEEL`、封禁、删他人内容、最高权限；`ADMIN` 账号本身不可被改角色/删除/封禁 |

### 权限标注图例

| 标注 | 含义 |
|---|---|
| 🌐 公开 | 无需登录（`@Public()`） |
| 🔐 登录 | 任意已登录角色可访问 |
| 🛡️ 角色限制 | 需指定角色（`@Roles()`） |
| 👤 所有者 | 需登录 + service 层校验资源归属（作者/创建者/发布者本人，`ADMIN` 视接口而定） |
| ⏰ 状态限制 | 额外受业务状态/时间窗口约束 |

### 公共数据结构

```ts
// 用户公开资料（author / creator / submitter 等字段）
UserPublic = {
  id: string;          // uuid v7
  username: string;    // 主页 handle（2-32 位字母/数字/-/_，全站唯一，小写）
  nickname: string;
  avatarUrl: string | null;
  role: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL' | 'ADMIN';
}

// 本人资料（仅本人接口返回，含私有字段）
UserSelf = {
  id: string;
  username: string;
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
  url: string;          // 指向 /api/v1/storage/files/:key
}

// 标签
TagView = { id: string; name: string; count: number }
```

---

## 1. 认证 `/api/v1/auth`

### 1.1 注册 `POST /api/v1/auth/register`

- 权限：🌐 公开
- 请求体：
  ```json
  {
    "identifier": "user@example.com 或 13800138000",  // 邮箱或手机号，二选一
    "password": "8~128 位",
    "nickname": "昵称，≤50 字符",
    "inviteCode": "可选；有效则注册为 MEMBER 并核销名额"
  }
  ```
- 成功：`201`，返回 `UserSelf`，写入 `access_token` / `refresh_token` Cookie
  - 有有效邀请码 → `MEMBER`；无码 → `VISITOR`（7 天内可持码经 1.2 转正）
- 失败：`409` 邮箱/手机号已注册；`409` 邀请码无效/已作废/已过期/已被用尽；`400` 参数非法

### 1.2 持码转正 `POST /api/v1/auth/invite-code`

- 权限：🔐 登录（**仅 `VISITOR`**，其他角色 403）
- 请求体：`{ "inviteCode": "邀请码" }`
- 成功：`201`，返回 `UserSelf`（角色变为 `MEMBER`），并**换发**新双 token Cookie
- 失败：`409` 邀请码无效/作废/过期/用尽；`403` 非 `VISITOR`

### 1.3 登录 `POST /api/v1/auth/login`

- 权限：🌐 公开
- 请求体：`{ "identifier": "邮箱或手机号", "password": "8~128 位" }`
- 成功：`201`，返回 `UserSelf`，写入双 token Cookie
- 失败：
  - `401` 统一提示"账号或密码错误"（不区分用户不存在/密码错误）
  - `429` 同一账号 + IP 15 分钟内失败 5 次，锁定 15 分钟
  - `403` 账号被封禁
- 登录日志：成功与失败均写入 `login_logs`（成功含 `userId`；失败 `userId` 为空，`failReason` 区分
  `用户不存在` / `密码错误` / `账号已封禁` / `登录尝试过于频繁`），只记录标识与结果，**不落密码**。

### 1.4 刷新令牌 `POST /api/v1/auth/refresh`

- 权限：🌐 公开（依赖 `refresh_token` Cookie）
- 说明：轮换 token —— 旧 `jti` 立即作废并签发新对；旧 `jti` 复用视为窃取，清除该用户全部 refresh 并强制重登
- 成功：`201`，返回 **`UserPublic`**（脱敏，仅 `id/username/nickname/avatarUrl/role`，**不含** `email`/`phone`），写入新双 token Cookie
  - 前端登录态恢复一律以 `GET /auth/me` 为 `UserSelf` 来源
- 失败：`401` refresh 缺失/无效/已作废

### 1.5 登出 `POST /api/v1/auth/logout`

- 权限：🌐 公开
- 成功：`204`，清除双 token Cookie 并作废 refresh；同时写入登录日志（`success: true`，含 `userId`）

### 1.6 修改密码 `POST /api/v1/auth/password`

- 权限：🔐 登录
- 请求体：`{ "currentPassword": "当前密码", "newPassword": "新密码（8~128 位）" }`
- 成功：`204`；清除该用户全部 refresh 并递增 `sessionVersion`（其它端需重新登录）
- 失败：`400` 当前密码错误

### 1.7 获取当前用户 `GET /api/v1/auth/me`

- 权限：🔐 登录
- 成功：`200`，返回 `UserSelf`

---

## 2. 用户 `/api/v1/users`

> `:id` 路径参数均可传 **uuid 或 username**（uuid 优先匹配）；仅 2.6 / 2.7 封禁类接口限定 uuid。

### 2.1 修改本人资料 `PATCH /api/v1/users/me`

- 权限：🔐 登录（仅本人）
- 请求体（字段均可选）：`{ "nickname"?: string（≤50）, "avatarUrl"?: string（≤1024） }`
- 成功：`200`，返回 `UserSelf`

### 2.2 更换绑定邮箱/手机号 `PUT /api/v1/users/me/identifier`

- 权限：🔐 登录（仅本人；`ADMIN` 账号初始化后不可换绑，403）
- 请求体：
  ```json
  { "type": "email | phone", "value": "新邮箱或手机号", "password": "当前密码" }
  ```
- 说明：一个账号只绑定一个邮箱**或**一个手机号；换绑时清空另一种标识
- 成功：`200`，返回 `UserSelf`
- 失败：`400` 当前密码错误/格式非法；`409` 已被其它账号绑定

### 2.3 修改主页用户名 `PUT /api/v1/users/me/username`

- 权限：🔐 登录（仅本人）
- 请求体：`{ "username": "2-32 位，仅字母/数字/-/_" }`
- 说明：自动 trim 并转小写；改名写入 `user_username_history` 历史记录；原名不再占用
- 成功：`200`，返回 `UserSelf`（传入与当前相同的名字直接成功返回）
- 失败：`400` 格式非法；`409` 已被占用

### 2.4 上传头像 `POST /api/v1/users/me/avatar`

- 权限：🔐 登录（仅本人）
- 请求体：`multipart/form-data`，字段 `file`（白名单 + ≤10MB）
- 成功：`201`，返回 `UserSelf`
- 失败：`400` 格式或大小不合规

### 2.5 编辑个人主页 `PUT /api/v1/users/me/profile-page`

- 权限：🔐 登录（仅本人）
- 请求体（字段均可选，传 `null` 清空对应字段）：
  ```json
  {
    "bio": "短简介，≤100 字符",
    "profileReadme": "个人介绍（长文），≤10000 字符",
    "pinnedItems": [ { "type": "ARTICLE | ISSUE | RESOURCE", "id": "uuid" } ]
  }
  ```
- 约束：`pinnedItems` ≤6 项、不得重复、目标必须存在且**属于本人**（否则 400）；省略表示不动，`[]` 清空
- 成功：`200`（空响应）
- 失败：`400` 超长/超量/重复/不属于本人；`404` 用户不存在

### 2.6 封禁账号 `POST /api/v1/users/:id/ban`

- 权限：🛡️ 仅 `ADMIN`（`ADMIN` 账号不可被封禁，403；仅 uuid 寻址）
- 成功：`201`，返回 `{ "id": string, "status": "BANNED" }`
- 说明：封禁立即吊销该用户全部 refresh 并递增 `sessionVersion`；之后请求直接 403

### 2.7 解封账号 `POST /api/v1/users/:id/unban`

- 权限：🛡️ 仅 `ADMIN`（仅 uuid 寻址）
- 成功：`201`，返回 `{ "id": string, "status": "ACTIVE" }`

### 2.8 查看他人公开资料 `GET /api/v1/users/:id`

- 权限：🔐 登录
- 成功：`200`，返回 `UserPublic`（`id/username/nickname/avatarUrl/role`；**任何人**不可查看他人邮箱、手机号）

### 2.9 个人主页 `GET /api/v1/users/:id/profile`

- 权限：🔐 登录（`VISITOR` 仅可访问**本人**主页，访问他人 403）
- 成功：`200`，返回 `UserProfileView`
  ```ts
  UserProfileView = {
    id, username, nickname, avatarUrl, role,
    bio: string | null,
    profileReadme: string | null,
    createdAt,
    stats: { articles, issues, replies, submissions },   // 聚合计数（软删不计）
    topTags: { name: string, count: number }[],          // 至多 10 项
    pinnedItems: { type, id, slug, title, url? }[],      // 仅保留仍存在且未软删的目标
    isSelf: boolean,
    isFollowing: boolean,
    followerCount: number, followingCount: number,
    email?: string, phone?: string                       // 仅 isSelf 时返回
  }
  ```

### 2.10 活跃热力图 `GET /api/v1/users/:id/activity`

- 权限：🔐 登录（`VISITOR` 仅本人）
- 说明：近一年（UTC 日）五类事件按日求和、按日期升序
- 成功：`200`，返回 `{ "days": [{ "date": "YYYY-MM-DD", "count": number }] }`

### 2.11 回复列表 `GET /api/v1/users/:id/replies`

- 权限：🔐 登录（`VISITOR` 仅本人）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<ProfileReplyView>`
  ```ts
  ProfileReplyView = {
    id, issueId, issueSlug, issueTitle,
    content, createdAt
  }
  ```

### 2.12 关注 `POST /api/v1/users/:id/follow`

- 权限：🔐 登录（`MEMBER` 及以上；`VISITOR` 403）
- 说明：幂等（重复关注仍成功）；不能关注自己（400）；目标须 `ACTIVE`（封禁/不存在 404）；
  首次关注向对方发送 `FOLLOW` 站内通知
- 成功：`201`，返回 `{ "following": true }`

### 2.13 取关 `DELETE /api/v1/users/:id/follow`

- 权限：🔐 登录（`MEMBER` 及以上；`VISITOR` 403）
- 说明：幂等（未关注也成功）
- 成功：`200`，返回 `{ "following": false }`

### 2.14 粉丝列表 `GET /api/v1/users/:id/followers`

- 权限：🔐 登录（`VISITOR` 仅本人）
- 查询参数：`page`、`pageSize`；排除封禁用户
- 成功：`200`，返回 `Page<FollowUserView>`
  ```ts
  FollowUserView = {
    id, username, nickname, avatarUrl, role,
    bio: string | null,
    isSelf: boolean,
    isFollowing: boolean   // 当前访问者是否已关注该用户
  }
  ```

### 2.15 关注列表 `GET /api/v1/users/:id/following`

- 权限与响应同 2.14。

### 2.16 社区数据徽章（JSON）`GET /api/v1/users/:username/stats-badge`

- 权限：🌐 公开（仅聚合计数，无私有字段；仅 **username** 寻址）
- 说明：shields.io endpoint 协议；`Cache-Control: public, max-age=300`
- 成功：`200`，返回徽章数组
  ```json
  [ { "schemaVersion": 1, "label": "文章", "message": "12", "color": "2575fc" } ]
  ```
  - 六枚：文章 / 讨论 / 回复 / 提交 / 近一年贡献 / 站内连击（`"N 天"`）

### 2.17 社区数据徽章（SVG）`GET /api/v1/users/:username/stats-badge.svg`

- 权限：🌐 公开（仅 **username** 寻址）
- 说明：站内自绘 SVG（shields.io 不可达时的备用），供 README `<img>` 引用；`Cache-Control: public, max-age=300`
- 成功：`200`，返回 `image/svg+xml`

### 2.18 贡献贪吃蛇 `GET /api/v1/users/:username/snake.svg`

- 权限：🌐 公开（仅 **username** 寻址）
- 查询参数：`theme`（`dark` | 其他值默认 `light`）
- 说明：定时任务预生成的动画 SVG（@platane/snk 同款）；`Cache-Control: public, max-age=3600`
- 成功：`200`，返回 `image/svg+xml`

---

---

## 3. 文章 `/api/v1/articles`

状态枚举：`PENDING`（待审）/ `PUBLISHED`（已发布）/ `REJECTED`（已拒绝）/ `HIDDEN`（已隐藏）。
- `MEMBER` 发文**先审后发**：创建即 `PENDING`；`ALUMNI`/`WHEEL`/`ADMIN` **先发后审**：创建即 `PUBLISHED`（可被隐藏）。
- 非 `PUBLISHED` 文章仅**作者**与 `WHEEL`/`ADMIN` 可见（他人访问详情 404）。
- 审核记录 `reviewedBy` / `reviewedAt` / `reviewNote`；拒绝/隐藏备注经 `ArticleDetail.reviewNote` 对作者可见。

**阅读时长**：文章列表与详情均返回 `readingMinutes`（正整数分钟），按当前完整正文估算：中文 300 字/分钟、其他文字 200 词/分钟，混合累计后向上取整，至少 1 分钟。链接地址、图片与 HTML 标签不计入，代码文字保留；该字段只读、不存库，编辑正文后自动重新计算。

### 3.1 文章列表 `GET /api/v1/articles`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`keyword`（≤100）、`authorId`（uuid）、`tag`（≤30）
- 成功：`200`，返回 `Page<ArticleListItem>`
  ```ts
  ArticleListItem = {
    id, slug, title, excerpt, tags: string[],
    status: 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN',
    author: UserPublic, createdAt, updatedAt
  }
  ```

- 可见性：默认仅返回 `PUBLISHED`。按 `authorId` 过滤时，只有作者本人或 `WHEEL` / `ADMIN` 可查看该作者的全部状态。

### 3.2 文章详情 `GET /api/v1/articles/:id`

- 权限：🔐 登录
- 路径参数：`id` = uuid 或 **slug**
- 成功：`200`，返回 `ArticleDetail`
  ```ts
  ArticleDetail = {
    id, slug, title, content, tags: string[],
    status, reviewNote: string | null,
    author: UserPublic, createdAt, updatedAt
  }
  ```

### 3.3 创建文章 `POST /api/v1/articles`

- 权限：🛡️ 仅 `MEMBER`、`ALUMNI`、`WHEEL`、`ADMIN`
- 请求体：
  ```json
  { "title": "≤200 字符", "content": "正文", "tags": ["标签", "..."] }
  ```
  - `tags` 可选：数组 ≤10 项，每项 ≤30 字符
- 说明：`MEMBER` 创建后进 `PENDING` 待审（3.7 审核通过后可见）；其余角色直接 `PUBLISHED`
- 成功：`201`，返回 `ArticleDetail`

### 3.4 编辑文章 `PATCH /api/v1/articles/:id`

- 权限：🛡️ `MEMBER`/`ALUMNI`/`WHEEL`/`ADMIN` + 👤 仅作者本人（**`ADMIN` 也不能编辑他人文章**；仅 uuid 寻址）
- 请求体（字段可选）：`{ "title"?, "content"?, "tags"? }`
- 成功：`200`，返回 `ArticleDetail`
- 失败：`403` 非作者/角色不足；`404` 文章不存在

- `MEMBER` 只能修改本人 `PENDING` / `REJECTED` 文章（已发布文章 403「已发布的文章需联系管理员修改」）；
  修改被拒文章的标题、正文或标签后重新进入 `PENDING`，并清空上次审核结果。

### 3.5 删除文章 `DELETE /api/v1/articles/:id`

- 权限：🛡️ `MEMBER`/`ALUMNI`/`WHEEL`/`ADMIN` + 👤 作者本人，或 🛡️ `ADMIN` 删除任意文章（仅 uuid 寻址）
- 成功：`204`（软删进回收站，可经 11.12 还原）
- 失败：`403` 非作者且非管理员；`MEMBER` 仅可删除本人 `PENDING` / `REJECTED` 文章

---

### 3.6 待审列表 `GET /api/v1/articles/pending`

- 权限：`WHEEL` / `ADMIN`。
- 查询：`page`（正整数，默认 1）、`pageSize`（1–100，默认 20）；非法值返回 400。
- 返回：`Page<ArticleListItem>`（全部 `PENDING`）。

### 3.7 文章审核 `POST /api/v1/articles/:id/review`

- 权限：🛡️ 仅 `WHEEL`、`ADMIN`（仅 uuid 寻址）
- 请求体：
  ```json
  { "action": "approve | reject | hide | unhide", "note": "可选，审核备注 ≤500 字符" }
  ```
- 状态机（不满足返回 `409`）：

  | action | 前置状态 | 结果状态 |
  |---|---|---|
  | `approve` | `PENDING` | `PUBLISHED` |
  | `reject` | `PENDING` | `REJECTED` |
  | `hide` | `PUBLISHED` | `HIDDEN` |
  | `unhide` | `HIDDEN` | `PUBLISHED` |

- 说明：记录 `reviewedBy` / `reviewedAt` / `reviewNote`
- 成功：`200`，返回 `ArticleDetail`
- 失败：`409` 状态不符（如「仅待审文章可通过」）；`404` 文章不存在

## 4. 作业 `/api/v1/assignments`

作业状态由时间派生（服务端判定，前端倒计时仅展示）：
| 状态 | 条件 | 说明 |
|---|---|---|
| `NOT_STARTED` | `now < startAt` | 不可提交 |
| `OPEN` | `startAt ≤ now ≤ deadlineAt` | 可提交 |
| `CLOSED` | `now > deadlineAt` | 已截止，提交返回 403 |

⚠️ **`VISITOR` 禁止查阅/提交作业**：4.1–4.5 对 `VISITOR` 一律 403。

### 4.1 作业列表 `GET /api/v1/assignments`

- 权限：🔐 登录（`VISITOR` 403）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<AssignmentItem>`
  ```ts
  AssignmentItem = {
    id, slug, title, description,
    startAt, deadlineAt,
    state: 'NOT_STARTED' | 'OPEN' | 'CLOSED',
    canSubmit: boolean,           // 仅 MEMBER/ALUMNI 且 state === 'OPEN' 时为 true
    publisher: UserPublic,
    mySubmission: SubmissionView | null,
    createdAt, updatedAt
  }
  SubmissionView = {
    id, assignmentId, submitter: UserPublic,
    note: string | null, attachment: AttachmentView,
    createdAt, updatedAt
  }
  ```

### 4.2 我的提交记录 `GET /api/v1/assignments/submissions/mine`

- 权限：🔐 登录（`VISITOR` 403）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<MySubmissionItem>`
  ```ts
  MySubmissionItem = {
    id, assignmentId, assignmentSlug, assignmentTitle,
    startAt, deadlineAt,
    state: 'NOT_STARTED' | 'OPEN' | 'CLOSED',
    note: string | null,
    attachment: { id: string; fileName: string } | null,
    createdAt, updatedAt
  }
  ```

### 4.3 作业详情 `GET /api/v1/assignments/:id`

- 权限：🔐 登录（`VISITOR` 403）
- 路径参数：`id` = uuid 或 **slug**
- 成功：`200`，返回 `AssignmentItem`

### 4.4 下载作业附件 `GET /api/v1/assignments/files/:attachmentId`

- 权限：🔐 登录（`VISITOR` 403）+ 👤 提交者本人 / 该作业发布者（`ALUMNI`/`WHEEL`）/ `ADMIN`
- 成功：`200`，返回文件流（`Content-Disposition: attachment`）
- 失败：`403` 无权；`404` 附件不存在

### 4.5 发布作业 `POST /api/v1/assignments`

- 权限：🛡️ 仅 `ADMIN`、`ALUMNI`、`WHEEL`
- 请求体：
  ```json
  {
    "title": "≤200 字符",
    "description": "描述",
    "startAt": "2026-11-01T00:00:00.000Z",
    "deadlineAt": "2026-11-30T23:59:59.000Z"
  }
  ```
- 成功：`201`，返回 `AssignmentItem`（同时向 `MEMBER`/`ALUMNI` 全体发站内通知）
- 失败：`400` 时间非法

### 4.6 编辑作业 `PATCH /api/v1/assignments/:id`

- 权限：🛡️ `ALUMNI`/`WHEEL`/`ADMIN` + 👤 仅发布者本人，或 🛡️ `ADMIN`
- 请求体（字段可选）：`{ "title"?, "description"?, "startAt"?, "deadlineAt"? }`
- 成功：`200`，返回 `AssignmentItem`
- 失败：`403` 非发布者且非管理员

### 4.7 提交作业 `POST /api/v1/assignments/:id/submissions`

- 权限：👤 仅 `MEMBER` / `ALUMNI` + ⏰ 处于可提交窗口（`OPEN`）
- 请求体：`multipart/form-data`
  | 字段 | 类型 | 必填 | 说明 |
  |---|---|---|---|
  | `file` | 文件 | 是 | 白名单 + ≤10MB |
  | `note` | string | 否 | 备注，≤1000 字符 |
- 说明：重复提交覆盖旧提交（保留 `updated_at`）；截止判断以服务端时间为准
- 成功：`201`，返回 `SubmissionView`
- 失败：`403` 角色不符（`VISITOR`/`WHEEL`/`ADMIN`）或不在提交窗口；`400` 文件不合规

### 4.8 作业提交列表 `GET /api/v1/assignments/:id/submissions`

- 权限：🛡️ `ALUMNI`/`WHEEL`/`ADMIN` + 👤 该作业发布者本人，或 🛡️ `ADMIN`（任意作业）
- 查询参数：`page`、`pageSize`
- 成功：`200`，返回 `Page<SubmissionView>`
- 失败：`403` 非发布者且非管理员

---

## 5. 讨论 Issue `/api/v1/issues`

状态枚举固定三项：`OPEN`（未解决）→ `ANSWERED`（已解答）/ `ON_HOLD`（搁置）。
创建默认 `OPEN`；流转到 `ANSWERED` 时记录 `answeredBy` / `answeredAt`。

### 5.1 Issue 列表 `GET /api/v1/issues`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`status`（`OPEN | ANSWERED | ON_HOLD`）、`keyword`（≤100）、`tag`（≤30）
- 成功：`200`，返回 `Page<IssueListItem>`
  ```ts
  IssueListItem = {
    id, slug, title, tags: string[],
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
- 路径参数：`id` = uuid 或 **slug**
- 成功：`200`，返回 `IssueDetail`（`IssueListItem` + `content` + `replies`）
  ```ts
  ReplyView = { id, content, author: UserPublic, createdAt }
  ```

### 5.3 创建 Issue `POST /api/v1/issues`

- 权限：🔐 登录（**`VISITOR` 403**，仅可回复不可发起）
- 请求体：`{ "title": "≤200 字符", "content": "内容", "tags"?: string[] }`
- 成功：`201`，返回 `IssueDetail`（状态 `OPEN`）

### 5.4 回复 Issue `POST /api/v1/issues/:id/replies`

- 权限：🔐 登录（**所有角色，含 `VISITOR`**）
- 请求体：`{ "content": "回复内容" }`
- 成功：`201`，返回 `ReplyView`

### 5.5 变更 Issue 状态 `PATCH /api/v1/issues/:id/status`

- 权限：🛡️ 仅 `ADMIN`、`ALUMNI`、`WHEEL`
- 请求体：`{ "status": "OPEN | ANSWERED | ON_HOLD" }`
- 成功：`200`，返回 `IssueDetail`

---

## 6. 公告 `/api/v1/announcements`

### 6.1 公告列表 `GET /api/v1/announcements`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`keyword`（≤100）
- 成功：`200`，返回 `Page<AnnouncementItem>`
  ```ts
  AnnouncementItem = {
    id, slug, title, content,
    pinned: boolean,
    authorId: string, authorName: string, authorUsername: string,
    createdAt, updatedAt
  }
  ```

### 6.2 公告详情 `GET /api/v1/announcements/:id`

- 权限：🔐 登录
- 路径参数：`id` = uuid 或 **slug**
- 成功：`200`，返回 `AnnouncementItem`

### 6.3 发布公告 `POST /api/v1/announcements`

- 权限：🛡️ 仅 `WHEEL`、`ADMIN`
- 请求体：
  ```json
  { "title": "≤200 字符", "content": "正文", "pinned": false, "notify": false }
  ```
  - `pinned` 可选，置顶；`notify` 可选，发布同时向全员发站内通知
- 成功：`201`，返回 `AnnouncementItem`

### 6.4 编辑公告 `PATCH /api/v1/announcements/:id`

- 权限：👤 作者本人或 🛡️ `ADMIN`
- 请求体（字段可选）：`{ "title"?, "content"?, "pinned"? }`
- 成功：`200`，返回 `AnnouncementItem`

### 6.5 删除公告 `DELETE /api/v1/announcements/:id`

- 权限：👤 作者本人或 🛡️ `ADMIN`
- 成功：`204`（软删进回收站，可经 11.12 还原）

---

## 7. 资源库 `/api/v1/resources`

外链资源，分类枚举：`GITHUB | EXAM | EBOOK | DOCUMENT | OTHER`。

### 7.1 资源列表 `GET /api/v1/resources`

- 权限：🔐 登录
- 查询参数：`page`、`pageSize`、`category`、`keyword`（≤100）、`tag`（≤30）
- 成功：`200`，返回 `Page<ResourceItem>`
  ```ts
  ResourceItem = {
    id, slug, title,
    description: string | null,
    url: string,
    category: 'GITHUB' | 'EXAM' | 'EBOOK' | 'DOCUMENT' | 'OTHER',
    tags: string[],
    creatorId: string, creatorName: string, creatorUsername: string,
    createdAt, updatedAt
  }
  ```

### 7.2 资源详情 `GET /api/v1/resources/:id`

- 权限：🔐 登录
- 路径参数：`id` = uuid 或 **slug**
- 成功：`200`，返回 `ResourceItem`

### 7.3 创建资源 `POST /api/v1/resources`

- 权限：🛡️ 仅 `WHEEL`、`ADMIN`
- 请求体：
  ```json
  {
    "title": "≤200 字符",
    "description": "可选，≤2000 字符",
    "url": "合法链接（含协议，≤2048）",
    "category": "GITHUB | EXAM | EBOOK | DOCUMENT | OTHER",
    "tags": ["≤10 项，每项 ≤30 字符"]
  }
  ```
- 成功：`201`，返回 `ResourceItem`

### 7.4 编辑资源 `PATCH /api/v1/resources/:id`

- 权限：👤 创建者本人或 🛡️ `ADMIN`
- 请求体（字段可选）：`{ "title"?, "description"?, "url"?, "category"?, "tags"? }`
- 成功：`200`，返回 `ResourceItem`

### 7.5 删除资源 `DELETE /api/v1/resources/:id`

- 权限：👤 创建者本人或 🛡️ `ADMIN`
- 成功：`204`（软删进回收站，可经 11.12 还原）

---

## 8. 标签 `/api/v1/tags`

### 8.1 标签列表 `GET /api/v1/tags`

- 权限：🔐 登录
- 说明：统一标签体系，覆盖 ARTICLE / ISSUE / RESOURCE
- 成功：`200`，返回 `TagView[]`（`{ id, name, count }`）

---

## 9. 通知 `/api/v1/notifications`

站内通知，类型枚举：`ANNOUNCEMENT | ASSIGNMENT | ISSUE_REPLY | ROLE | SYSTEM | FOLLOW`。
均只操作**本人**通知。

### 9.1 通知列表 `GET /api/v1/notifications`

- 权限：🔐 登录（仅本人）
- 查询参数：`page`、`pageSize`、`unreadOnly`（布尔）
- 成功：`200`，返回 `Page<NotificationItem>`
  ```ts
  NotificationItem = {
    id,
    type: 'ANNOUNCEMENT' | 'ASSIGNMENT' | 'ISSUE_REPLY' | 'ROLE' | 'SYSTEM' | 'FOLLOW',
    title,
    body: string | null,
    link: string | null,
    readAt: string | null,
    createdAt
  }
  ```

### 9.2 未读数 `GET /api/v1/notifications/unread-count`

- 权限：🔐 登录
- 成功：`200`，返回 `{ "count": number }`

### 9.3 标记单条已读 `PATCH /api/v1/notifications/:id/read`

- 权限：🔐 登录（仅本人）
- 成功：`204`

### 9.4 全部已读 `POST /api/v1/notifications/read-all`

- 权限：🔐 登录（仅本人）
- 成功：`204`

---

## 10. 文件 `/api/v1/storage`

### 10.1 读取文件 `GET /api/v1/storage/files/:key`

- 权限：🔐 登录
- 路径参数：`key` = 存储 key（UUID + 扩展名，如 `0f8fad5b-d9cb-469f-a165-70867728950e.pdf`）；非法 key 格式返回 404
- 成功：`200`，返回文件二进制（`Content-Type` 按扩展名推断，`Content-Disposition: inline`）
- 说明：对象存储 bucket 不开放公共访问，所有文件 URL 一律经本受控接口（`AttachmentView.url` 即指向这里）；作业附件下载请走 4.4（`attachment` 响应头）

---

## 11. 后台管理 `/api/v1/admin`

除注明外，全部要求 🛡️ `WHEEL` 或 `ADMIN`（class 级 `@Roles`）。

### 11.1 用户列表 `GET /api/v1/admin/users`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`keyword`（≤100）、`role`、`status`（`ACTIVE | BANNED`）
- 成功：`200`，返回 `AdminUserPage`（联系方式脱敏）
  ```ts
  AdminUserView = {
    id, nickname,
    contact: string | null,   // 邮箱/手机号脱敏展示
    role, status, createdAt
  }
  ```

### 11.2 修改用户角色 `PATCH /api/v1/admin/users/:id/role`

- 权限：🛡️ **仅 `ADMIN`**（`WHEEL` 403）
- 请求体：`{ "role": "VISITOR | MEMBER | ALUMNI | WHEEL" }`（**不能授予/变更为 `ADMIN`**，ADMIN 仅由种子脚本创建）
- 成功：`200`，返回 `AdminUserView`
- 失败：`403` 目标是 `ADMIN` 账号（不可修改）；操作同时递增目标 `sessionVersion` 强制重新登录

### 11.3 提前提拔 `POST /api/v1/admin/users/:id/promote`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：`MEMBER` → `ALUMNI`（仅 `MEMBER` 可提拔，其他角色 403）
- 成功：`201`，返回 `AdminUserView`

### 11.4 剔除学员 `DELETE /api/v1/admin/users/:id`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：硬删账号，级联删除其 issues/replies；**仅 `MEMBER` / `VISITOR` 可被剔除**，`ALUMNI` 及以上不可
- 成功：`204`
- 失败：`403` 目标角色不可剔除

### 11.5 生成邀请码 `POST /api/v1/admin/invite-codes`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 请求体：
  ```json
  {
    "count": 1,          // 生成个数 1~50，默认 1
    "maxUses": 1,        // 单码可用人数 1~100，默认 1
    "expiresAt": "可选，ISO 8601 UTC 字符串"
  }
  ```
- 成功：`201`，返回 `{ "items": InviteCodeView[] }`
  ```ts
  InviteCodeView = {
    id, code,
    status: 'ACTIVE' | 'REVOKED',
    maxUses, usedCount, remaining,
    expiresAt: string | null,
    createdAt
  }
  ```

### 11.6 邀请码列表 `GET /api/v1/admin/invite-codes`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`status`（`ACTIVE | REVOKED`）
- 成功：`200`，返回 `InviteCodePage`（`{ items: InviteCodeView[], total, page, pageSize }`）

### 11.7 作废邀请码 `POST /api/v1/admin/invite-codes/:id/revoke`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 成功：`204`

### 11.8 统计概览 `GET /api/v1/admin/stats`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 成功：`200`
  ```json
  {
    "users": { "VISITOR": 0, "MEMBER": 0, "ALUMNI": 0, "WHEEL": 0, "ADMIN": 0 },
    "activeInviteCodes": 0,
    "visitorPendingCleanup": 0
  }
  ```
  - `visitorPendingCleanup`：注册已满 7 天仍为 `VISITOR` 的待清理账号数（每日 03:00 定时清理）

### 11.9 文件列表 `GET /api/v1/admin/files`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`kind`（`ATTACHMENT | AVATAR`）、`keyword`（≤100，按文件名模糊匹配）
- 说明：`ATTACHMENT` 来自 `attachments` 表（作业提交上传）；`AVATAR` 由 `users.avatar_url`
  指向的存储文件合成（id 形如 `avatar:<userId>`，`createdAt` 取用户资料最后更新时间近似值）
- 成功：`200`，返回 `Page<FileItem>`（`createdAt` desc）
  ```ts
  FileItem = {
    id, fileName, sizeBytes,
    kind: 'ATTACHMENT' | 'AVATAR',
    uploaderId, uploaderEmail: string | null,
    isImage: boolean,        // 按扩展名 png/jpg/jpeg/gif/webp
    referenced: boolean,     // 是否被业务数据引用；AVATAR 恒为 false
    createdAt
  }
  ```

### 11.9.1 文件内容预览 `GET /api/v1/admin/files/:id/content`

- 权限：🛡️ `WHEEL`、`ADMIN`。头像可供管理人员预览；作业附件中 ADMIN 可读取，WHEEL 仅可读取其本人发布作业的附件。未关联提交的附件仅 ADMIN 可读取。
- 路径参数：`id`——`ATTACHMENT` 传附件 uuid；`AVATAR` 传 `avatar:<userId>`
- 成功：`200`，返回文件字节流（`Content-Type` 按扩展名，`Content-Disposition: inline`，`Cache-Control: private, no-store`）
- 失败：`400` id 非法；`404` 文件不存在

### 11.10 删除文件 `DELETE /api/v1/admin/files/:id`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：`AVATAR` 条目（`id` 形如 `avatar:<userId>`）删除即清空对应用户头像引用；`ATTACHMENT` 删除物理文件与记录
- 成功：`204`，写入审计 `file.delete`
- 失败：`400` id 非法；`404` 文件不存在；`409` 文件使用中，不可删除（被作业提交或用户头像引用）

### 11.11 回收站列表 `GET /api/v1/admin/trash`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`type`（`ARTICLE | ANNOUNCEMENT | RESOURCE | COMMENT`，大小写不敏感）
- 说明：`type` 可选；不传则四类合并按 `deletedAt` desc 分页
- 成功：`200`，返回 `Page<TrashItem>`
  ```ts
  TrashItem = {
    id,
    type: 'ARTICLE' | 'ANNOUNCEMENT' | 'RESOURCE' | 'COMMENT',
    title, summary, deletedAt,
    original: object   // 删除时刻关键字段快照（还原依据）
  }
  ```

### 11.12 还原回收站条目 `POST /api/v1/admin/trash/:type/:id/restore`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 路径参数：`type` = `ARTICLE | ANNOUNCEMENT | RESOURCE | COMMENT`（大小写不敏感）
- 成功：`204`，写入审计 `article.restore` / `announcement.restore` / `resource.restore` / `comment.restore`
- 失败：`404` 条目不存在；`409` 内容未被删除，无需恢复（重复恢复返回 409，非幂等 204）

### 11.13 评论列表 `GET /api/v1/admin/comments`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`keyword`（≤100）
- 说明：讨论回复（含软删条目）管理视图
- 成功：`200`，返回 `Page<CommentItem>`
  ```ts
  CommentItem = {
    id, issueId, issueTitle,
    authorId, authorName,
    content, createdAt,
    deletedAt: string | null
  }
  ```

### 11.14 删除评论 `DELETE /api/v1/admin/comments/:id`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：软删讨论回复（进回收站，`COMMENT` 类型可还原）
- 成功：`204`

### 11.15 在线用户 `GET /api/v1/admin/online-users`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`minutes`（1~1440，默认 15 —— 最近 N 分钟内活跃）
- 成功：`200`
  ```ts
  OnlineUsersView = {
    minutes: number,
    total: number,
    items: [{ userId, email: string | null, nickname, role, lastSeenAt }]
  }
  ```

### 11.16 操作审计日志 `GET /api/v1/admin/audit-logs`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`action`（≤100）、`targetType`（≤50）、`actorId`（uuid）
- 成功：`200`，返回 `Page<AuditLogItem>`
  ```ts
  AuditLogItem = {
    id, actorId, actorEmail: string | null,
    action, targetType,
    targetId: string | null,
    detail: object | null,
    createdAt
  }
  ```

### 11.17 登录日志 `GET /api/v1/admin/login-logs`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 查询参数：`page`、`pageSize`、`email`（≤100）、`success`（布尔）
- 成功：`200`，返回 `Page<LoginLogItem>`
  ```ts
  LoginLogItem = {
    id, userId: string | null,
    email,          // 登录标识快照（邮箱或手机号）
    ip, userAgent: string | null,
    success: boolean,
    failReason: string | null,
    createdAt
  }
  ```

### 11.18 请求日志 `GET /api/v1/admin/request-logs`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：记录范围为**全部 `/api/v1/**` 请求（含 GET）**，响应完成后异步写库、失败静默
- 查询参数：`page`、`pageSize`、`userId`（uuid）、`method`（`GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS`）
- 成功：`200`，返回 `Page<RequestLogItem>`
  ```ts
  RequestLogItem = {
    id, method, path,
    statusCode: number,
    userId: string | null,
    userEmail: string | null,
    ip, durationMs: number,
    createdAt
  }
  ```

### 11.19 接口清单 `GET /api/v1/admin/api-registry`

- 权限：🛡️ `WHEEL`、`ADMIN`
- 说明：运行时枚举全站路由 + `@Public()` / `@Roles()` 元数据（含全局守卫「默认需登录」语义：
  `isPublic: false` 且 `roles: []` 表示任意已登录角色可访问）。反射为控制器层元数据，
  Multer 等中间件层约束（上传字段名、大小限制）无法从路由元数据读取，需参见对应接口文档。
- 成功：`200`，返回数组（按 `path` 升序排序）
  ```ts
  ApiRegistryItem = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | ...,
    path: '/api/v1/...',   // 含 /api/v1 前缀的完整路径
    isPublic: boolean,
    roles: Role[],
    controller, handler
  }
  ```

---

## 附录：权限矩阵（速查）

| 能力 | VISITOR | MEMBER | ALUMNI | WHEEL | ADMIN |
|---|:---:|:---:|:---:|:---:|:---:|
| 注册 / 登录 / 刷新 / 登出 / 改本人密码 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 持邀请码转正（VISITOR→MEMBER） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 改本人资料 / 换绑 / 头像 / 用户名 / 个人主页 | ✅ | ✅ | ✅ | ✅ | ✅（不可换绑） |
| 查看他人公开资料 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看他人邮箱、手机号 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 互访个人主页 / 活跃 / 回复 / 粉丝列表 | 仅本人 | ✅ | ✅ | ✅ | ✅ |
| 关注 / 取关成员 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 社区徽章 / 贪吃蛇（公开聚合数据） | ✅（含匿名访问） | ✅ | ✅ | ✅ | ✅ |
| 浏览文章 / 公告 / 资源 / 标签 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 创建文章 | ❌ | ✅（先审后发） | ✅ | ✅ | ✅ |
| 编辑、删除**本人**文章 | ❌ | ✅（限待审/被拒） | ✅ | ✅ | ✅ |
| 审核文章（通过/拒绝/隐藏） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 删除**他人**文章 / 删除他人内容 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 浏览作业 / 查看我的提交 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 发布、编辑作业 | ❌ | ❌ | ✅ | ✅ | ✅（编辑任意） |
| 提交作业 | ❌ | ✅ | ✅ | ❌ | ❌ |
| 查看作业提交列表 / 下载他人附件 | ❌ | ❌ | ✅（仅本人发布） | ✅（仅本人发布） | ✅（任意） |
| 创建 issue | ❌ | ✅ | ✅ | ✅ | ✅ |
| 回复 issue | ✅ | ✅ | ✅ | ✅ | ✅ |
| 变更 issue 状态 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 发布 / 编辑公告、资源 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 生成 / 作废邀请码 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 提前提拔 `MEMBER`→`ALUMNI` | ❌ | ❌ | ❌ | ✅ | ✅ |
| 剔除学员（删 `MEMBER`/`VISITOR`） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 改角色（任免 `WHEEL` 等）、封禁账号 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 后台：统计 / 文件 / 回收站 / 评论 / 在线 / 日志 / 接口清单 | ❌ | ❌ | ❌ | ✅ | ✅ |

补充规则：
- 所有涉及"本人"的操作在 service 层校验归属（`authorId === currentUser.id` 等），前端隐藏按钮不构成权限。
- 被封禁账号（`status = 'BANNED'`）在 `JwtAuthGuard` 直接 403。
- `ADMIN` 账号不可被改角色 / 删除 / 封禁（service 层 403）。
- `VISITOR` 全面禁入作业模块（列表/详情/提交/附件/提交记录均 403）；个人主页 / 关注 / 活跃等社交接口对 `VISITOR` 仅开放本人数据。
- **slug 寻址**：详情类读接口 `:id` 可传 uuid 或 slug；写接口（编辑/删除/审核/回复/提交等）仅 uuid。用户接口 `:id` 可传 uuid 或 username（封禁/解封仅 uuid）。
- **软删除语义**：文章/公告/资源/评论（讨论回复）的 `DELETE` 一律为软删（置 `deleted_at`）进回收站，
  可经 `POST /admin/trash/:type/:id/restore` 还原；软删期间列表/详情/搜索/tag 过滤/tag 计数均排除软删行
  （详情 404），`taggings` 保留、恢复后完整可见；审计 `detail` 保留删除前快照（标题/正文前 200 字）。
  重复恢复返回 `409`。剔除学员为硬删并级联其 issues/replies（FK 级联不变）。
- 考试 / 测试题为预留能力（`MEMBER` 强制参与、`ALUMNI` 可参与、`WHEEL` 发布），当前未实现。
