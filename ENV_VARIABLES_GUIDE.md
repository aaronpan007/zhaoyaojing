# 🔐 照妖镜项目环境变量配置指南

## 📋 所有需要的环境变量清单

基于代码分析，你的项目需要以下环境变量。请在项目根目录创建`.env`文件并添加这些配置：

### 1. 🤖 OpenAI API 配置 (必需)
```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE=https://api.openai.com/v1
```

**说明:**
- `OPENAI_API_KEY`: 用于GPT模型调用和图片分析
- 获取地址: https://platform.openai.com/api-keys
- 格式示例: `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 2. 🔊 Replicate API 配置 (语音转录功能)
```bash
REPLICATE_API_TOKEN=your_replicate_api_token_here
```

**说明:**
- 用于Whisper语音转录服务
- 获取地址: https://replicate.com/account/api-tokens
- 格式示例: `r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 3. ☁️ Cloudflare R2 存储配置 (必需)
```bash
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
BUCKET_NAME=your_bucket_name
```

**说明:**
- 用于RAG知识库存储
- 获取地址: https://dash.cloudflare.com/
- `CLOUDFLARE_ACCOUNT_ID`: 在Cloudflare仪表板右侧找到
- `R2_ACCESS_KEY_ID` & `R2_SECRET_ACCESS_KEY`: 在R2 > 管理API令牌中创建
- `BUCKET_NAME`: 你创建的R2存储桶名称

### 4. 🚀 服务器配置
```bash
PORT=3001
TEST_PORT=3002
NODE_ENV=development
```

### 5. 🔧 系统配置
```bash
RAG_DIAGNOSTIC_MODE=false
```

**说明:**
- 开启RAG诊断模式，调试时可设为`true`

## 🔥 完整的`.env`文件模板

请在项目根目录创建`.env`文件，并复制以下内容：

```bash
# 照妖镜 - AI情感安全助理 环境变量配置

# OpenAI API 配置 (必需)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE=https://api.openai.com/v1

# Replicate API 配置 (语音转录功能)
REPLICATE_API_TOKEN=your_replicate_api_token_here

# Cloudflare R2 存储配置 (必需)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
BUCKET_NAME=your_bucket_name

# 服务器配置
PORT=3001
TEST_PORT=3002
NODE_ENV=development

# 系统配置
RAG_DIAGNOSTIC_MODE=false
```

## 🚀 Vercel部署时的配置

部署到Vercel时，需要在Vercel Dashboard的Environment Variables中设置：

```bash
OPENAI_API_KEY=your_actual_key
OPENAI_API_BASE=https://api.openai.com/v1
REPLICATE_API_TOKEN=your_actual_token
CLOUDFLARE_ACCOUNT_ID=your_actual_id
R2_ACCESS_KEY_ID=your_actual_key
R2_SECRET_ACCESS_KEY=your_actual_secret
BUCKET_NAME=your_actual_bucket_name
NODE_ENV=production
RAG_DIAGNOSTIC_MODE=false
```

## ✅ 配置验证

配置完成后，运行以下命令验证：

```bash
# 启动开发服务器
npm run dev

# 检查健康状态
curl http://localhost:3001/api/health

# 检查RAG状态  
curl http://localhost:3001/api/rag-status
```

---
**重要提醒:** 
- 请将实际的API密钥替换掉模板中的占位符
- 绝对不要将`.env`文件提交到Git仓库
- 确保`.env`已被`.gitignore`忽略 