# AI订阅管理工具 - 单用户认证系统设计

## 概述

为 AI 订阅管理工具添加单用户认证功能，使用 next-auth v5 实现基于 Cookie 的 Session 认证，支持局域网访问。

## 技术方案

### 认证框架
- **next-auth v5** - Credentials Provider
- **bcryptjs** - 密码加密
- **JWT + Cookie** - Session 存储（iron-session）

### 数据存储
- 凭证存储在 `data/auth.json`
- 首次启动创建默认凭证（admin / admin123）
- 密码使用 bcrypt 哈希存储

## 架构设计

### 请求流程
```
用户访问 → Middleware 检查 Session → 未登录重定向 /login → next-auth 验证 → 创建 Session → 放行
```

### 路由保护
- **受保护路由**: `/`, `/api/subscriptions`, `/api/categories`
- **公开路由**: `/login`, `/api/auth/*`

## 文件结构

### 新增文件
```
app/
├── login/
│   └── page.tsx              # 登录页面
└── api/
    └── auth/
        └── [...nextauth]/
            └── route.ts      # next-auth 路由

lib/
└── auth.ts                   # next-auth 配置

middleware.ts                  # 路由保护中间件

data/
└── auth.json                  # 用户凭证存储
```

### 修改文件
- `package.json` - 添加依赖

## 登录页面设计

- **路由**: `/login`
- **布局**: 居中卡片设计
- **组件**: shadcn/ui (Card, Input, Button)
- **功能**: 表单验证、错误提示、登录后重定向

## Session 配置

- **过期时间**: 7 天
- **Cookie 设置**:
  - `httpOnly: true`
  - `secure: production环境`
  - `sameSite: 'lax'`
  - `path: '/'`

## 默认凭证

- **用户名**: `admin`
- **密码**: `admin123`
- **提示**: 首次登录后建议修改密码

## API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/auth/[...nextauth]` | GET/POST | next-auth 处理登录/登出 |
| `/api/subscriptions` | GET/POST/PUT/DELETE | 受保护，需认证 |
| `/api/categories` | GET | 受保护，需认证 |

## 依赖

```json
{
  "next-auth": "^5.0.0-beta.22",
  "bcryptjs": "^2.4.3",
  "@types/bcryptjs": "^2.4.6"
}
```

## 局域网访问

需要修改 systemd 服务配置，让 Next.js 监听 `0.0.0.0:3000` 而非 `localhost:3000`。

## 实现步骤

1. 安装依赖
2. 创建 `lib/auth.ts` - next-auth 配置
3. 创建 `app/api/auth/[...nextauth]/route.ts`
4. 创建 `app/login/page.tsx` - 登录页面
5. 创建 `middleware.ts` - 路由保护
6. 更新 `package.json`
7. 修改 systemd 服务配置（局域网访问）
8. 测试登录流程