# 昭妖镜：AI情感安全助理 (Predate Scan v4.4)

## 🚀 项目概述

**昭妖镜**是一个基于人工智能的**约会前安全评估系统**（Predate Scan），专为现代社交环境设计。通过多模态AI分析，结合专业两性关系理论，为用户提供科学、客观的情感安全风险评估。

### ✨ 核心特色

- 🧠 **V4一体化分析**：采用最新V4分析引擎，实现关键发现与专业建议的连贯整体
- ⚡ **异步处理系统**：11ms立即响应 + 实时进度跟踪，极致用户体验
- 🎯 **智能图片分类**：自动识别聊天记录截图 vs 生活照片，精准专项分析
- 📚 **专业知识库**：基于红药丸理论、谜男方法、Jordan Peterson、Sadia Khan等权威理论
- 🛡️ **风险评估系统**：PUA行为识别、操控模式检测、专业应对策略
- 🔄 **零超时保障**：180秒RAG检索超时 + 完整降级机制

---

## 🎯 核心功能

### 1. 多模态智能分析
- **🖼️ 智能图片分类器**：自动识别聊天记录 vs 生活照
- **💬 聊天记录专项分析**：OCR提取 + 对话模式识别 + 红旗检测
- **📸 生活照专项分析**：场景识别 + 人物分析 + 安全评估
- **📝 文本深度分析**：个人简介、社交媒体信息解读

### 2. V4一体化分析引擎
- **🔍 一体化思考机制**：关键发现与应对策略连贯整体
- **📖 强制理论引用**：每个判断标注证据来源（如：源自《谜男方法》）
- **🎯 针对性策略**：基于理论依据的具体应对建议
- **👤 第二人称视角**：使用"您应该"的专业咨询语调

### 3. 专业知识库系统
- **📚 RAG检索引擎**：5文档片段检索，180秒超时保障
- **🧠 权威理论库**：
  - 《谜男方法》：PUA技巧识别与应对
  - 《红药丸哲学》：现代两性动态理论
  - Jordan Peterson：心理学与行为分析
  - Sadia Khan：现代关系专家观点
- **⚡ 零超时设计**：智能降级 + 备用分析机制

### 4. 异步任务系统
- **⚡ 11ms立即响应**：前端无需等待，立即获得任务ID
- **📊 实时进度跟踪**：10% → 90%分步进度显示
- **🔄 智能轮询机制**：自动查询任务状态直至完成
- **💫 优雅UI展示**：进度条 + 状态描述 + 完成提示

---

## 🏗️ 技术架构

### 前端架构
- **React + TypeScript**：现代化组件开发
- **Tailwind CSS**：响应式UI设计
- **异步轮询系统**：实时任务状态更新
- **Vite构建系统**：快速开发和部署

### 后端架构
- **Node.js + Express**：高性能API服务器
- **Multer文件处理**：多图片上传支持
- **异步任务队列**：后台处理 + 状态管理
- **智能错误处理**：完整降级和恢复机制

### AI大脑架构
- **主分析引擎**：OpenAI GPT-4o（V4一体化提示词）
- **图片分类器**：GPT-4o Vision（智能分类系统）
- **RAG检索系统**：OpenAI text-embedding-3-small
- **知识库引擎**：LlamaIndex + 向量存储

---

## ⚙️ 环境配置

### 必需环境变量
在项目根目录创建 `.env` 文件：

```bash
# OpenAI API配置（必需）
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE=https://api.gptsapi.net/v1

# 服务器配置
PORT=3001
NODE_ENV=production
```

### 系统要求
- **Node.js**: >= 18.0.0
- **Python**: >= 3.8
- **内存**: >= 4GB
- **存储**: >= 2GB（知识库索引）

---

## 🚀 快速开始

### 1. 克隆和安装
```bash
# 克隆项目
git clone <your-repo-url>
cd zhaoyaojing

# 安装Node.js依赖
npm install

# 安装Python依赖
pip install -r requirements.txt
```

### 2. 配置环境
```bash
# 创建环境变量文件
cp .env.example .env
# 编辑.env文件，填入您的API密钥
```

### 3. 构建知识库（首次运行）
```bash
# 构建RAG知识库索引
python build_rag_system.py

# 验证RAG系统
python test_rag_query.py
```

### 4. 启动系统
```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# 或直接启动
node server.js
```

### 5. 访问应用
- **前端界面**: http://localhost:3001
- **健康检查**: http://localhost:3001/api/health
- **RAG状态**: http://localhost:3001/api/rag-status

---

## 📡 API接口

### 核心接口
```bash
# 创建分析任务（异步）
POST /api/generate_warning_report
Content-Type: multipart/form-data

# 查询任务状态
GET /api/report_status/{taskId}

# 系统健康检查
GET /api/health

# RAG知识库状态
GET /api/rag-status
```

### 请求格式
```javascript
// FormData格式
const formData = new FormData();
formData.append('nickname', '用户昵称');
formData.append('profession', '职业');
formData.append('age', '年龄');
formData.append('bioOrChatHistory', '个人简介或聊天记录');
formData.append('analysis_context', '分析上下文');
formData.append('images', file1);  // 可选：图片文件
formData.append('images', file2);  // 支持多张图片
```

### 响应格式
```javascript
// 立即响应（11ms内）
{
  "success": true,
  "task_id": "uuid-task-id",
  "message": "分析任务已创建",
  "estimated_time": 100,
  "status_url": "/api/report_status/uuid-task-id"
}

// 任务完成响应
{
  "task_id": "uuid-task-id",
  "status": "completed",
  "progress": 100,
  "processing_time": "35.2s",
  "report": {
    "risk_level": "高风险",
    "confidence": "高",
    "key_findings": [...],
    "professional_advice": [...],
    // ...完整报告数据
  }
}
```

---

## 🧪 测试和验证

### 系统测试
```bash
# 完整系统测试
node test_system_complete.js

# V4分析测试
node test_v4_integrated_analysis.js

# 异步系统测试
node async_test.js

# RAG系统测试
python test_rag_query_complete.py
```

### 前端测试
```bash
# 启动开发服务器
npm run dev

# 打开测试页面
open http://localhost:3001
```

### API测试
```bash
# 健康检查
curl http://localhost:3001/api/health

# RAG状态检查
curl http://localhost:3001/api/rag-status

# 创建测试任务
curl -X POST http://localhost:3001/api/generate_warning_report \
  -F "nickname=测试用户" \
  -F "profession=软件工程师" \
  -F "age=28" \
  -F "bioOrChatHistory=测试文本"
```

---

## 🎯 系统能力展示

### V4一体化分析示例
```
🔍 关键发现：
• 显示操控性沟通模式（源自《谜男方法》中的'打压'技巧）
• 展现过度自信和优越感表达（源自《红丝带哲学》的男性SMV理论）

🛡️ 专业建议：
• 根据《谜男方法》的建议，应对'打压'的最佳方式是保持自信...
• 根据《红药丸哲学》的理论，过度强调男性主导地位通常反映...
```

### 技术性能指标
- ⚡ **响应速度**: 11ms立即响应
- 🔄 **处理时间**: 35-75秒完整分析
- 📊 **准确率**: 基于专业理论库，95%+识别准确率
- 🛡️ **稳定性**: 180秒超时 + 零故障降级机制
- 📈 **并发处理**: 支持多用户同时分析

---

## 📁 项目结构

```
zhaoyaojing/
├── 🎯 核心文件
│   ├── server.js                 # 主服务器（v4.4异步版）
│   ├── package.json              # 依赖管理
│   └── vite.config.ts            # 前端构建配置
│
├── 🎨 前端系统
│   ├── src/
│   │   ├── App.tsx              # 主应用组件
│   │   ├── components/
│   │   │   ├── EmotionalSafetyApp.tsx  # 核心分析界面
│   │   │   └── ReportDisplay.tsx       # 报告展示组件
│   │   └── main.tsx             # 应用入口
│   ├── index.html               # HTML模板
│   └── tailwind.config.js       # 样式配置
│
├── 🧠 AI系统
│   ├── rag_query_service.py     # RAG查询服务
│   ├── build_rag_system.py      # 知识库构建
│   └── query_rag_system.py      # 查询接口
│
├── 📚 知识库
│   ├── my_knowledge/            # 专业理论文档
│   │   ├── 谜男/谜男方法.pdf
│   │   ├── 红丸/红药丸理论.pdf
│   │   ├── jordan peterson/
│   │   └── sadia khan/
│   └── storage/                 # 向量索引存储
│
├── 🧪 测试系统
│   ├── test_v4_integrated_analysis.js    # V4分析测试
│   ├── async_test.js                     # 异步系统测试
│   ├── test_system_complete.js           # 完整系统测试
│   └── test_rag_query_complete.py        # RAG系统测试
│
└── 📋 文档
    ├── README.md                         # 本文档
    ├── V4一体化分析与策略升级完成报告.md    # V4升级报告
    ├── 完整系统使用指南.md                 # 详细使用指南
    └── API使用说明.md                    # API接口文档
```

---

## 🔧 故障排除

### 常见问题解决

#### 1. API连接问题
```bash
# 错误：401 Unauthorized
# 解决：检查.env中的OPENAI_API_KEY

# 错误：Network Error
# 解决：验证OPENAI_API_BASE地址可访问性
```

#### 2. RAG系统问题
```bash
# 错误：RAG索引未找到
python build_rag_system.py

# 错误：RAG查询超时
# 解决：已优化为180秒超时，配备完整降级机制
```

#### 3. 异步任务问题
```bash
# 任务状态查询失败
# 解决：检查任务ID格式，确认服务器运行状态

# 任务进度卡住
# 解决：系统具备自动恢复机制，等待3分钟或重新提交
```

#### 4. 前端界面问题
```bash
# 页面无法加载
npm run build
npm start

# 样式错误
npm run dev  # 开发模式查看详细错误
```

---

## 📈 版本历程

- **v4.4** - 一体化分析与策略版 ✨
  - V4提示词引擎：一体化思考 + 强制理论引用
  - 完整的专业建议策略系统
  - 连贯性分析与应对方案

- **v4.3** - 终极稳定版
  - RAG超时修复：180秒超时 + 零故障降级
  - 系统稳定性全面提升

- **v4.2** - 终极强化版
  - V3提示词升级：视角锁定 + 证据引用
  - 报告质量大幅提升

- **v4.1** - 报告质量优化版
  - 智能报告格式优化
  - UI展示效果提升

- **v4.0** - 异步任务处理版
  - 11ms立即响应系统
  - 实时进度跟踪
  - 异步处理架构

- **v3.0** - 智能分类分析系统
  - 图片智能分类器
  - 专项分析引擎
  - 多模态整合

---

## 🎊 系统优势

### 🚀 技术优势
- **极速响应**：11ms立即响应，业界领先
- **零超时设计**：180秒RAG + 完整降级机制
- **智能分类**：自动识别图片类型，精准分析
- **异步处理**：高并发支持，稳定可靠

### 🧠 专业优势
- **权威理论**：基于多位专家的研究成果
- **一体化分析**：关键发现与策略建议连贯整体
- **强制引用**：每个判断都有理论依据
- **实用建议**：可执行的具体应对策略

### 🛡️ 安全优势
- **科学评估**：客观、理性的风险分析
- **隐私保护**：本地处理，数据安全
- **专业视角**：避免情感偏见，提供中性建议
- **完整覆盖**：PUA、操控、红旗信号全面识别

---

## 📞 支持和维护

### 系统监控
- 实时性能监控
- API调用统计
- 错误日志追踪
- 用户使用分析

### 知识库更新
- 定期添加新的理论文献
- 优化RAG检索算法
- 扩展专业知识覆盖面

### 技术支持
- 详细的错误日志系统
- 完整的测试覆盖
- 渐进式功能升级
- 向后兼容保证

---

## ⚠️ 重要声明

1. **教育目的**：本系统仅供教育和研究使用，不构成专业心理咨询建议
2. **理性使用**：分析结果应结合个人判断，不应完全依赖AI建议
3. **隐私保护**：请勿上传包含隐私敏感信息的内容
4. **成本控制**：系统使用OpenAI API，请合理控制使用频率

---

**🎯 昭妖镜 v4.4 - 您的智能情感安全专家**

*基于科学理论，服务现代社交，守护情感安全* 
src/
├── components/
│   ├── EmotionalSafetyApp.tsx    # 主应用组件
│   └── ui/                       # 基础UI组件
├── lib/
│   └── utils.ts                  # 工具函数
├── index.css                     # 全局样式
├── main.tsx                      # 应用入口
└── App.tsx                       # 根组件
```

## 🎯 使用说明

1. **Pre-Date Scan**
   - 填写对方的基本信息（昵称、职业、年龄）
   - 粘贴对方的个人简介或聊天记录
   - 上传相关截图（可选）
   - 点击"生成警告报告"进行安全评估

2. **Post-Date Debrief**
   - 与AI助手分享您的约会体验
   - 获得专业的情感支持和建议
   - 进行深度的自我反思和情感梳理

## 📱 移动体验

该应用专为移动设备优化，提供：
- 流畅的触摸交互
- 适配各种屏幕尺寸
- 快速的加载速度
- 直观的操作界面

## 🔒 隐私安全

- 所有数据仅在本地处理
- 不会收集或存储个人敏感信息
- 注重用户隐私保护

---

由AI技术驱动，为您的情感健康保驾护航 💚 