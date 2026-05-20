# AI订阅管理工具

一个用于管理AI订阅服务的Web应用，帮助您追踪支出、分析使用情况，并及时了解续费信息。

## 功能特性

- **订阅管理**: 添加、编辑、删除AI订阅服务
- **支出统计**: 实时显示月度和年度总支出
- **分类分析**: 饼图展示各分类支出分布
- **状态跟踪**: 支持活跃、暂停、已取消三种状态
- **续费提醒**: 自动标记即将续费的订阅（7天内）
- **筛选功能**: 按分类和状态筛选订阅
- **优先级管理**: 多场景优先级配置，支持拖拽排序
- **数据持久化**: 本地JSON文件存储数据

## 技术栈

- **前端框架**: Next.js 14 (App Router)
- **UI组件**: shadcn/ui + Radix UI
- **样式方案**: Tailwind CSS
- **图表展示**: Recharts
- **开发语言**: TypeScript
- **图标库**: Lucide React

## 安装指南

### 前置要求

- Node.js 18.0 或更高版本
- npm 或 pnpm

### 安装步骤

1. 克隆项目仓库:
```bash
git clone <repository-url>
cd ai-subscriptions
```

2. 安装依赖:
```bash
npm install
```

3. 启动开发服务器:
```bash
npm run dev
```

4. 打开浏览器访问 `http://localhost:3000`

## 使用说明

### 添加订阅

1. 点击页面右上角的"添加订阅"按钮
2. 在弹出的对话框中填写订阅信息:
   - 名称: 订阅服务名称
   - 分类: 选择或输入分类（如AI助手、图像生成等）
   - 价格: 月度订阅价格
   - 开始日期: 订阅开始日期
   - 续费日期: 下次续费日期
   - 状态: 活跃/暂停/已取消
   - 备注: 可选的备注信息
3. 点击"添加"按钮保存

### 编辑订阅

1. 在订阅卡片上点击"编辑"按钮
2. 在弹出的对话框中修改信息
3. 点击"保存"按钮更新

### 删除订阅

1. 在订阅卡片上点击"删除"按钮
2. 订阅将被永久删除

### 篮选订阅

- 使用"分类筛选"下拉框选择特定分类
- 使用"状态筛选"下拉框选择特定状态
- 选择"全部"可显示所有订阅

### 查看统计

- 页面顶部显示月度总支出、年度总支出和活跃订阅数
- 右侧饼图展示各分类支出占比

### 优先级管理

1. **创建场景**: 点击"+"按钮，输入场景名称（如"工作日"、"周末"）
2. **添加订阅**: 从可用订阅列表中点击订阅添加到场景
3. **调整优先级**: 拖拽订阅项调整使用优先级顺序
4. **移除订阅**: 点击订阅项的"X"按钮从场景中移除
5. **重命名场景**: 点击编辑按钮修改场景名称
6. **删除场景**: 点击删除按钮移除场景
7. **切换场景**: 使用下拉框切换不同使用场景

## 项目结构

```
ai-subscriptions/
├── app/
│   ├── api/
│   │   ├── subscriptions/
│   │   │   ├── route.ts      # 订阅CRUD API
│   │   │   └── [id]/route.ts # 单个订阅操作API
│   │   └── categories/
│   │   │   └── route.ts      # 分类API
│   ├── globals.css            # 全局样式
│   ├── layout.tsx             # 根布局
│   └── page.tsx               # 主页面
├── components/
│   ├── ui/                    # shadcn/ui组件
│   ├── StatsCards.tsx         # 统计卡片
│   ├── CategoryPieChart.tsx   # 分类饼图
│   ├── SubscriptionCard.tsx   # 订阅卡片
│   ├── SubscriptionForm.tsx   # 订阅表单
│   ├── SubscriptionList.tsx   # 订阅列表
│   ├── CategoryFilter.tsx     # 分类筛选
│   ├── PriorityManager.tsx    # 优先级管理主组件
│   └── SortablePriorityList.tsx # 可拖拽优先级列表
├── lib/
│   ├── db.ts                  # 订阅数据存储逻辑
│   ├── priorities.ts          # 优先级数据存储逻辑
│   ├── types.ts               # 类型定义
│   └── utils.ts               # 工具函数
├── data/
│   ├── subscriptions.json     # 订阅数据文件（自动生成）
│   └── priorities.json        # 优先级数据文件（自动生成）
├── Makefile                   # systemd 服务管理脚本
└── package.json
```

## 默认分类

- AI助手
- 图像生成
- 代码工具
- 写作工具
- 数据分析
- 其他

## 构建与部署

### 构建生产版本

```bash
npm run build
```

### 启动生产服务器

```bash
npm start
```

### systemd 服务管理

项目支持安装为用户级 systemd 服务，实现后台运行和开机自启。

**安装服务：**
```bash
make install
```

**启动服务：**
```bash
make start
```

**停止服务：**
```bash
make stop
```

**重启服务：**
```bash
make restart
```

**查看状态：**
```bash
make status
```

**查看日志：**
```bash
make logs
```

**设置开机自启：**
```bash
make enable
```

**取消开机自启：**
```bash
make disable
```

**卸载服务：**
```bash
make uninstall
```

**查看所有命令：**
```bash
make help
```

## 开发命令

- `npm run dev` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm run lint` - 运行代码检查

## 许可证

MIT License