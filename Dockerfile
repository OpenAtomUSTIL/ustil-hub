# syntax=docker/dockerfile:1
# ============================================================
# ustil-hub（NestJS 后端）多阶段构建
# 目标（target）：
#   runtime —— 生产运行时：node dist/main.js（非 root，EXPOSE 3000）
#   migrate —— 迁移镜像：npx drizzle-kit migrate（仅由部署 job 幂等调用）
# 红线：
#   - Node 24（MUST NOT 升级更高版本）；包管理器只用 pnpm（MUST NOT npm/yarn）
#   - 启动 MUST NOT 自动跑迁移（AGENTS.md §8），CMD 只起应用；
#     迁移只由部署 job 跑 migrate 目标镜像幂等执行
# ============================================================

# ---------- base：Node 24 + pnpm ----------
FROM node:24-alpine AS base
# argon2 等原生依赖在 musl 上无预编译产物，需 node-gyp 编译链（python3/make/g++）
RUN apk add --no-cache python3 make g++ \
    # 与 packageManager 和 CI 固定为同一版本，避免补丁锁文件格式不兼容。
    && npm install -g pnpm@10.34.9
WORKDIR /app

# ---------- deps：全量依赖（含构建与迁移工具）----------
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY patches/ ./patches/
# lockfile 已生成 → --frozen-lockfile（CI/部署标准姿势）
# 工程化初期 lockfile 尚未生成 → 退回 --no-frozen-lockfile 兼容；
# pnpm-lock.yaml 提交后本分支自动走 frozen 路径
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --store-dir /pnpm/store; \
    else \
      echo "WARN: pnpm-lock.yaml 不存在，退回 --no-frozen-lockfile 兼容模式" && \
      pnpm install --no-frozen-lockfile --store-dir /pnpm/store; \
    fi

# ---------- build：pnpm build 产出 dist/ ----------
FROM deps AS build
# .dockerignore 排除宿主机依赖；直接继承 deps 中安装的容器依赖。
COPY . .
RUN pnpm build

# ---------- prod-deps：仅生产依赖 ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY patches/ ./patches/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --prod --store-dir /pnpm/store; \
    else \
      echo "WARN: pnpm-lock.yaml 不存在，退回 --no-frozen-lockfile 兼容模式" && \
      pnpm install --no-frozen-lockfile --prod --store-dir /pnpm/store; \
    fi

# ---------- migrate：迁移镜像（部署 job 专用）----------
FROM deps AS migrate
COPY --from=build /app/dist ./dist
COPY package.json drizzle.config.ts ./
COPY src/migrations ./src/migrations
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
# 幂等：drizzle-kit migrate 只应用未执行过的迁移，可重入；
# 仅供 `docker compose --profile migrate run --rm migrate` 调用，MUST NOT 挂进服务启动
CMD ["npx", "drizzle-kit", "migrate"]

# ---------- seed：初始 ADMIN 种子镜像（部署 job 专用）----------
FROM deps AS seed
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
# 幂等：ADMIN_EMAIL 已存在则跳过；仅供 `docker compose --profile seed run --rm seed` 调用，
# MUST NOT 挂进服务启动（启动命令不做 DB 写入）
CMD ["node", "dist/scripts/seed-admin.js"]

# ---------- runtime：生产运行时（默认目标，放最后）----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# 非 root 运行
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json drizzle.config.ts ./
COPY src/migrations ./src/migrations
# 本地上传目录（compose 挂载 uploads-data:/app/storage），预先建好并授权
RUN mkdir -p /app/storage && chown -R app:app /app
USER app
EXPOSE 3000
# 红线：启动命令 MUST NOT 含迁移（AGENTS.md §8）
CMD ["node", "dist/main.js"]
