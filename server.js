const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
const Replicate = require('replicate');
require('dotenv').config();

// 导入增强的图片分析模块
const { enhancedAnalyzeImageWithGPT4o } = require('./enhanced_image_analysis');

const app = express();
const PORT = process.env.PORT || 3001;

// 检查环境配置
console.log('🔍 检查系统配置...');

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ 错误: 未设置OPENAI_API_KEY环境变量');
  console.error('请在 .env 文件中添加: OPENAI_API_KEY=your_openai_api_key');
  process.exit(1);
}

if (!process.env.OPENAI_API_BASE) {
  console.warn('⚠️  警告: 未设置OPENAI_API_BASE环境变量');
  console.warn('将使用默认OpenAI API地址');
}

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
});

console.log('✅ OpenAI GPT-4o客户端初始化完成');
console.log('🔗 API地址:', process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');

// 检查RAG系统是否就绪
const checkRAGSystem = () => {
  const storagePath = path.join(__dirname, 'storage');
  const indexFile = path.join(storagePath, 'index_store.json');
  
  if (!fs.existsSync(storagePath) || !fs.existsSync(indexFile)) {
    console.warn('⚠️  警告: RAG索引未找到');
    console.warn('请先运行: python build_rag_system.py');
    return false;
  }
  
  console.log('✅ RAG系统索引已就绪');
  return true;
};

const ragSystemReady = checkRAGSystem();

// ===== 异步任务管理系统 =====
// 内存中存储任务状态和结果
const taskStorage = new Map();

// 任务状态枚举
const TaskStatus = {
  PENDING: 'pending',     // 任务已创建，等待处理
  PROCESSING: 'processing', // 正在处理
  COMPLETED: 'completed',   // 处理完成
  FAILED: 'failed'         // 处理失败
};

// 任务管理函数
const createTask = (initialData = {}) => {
  const taskId = uuidv4();
  const task = {
    id: taskId,
    status: TaskStatus.PENDING,
    progress: 0,
    current_step: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    input_data: initialData,
    result: null,
    error: null,
    processing_time: 0
  };
  
  taskStorage.set(taskId, task);
  console.log(`📋 创建新任务: ${taskId}`);
  return taskId;
};

const updateTaskStatus = (taskId, status, currentStep = '', progress = 0, data = {}) => {
  const task = taskStorage.get(taskId);
  if (!task) {
    console.warn(`⚠️ 任务不存在: ${taskId}`);
    return false;
  }
  
  task.status = status;
  task.current_step = currentStep;
  task.progress = progress;
  task.updated_at = new Date().toISOString();
  
  // 合并额外数据
  Object.assign(task, data);
  
  console.log(`📝 任务 ${taskId} 状态更新: ${status} - ${currentStep} (${progress}%)`);
  return true;
};

const getTask = (taskId) => {
  return taskStorage.get(taskId);
};

const setTaskResult = (taskId, result) => {
  const task = taskStorage.get(taskId);
  if (task) {
    task.result = result;
    task.status = TaskStatus.COMPLETED;
    task.progress = 100;
    task.processing_time = Date.now() - new Date(task.created_at).getTime();
    task.updated_at = new Date().toISOString();
    console.log(`✅ 任务 ${taskId} 完成，处理时间: ${task.processing_time}ms`);
  }
};

const setTaskError = (taskId, error) => {
  const task = taskStorage.get(taskId);
  if (task) {
    task.error = error.message || error;
    task.status = TaskStatus.FAILED;
    task.processing_time = Date.now() - new Date(task.created_at).getTime();
    task.updated_at = new Date().toISOString();
    console.log(`❌ 任务 ${taskId} 失败: ${task.error}`);
  }
};

// 清理超过1小时的旧任务
const cleanupOldTasks = () => {
  const oneHourAgo = Date.now() - 3600000; // 1小时
  let cleaned = 0;
  
  for (const [taskId, task] of taskStorage.entries()) {
    const taskTime = new Date(task.created_at).getTime();
    if (taskTime < oneHourAgo) {
      taskStorage.delete(taskId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 清理了 ${cleaned} 个过期任务`);
  }
};

// 每30分钟清理一次过期任务
setInterval(cleanupOldTasks, 1800000);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB限制（支持音频文件）
  },
  fileFilter: function (req, file, cb) {
    // 允许图片文件和音频文件
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片或音频文件！'), false);
    }
  }
});

// 配置专门用于约会后复盘的multer（支持音频 - 内存存储模式）
const postDateUpload = multer({
  storage: multer.memoryStorage(), // 使用内存存储，不保存到磁盘
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB限制
  },
  fileFilter: function (req, file, cb) {
    // 支持的音频格式
    const audioMimeTypes = [
      'audio/mp3',
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/aiff',
      'audio/x-aiff',
      'audio/aac',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      'audio/x-flac',
      'audio/m4a',
      'audio/x-m4a',
      'audio/opus'
    ];
    
    // 检查文件扩展名（作为备用检查）
    const fileExtension = file.originalname.toLowerCase().split('.').pop();
    const audioExtensions = ['mp3', 'wav', 'aiff', 'aac', 'ogg', 'webm', 'flac', 'm4a', 'opus'];
    
    // 如果字段名是 'audio'，则只允许音频文件
    if (file.fieldname === 'audio') {
      if (file.mimetype.startsWith('audio/') || audioMimeTypes.includes(file.mimetype) || audioExtensions.includes(fileExtension)) {
        cb(null, true);
      } else {
        cb(new Error('只允许上传音频文件！'));
      }
    } else {
      // 其他字段不允许文件上传
      cb(new Error('不支持的文件字段'));
    }
  }
});

// 🔍 第一步：图片分类函数 - 判断图片类型
const classifyImageWithGPT4o = async (filePath, filename) => {
  console.log(`🔍 开始图片分类: ${filename}`);
  
  try {
    // 验证文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    // 读取图片文件并转换为base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = filename.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
    
    console.log(`📁 图片已编码: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);
    
    // 构建分类提示词
    const classificationPrompt = `请判断这张图片是"聊天记录截图"还是"生活照"？

判断标准：
- 聊天记录截图：包含对话气泡、聊天界面、文字消息等
- 生活照：人物照片、风景照、自拍照、社交场景等日常生活照片

请只返回以下两个类别之一：
- chat （聊天记录截图）
- photo （生活照）

不要返回其他内容，只返回 "chat" 或 "photo"。`;

    console.log(`🤖 调用OpenAI GPT-4o进行图片分类...`);
    
    // 调用OpenAI GPT-4o进行图片分类
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: classificationPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    });
    
    const classificationResult = response.choices[0].message.content.trim().toLowerCase();
    
    console.log(`✅ 图片分类完成: ${filename} -> ${classificationResult}`);
    
    // 验证分类结果
    if (classificationResult === 'chat' || classificationResult === 'photo') {
    return {
      filename: filename,
        filePath: filePath,
        classification: classificationResult,
        success: true
      };
    } else {
      console.warn(`⚠️ 分类结果异常: ${classificationResult}，默认为photo`);
      return {
        filename: filename,
        filePath: filePath,
        classification: 'photo',
        success: true,
        note: `分类结果异常，默认为photo`
      };
    }
    
  } catch (error) {
    console.error(`❌ 图片分类失败 (${filename}):`, error.message);
    return {
      filename: filename,
      filePath: filePath,
      classification: 'unknown',
      success: false,
      error: error.message
    };
  }
};

// 💬 第二步：聊天记录专项分析函数
const analyzeChatImageWithGPT4o = async (filePath, filename) => {
  console.log(`💬 开始聊天记录OCR分析: ${filename}`);
  
  try {
    // 读取图片文件并转换为base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = filename.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
    
    // 构建聊天记录分析提示词
    const chatAnalysisPrompt = `你是一位专业的聊天记录分析师。请对这张聊天截图进行详细的OCR文字识别和内容分析。

分析要求：
1. 提取所有可见的对话内容（包括发送者和接收者的消息）
2. 分析沟通模式和情感倾向
3. 识别任何可能的红旗信号或异常行为
4. 评估对话的整体健康度

请严格按照JSON格式返回分析结果：
{
  "extracted_conversations": "完整的对话内容提取，包括发送者标识",
  "communication_patterns": "沟通模式分析（频率、语调、主导性等）",
  "emotional_indicators": "情感倾向和情绪线索",
  "red_flags": "发现的红旗信号或异常行为",
  "overall_assessment": "对话整体健康度评估",
  "confidence": "分析可信度（高/中/低）"
}`;

    console.log(`🔄 调用OpenAI GPT-4o进行聊天记录分析...`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: chatAnalysisPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    });
    
    const analysisText = response.choices[0].message.content;
    
    console.log(`✅ 聊天记录分析完成: ${filename}`);
    
    // 尝试解析JSON响应
    let analysisResult;
    try {
      let cleanedText = analysisText;
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.split('```json')[1].split('```')[0];
      } else if (cleanedText.includes('```')) {
        cleanedText = cleanedText.split('```')[1].split('```')[0];
      }
      
      analysisResult = JSON.parse(cleanedText.trim());
    } catch (parseError) {
      console.warn(`⚠️ JSON解析失败，使用原始分析: ${filename}`);
      analysisResult = {
        extracted_conversations: String(analysisText),
        communication_patterns: '无法解析结构化数据',
        emotional_indicators: '',
        red_flags: '',
        overall_assessment: '需要人工审核',
        confidence: '中'
      };
    }
    
    return {
      filename: filename,
      analysis_type: 'chat_record',
      extracted_conversations: analysisResult.extracted_conversations || '',
      communication_patterns: analysisResult.communication_patterns || '',
      emotional_indicators: analysisResult.emotional_indicators || '',
      red_flags: analysisResult.red_flags || '',
      overall_assessment: analysisResult.overall_assessment || '',
      confidence: analysisResult.confidence || '中',
      success: true
    };
    
  } catch (error) {
    console.error(`❌ 聊天记录分析失败 (${filename}):`, error.message);
    return {
      filename: filename,
      analysis_type: 'chat_record',
      extracted_conversations: `聊天记录分析失败: ${error.message}`,
      communication_patterns: '分析不可用',
      emotional_indicators: '',
      red_flags: '',
      overall_assessment: '分析失败',
      confidence: '低',
      success: false,
      error: error.message
    };
  }
};

// 📸 第三步：生活照专项分析函数
const analyzePhotoImageWithGPT4o = async (filePath, filename) => {
  console.log(`📸 开始生活照视觉分析: ${filename}`);
  
  try {
    // 读取图片文件并转换为base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = filename.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
    
    // 构建生活照分析提示词
    const photoAnalysisPrompt = `你是一位专业的视觉分析师，专门从约会安全的角度分析生活照片。

请对这张生活照进行详细的视觉分析：
1. 描述照片中的场景、环境和背景
2. 分析人物的形象、着装和状态
3. 观察生活方式和社交线索
4. 识别任何值得注意的细节或线索
5. 从约会安全角度进行风险评估

请严格按照JSON格式返回分析结果：
{
  "scene_description": "场景和环境描述",
  "person_analysis": "人物形象、着装和状态分析",
  "lifestyle_indicators": "生活方式和社交线索",
  "notable_details": "值得注意的细节或线索",
  "safety_assessment": "从约会安全角度的风险评估",
  "confidence": "分析可信度（高/中/低）"
}`;

    console.log(`🔄 调用OpenAI GPT-4o进行生活照分析...`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: photoAnalysisPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
          max_tokens: 800,
          temperature: 0.1
    });
    
    const analysisText = response.choices[0].message.content;
    
    console.log(`✅ 生活照分析完成: ${filename}`);
    
    // 尝试解析JSON响应
    let analysisResult;
    try {
      let cleanedText = analysisText;
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.split('```json')[1].split('```')[0];
      } else if (cleanedText.includes('```')) {
        cleanedText = cleanedText.split('```')[1].split('```')[0];
      }
      
      analysisResult = JSON.parse(cleanedText.trim());
    } catch (parseError) {
      console.warn(`⚠️ JSON解析失败，使用原始分析: ${filename}`);
      analysisResult = {
        scene_description: String(analysisText),
        person_analysis: '无法解析结构化数据',
        lifestyle_indicators: '',
        notable_details: '',
        safety_assessment: '需要人工审核',
        confidence: '中'
      };
    }
    
    return {
      filename: filename,
      analysis_type: 'life_photo',
      scene_description: analysisResult.scene_description || '',
      person_analysis: analysisResult.person_analysis || '',
      lifestyle_indicators: analysisResult.lifestyle_indicators || '',
      notable_details: analysisResult.notable_details || '',
      safety_assessment: analysisResult.safety_assessment || '',
      confidence: analysisResult.confidence || '中',
      success: true
    };
    
  } catch (error) {
    console.error(`❌ 生活照分析失败 (${filename}):`, error.message);
    return {
      filename: filename,
      analysis_type: 'life_photo',
      scene_description: `生活照分析失败: ${error.message}`,
      person_analysis: '分析不可用',
      lifestyle_indicators: '',
      notable_details: '',
      safety_assessment: '分析失败',
      confidence: '低',
      success: false,
      error: error.message
    };
  }
};

// 多模态图片分析 - 使用OpenAI GPT-4o进行深度分析（保留作为备用）
const analyzeImageWithGPT4o = async (filePath, filename) => {
  console.log(`🎯 开始多模态分析: ${filename}`);
  
  try {
    // 验证文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
  }
  
    // 读取图片文件并转换为base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = filename.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
    
    console.log(`�� 图片已编码: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);
    console.log(`📄 MIME类型: ${mimeType}`);
    
    // 构建专业分析提示词
    const analysisPrompt = `你是一位专业的视觉分析师，专门分析约会和社交场景中的图片。

请分析这张图片（文件名：${filename}），从约会安全的角度进行专业评估。

【重要】：只分析你实际看到的内容，不要编造或假设任何信息。如果图片无法分析或为空，请明确说明。

分析要求：
1. 判断图片类型：是聊天记录截图还是生活照片（如果无法判断则标记为"unknown"）
2. 如果是聊天记录：提取实际可见的对话内容，分析沟通模式
3. 如果是生活照：描述实际可见的人物形象、环境背景
4. 识别任何实际存在的红旗信号或值得注意的细节

请严格按照JSON格式返回分析结果：
{
  "image_type": "chat" 或 "photo" 或 "unknown",
  "content_analysis": "基于实际可见内容的详细分析，如果图片为空或无法分析则说明原因",
  "extracted_text": "如果是聊天记录，提取的实际文字内容，如果无文字则为空字符串",
  "visual_cues": "实际观察到的视觉线索和细节，不要编造",
  "red_flags": "实际发现的警告信号，如果没有则为空字符串",
  "confidence": "分析可信度（高/中/低）"
}`;

    console.log(`🔄 调用OpenAI GPT-4o进行图片分析...`);
    
    // 调用OpenAI GPT-4o进行图片分析
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: analysisPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
          max_tokens: 800,
          temperature: 0.1
    });
    
    const analysisText = response.choices[0].message.content;
    
    console.log(`✅ OpenAI GPT-4o分析完成: ${filename}`);
    console.log(`📄 原始分析结果: ${analysisText.substring(0, 200)}...`);
    
    // 尝试解析JSON响应
    let analysisResult;
    try {
      // 清理可能的markdown格式
      let cleanedText = analysisText;
      if (typeof cleanedText === 'string') {
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.split('```json')[1].split('```')[0];
      } else if (cleanedText.includes('```')) {
        cleanedText = cleanedText.split('```')[1].split('```')[0];
      }
      
      analysisResult = JSON.parse(cleanedText.trim());
      } else {
        // 如果返回的不是字符串，可能是对象
        analysisResult = analysisText;
      }
    } catch (parseError) {
      console.warn(`⚠️ JSON解析失败，使用原始分析: ${filename}`);
      console.warn(`原始内容: ${analysisText}`);
      analysisResult = {
        image_type: 'unknown',
        content_analysis: String(analysisText),
        extracted_text: '',
        visual_cues: '无法解析结构化数据',
        red_flags: '',
        confidence: '中'
      };
    }
    
    // 添加文件信息
    const stats = fs.statSync(filePath);
    
    return {
      filename: filename,
      size: stats.size,
      image_type: analysisResult.image_type || 'unknown',
      content_analysis: analysisResult.content_analysis || '',
      extracted_text: analysisResult.extracted_text || '',
      visual_cues: analysisResult.visual_cues || '',
      red_flags: analysisResult.red_flags || '',
      confidence: analysisResult.confidence || '中',
      success: true
    };
    
  } catch (error) {
    console.error(`❌ 图片分析失败 (${filename}):`, error.message);
    console.error(`错误详情:`, error);
    
    // 返回基础信息
    let stats = { size: 0 };
    try {
      stats = fs.statSync(filePath);
    } catch (statError) {
      console.warn(`⚠️ 无法获取文件统计信息: ${statError.message}`);
    }
    
    return {
      filename: filename,
      size: stats.size,
      image_type: 'unknown',
      content_analysis: `图片分析失败: ${error.message}`,
      extracted_text: '',
      visual_cues: '分析不可用',
      red_flags: '',
      confidence: '低',
      success: false,
      error: error.message
    };
  }
};

// 调用RAG查询服务
// AI查询扩展器 - 解决RAG检索偏见问题
const enhanceQueryWithAI = async (userInfo, imageAnalyses) => {
  console.log('🔍 启动AI查询扩展器...');
  console.log('🎯 目标：优化查询语句以获取更均衡的知识检索结果');
  
  try {
    // 构建原始查询内容
    let originalQuery = '';
    
    // 添加用户基本信息
    if (userInfo.bioOrChatHistory && userInfo.bioOrChatHistory.trim()) {
      originalQuery += `用户描述：${userInfo.bioOrChatHistory}\n`;
    }
    
    // 添加图片分析结果的关键信息
    if (imageAnalyses && imageAnalyses.length > 0) {
      const successfulAnalyses = imageAnalyses.filter(a => a.success);
      if (successfulAnalyses.length > 0) {
        originalQuery += `\n分析发现：\n`;
        successfulAnalyses.forEach((analysis, index) => {
          if (analysis.analysis_type === 'chat_record') {
            originalQuery += `- 聊天记录${index + 1}: ${analysis.extracted_conversations || ''}\n`;
            originalQuery += `- 沟通模式: ${analysis.communication_patterns || ''}\n`;
            originalQuery += `- 红旗信号: ${analysis.red_flags || ''}\n`;
          } else if (analysis.analysis_type === 'life_photo') {
            originalQuery += `- 生活照${index + 1}: ${analysis.scene_description || ''}\n`;
            originalQuery += `- 行为模式: ${analysis.lifestyle_indicators || ''}\n`;
            originalQuery += `- 安全评估: ${analysis.safety_assessment || ''}\n`;
          }
        });
      }
    }
    
    if (!originalQuery.trim()) {
      originalQuery = `用户昵称：${userInfo.nickname}，职业：${userInfo.profession}，年龄：${userInfo.age}`;
    }
    
    console.log('📝 原始查询内容长度:', originalQuery.length, '字符');
    console.log('📋 原始查询预览:', originalQuery.substring(0, 150) + '...');
    
    // 构建AI查询优化的系统提示词
    const systemPrompt = `你是一个专业的查询优化专家，专门为RAG（检索增强生成）系统优化查询语句。

【你的任务】：
接收用户的原始查询内容，将其扩展和改写成一个更全面、更具体的查询语句，以便从多元化的知识库中检索到更均衡、更相关的内容。

【知识库背景】：
我们的知识库包含以下类型的内容：
1. 📚 谜男方法(PUA技巧) - 社交技巧和互动策略
2. 🔴 红药丸理论 - 两性动态和关系哲学
3. 🧠 Jordan Peterson - 个人责任、心理学、人生哲学
4. 💬 Sadia Khan - 现代关系咨询、女性心理学
5. 📖 其他心理学和社交动态理论

【当前问题】：
RAG系统存在严重的"检索偏见"，经常只从单一知识源（如谜男方法）检索内容，忽略其他重要的理论和观点。

【优化策略】：
1. 将单一问题扩展为多角度查询
2. 明确提及不同的理论框架和专家观点
3. 包含相关的心理学和社交动态关键词
4. 平衡理论性和实用性内容
5. 确保涵盖不同文化和性别视角

【输出要求】：
- 返回1个优化后的查询语句
- 长度控制在200-400字符
- 包含多个相关关键词和概念
- 能够触发多个知识源的检索
- 保持原始查询的核心意图

请直接返回优化后的查询语句，不要添加任何解释或格式化。`;

    const userPrompt = `原始查询内容：
${originalQuery}

请将以上内容优化为一个能够从多个知识源（谜男方法、红药丸理论、Jordan Peterson、Sadia Khan等）获取均衡检索结果的查询语句。`;

    console.log('🧠 正在调用GPT-4o进行查询优化...');
    console.log('📤 系统提示词长度:', systemPrompt.length, '字符');
    console.log('📤 用户查询长度:', userPrompt.length, '字符');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user", 
          content: userPrompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7,
      stream: false
    });
    
    const enhancedQuery = response.choices[0].message.content.trim();
    
    console.log('✅ 查询优化完成');
    console.log('📊 Token消耗:', response.usage?.total_tokens || 'N/A');
    console.log('🔄 优化前:', originalQuery.substring(0, 100) + '...');
    console.log('🚀 优化后:', enhancedQuery);
    console.log('📈 查询扩展比例:', Math.round((enhancedQuery.length / originalQuery.length) * 100) + '%');
    
    return {
      success: true,
      original_query: originalQuery,
      enhanced_query: enhancedQuery,
      token_usage: response.usage?.total_tokens || 0,
      optimization_stats: {
        original_length: originalQuery.length,
        enhanced_length: enhancedQuery.length,
        expansion_ratio: Math.round((enhancedQuery.length / originalQuery.length) * 100) / 100
      }
    };
    
  } catch (error) {
    console.error('❌ AI查询优化失败:', error.message);
    
    // 返回原始查询作为备用
    const fallbackQuery = userInfo.bioOrChatHistory || `${userInfo.nickname} ${userInfo.profession} 情感安全分析`;
    
    return {
      success: false,
      error: error.message,
      original_query: fallbackQuery,
      enhanced_query: fallbackQuery, // 使用原始查询作为备用
      token_usage: 0,
      optimization_stats: {
        original_length: fallbackQuery.length,
        enhanced_length: fallbackQuery.length,
        expansion_ratio: 1.0
      }
    };
  }
};

const callRAGSystem = async (userInfo, imageInfos, enhancedQuery = null) => {
  console.log('🧠 正在调用增强版RAG系统进行深度分析（多样性强制均衡）...');
  
  return new Promise((resolve, reject) => {
    try {
      // 准备输入数据 - 如果有增强查询，则使用它替换原始的bioOrChatHistory
      const actualQuery = enhancedQuery || userInfo.bioOrChatHistory || '';
      
      // 构建适配增强版RAG系统的数据格式
      const inputData = {
        user_info: {
          nickname: userInfo.nickname || '',
          profession: userInfo.profession || '',
          age: userInfo.age || '',
          bio: actualQuery,
          bioOrChatHistory: actualQuery
        },
        image_analysis: [], // 图片分析结果，如果有的话
        image_infos: imageInfos || [],
        diagnostic_mode: process.env.RAG_DIAGNOSTIC_MODE === 'true' || false  // 支持诊断模式
      };
      
      const inputJson = JSON.stringify(inputData);
      console.log('📤 发送给增强版RAG系统的数据:');
      console.log('   基本信息字段数:', Object.keys(inputData.user_info).length);
      
      if (enhancedQuery) {
        console.log('   🚀 使用AI优化查询，长度:', enhancedQuery.length, '字符');
        console.log('   🔄 优化查询预览:', enhancedQuery.substring(0, 100) + '...');
      } else {
        console.log('   📝 使用原始查询，长度:', actualQuery.length, '字符');
        if (actualQuery.length > 0) {
          console.log('   📋 原始查询预览:', actualQuery.substring(0, 100) + '...');
        }
      }
      
      console.log('   图片数量:', inputData.image_infos.length);
      console.log('   JSON数据大小:', inputJson.length, '字符');
      console.log('   查询类型: pre_date_scan_enhanced_diversity');
      
      // 调用增强版Python RAG查询服务（使用多样性强制均衡）
      const pythonProcess = spawn('python', ['rag_query_service_enhanced.py', inputJson], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      
      let outputData = '';
      let errorData = '';
      
      // 收集标准输出
      pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString('utf8');
      });
      
      // 收集错误输出
      pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString('utf8');
      });
      
      // 处理进程结束
      pythonProcess.on('close', (code) => {
        console.log(`🐍 增强版RAG进程结束，退出码: ${code}`);
        
        if (code === 0) {
          try {
            // 清理输出数据（增强版RAG系统已经处理了输出重定向）
            let cleanOutput = outputData.trim();
            
            // 调试：显示原始输出
            console.log('📥 增强版RAG原始输出 (前100字符):', cleanOutput.substring(0, 100));
            
            // 解析Python返回的JSON
            const result = JSON.parse(cleanOutput);
            
            if (result.success) {
              console.log('✅ 增强版RAG系统分析完成（多样性强制均衡）');
              
              // 详细日志
              const ragData = result.data;
              if (ragData && ragData.rag_analysis) {
                console.log('📊 多样性强制均衡RAG分析详情:');
                console.log('   状态:', ragData.rag_analysis.status || '未知');
                console.log('   检索到文档数:', ragData.rag_analysis.sources_count || 0);
                console.log('   知识回答长度:', (ragData.rag_analysis.knowledge_answer || '').length, '字符');
                console.log('   多样性增强:', ragData.rag_analysis.diversity_enhanced ? '✅ 已启用' : '❌ 未启用');
                
                if (ragData.rag_analysis.knowledge_references && ragData.rag_analysis.knowledge_references.length > 0) {
                  console.log('   📚 引用文档（多样性均衡后）:');
                  
                  // 统计作者分布
                  const authorCount = {};
                  ragData.rag_analysis.knowledge_references.forEach((ref, idx) => {
                    const filePath = ref.file_path || 'unknown';
                    const fileName = filePath.split('/').pop().toLowerCase();
                    
                    // 识别作者
                    let author = 'other';
                    if (fileName.includes('jordan') || fileName.includes('peterson')) author = 'jordan_peterson';
                    else if (fileName.includes('sadia') || fileName.includes('khan')) author = 'sadia_khan';
                    else if (fileName.includes('红药丸') || fileName.includes('red')) author = 'red_pill';
                    else if (fileName.includes('谜男') || fileName.includes('mystery')) author = 'mystery_method';
                    
                    authorCount[author] = (authorCount[author] || 0) + 1;
                    
                    console.log(`     ${idx + 1}. [${author}] 评分: ${ref.score?.toFixed(3) || 'N/A'}, 来源: ${filePath}`);
                  });
                  
                  console.log('   🎯 作者分布统计:');
                  Object.entries(authorCount).forEach(([author, count]) => {
                    const percentage = (count / ragData.rag_analysis.knowledge_references.length * 100).toFixed(1);
                    console.log(`      ${author}: ${count} 个片段 (${percentage}%)`);
                  });
                  
                  // 验证多样性
                  const maxAuthorCount = Math.max(...Object.values(authorCount));
                  if (maxAuthorCount <= 2) {
                    console.log('   ✅ 多样性验证: 成功！每个作者最多2个片段');
                  } else {
                    console.log(`   ⚠️ 多样性验证: 某作者超出限制 (${maxAuthorCount}个片段)`);
                  }
                }
              }
              
              resolve(result.data);
            } else {
              console.warn('⚠️ 增强版RAG系统返回错误:', result.error);
              // 如果有fallback_report，使用它；否则生成备用报告
              resolve(result.fallback_report || generateFallbackReport());
            }
          } catch (parseError) {
            console.error('❌ 解析增强版RAG响应失败:', parseError.message);
            console.error('原始输出 (前500字符):', outputData.substring(0, 500));
            resolve(generateFallbackReport());
          }
        } else {
          console.error('❌ 增强版RAG进程执行失败，退出码:', code);
          if (errorData) {
            console.error('错误输出:', errorData);
          }
          resolve(generateFallbackReport());
        }
      });
      
      // 处理进程错误
      pythonProcess.on('error', (error) => {
        console.error('❌ 启动增强版RAG进程失败:', error.message);
        resolve(generateFallbackReport());
      });
      
      // 设置超时处理
      setTimeout(() => {
        console.warn('⏰ 增强版RAG查询超时，终止进程');
        pythonProcess.kill();
        resolve(generateFallbackReport());
      }, 300000); // 300秒超时（5分钟），为复杂RAG检索提供充足时间
      
    } catch (error) {
      console.error('❌ 调用增强版RAG系统时发生错误:', error.message);
      resolve(generateFallbackReport());
    }
  });
};

// AI情感安全助理大脑 - 最终报告生成器
const generateFinalReportWithGPT4o = async (userInfo, imageAnalyses, ragKnowledge) => {
  console.log('🧠 启动AI情感安全助理大脑...');
  console.log('📊 正在整合所有分析材料并调用OpenAI GPT-4o生成最终报告');
  
  try {
    // 深度提取RAG知识内容
    let ragContent = '';
    let ragSources = [];
    
    if (ragKnowledge && typeof ragKnowledge === 'object') {
      console.log('🔍 分析RAG知识对象结构...');
      
      // 如果ragKnowledge是完整的RAG报告对象
      if (ragKnowledge.rag_analysis && ragKnowledge.rag_analysis.knowledge_answer) {
        ragContent = ragKnowledge.rag_analysis.knowledge_answer;
        if (ragKnowledge.rag_analysis.knowledge_references) {
          ragSources = ragKnowledge.rag_analysis.knowledge_references;
        }
        console.log('✅ 从rag_analysis提取知识内容');
      } else if (ragKnowledge.knowledge_answer) {
        ragContent = ragKnowledge.knowledge_answer;
        if (ragKnowledge.sources) {
          ragSources = ragKnowledge.sources;
        }
        console.log('✅ 从knowledge_answer提取知识内容');
      } else if (ragKnowledge.answer) {
        ragContent = ragKnowledge.answer;
        if (ragKnowledge.sources) {
          ragSources = ragKnowledge.sources;
        }
        console.log('✅ 从answer字段提取知识内容');
      } else {
        // 如果是备用报告，尝试从中提取有用信息
        if (ragKnowledge.final_suggestion) {
          ragContent = ragKnowledge.final_suggestion;
          console.log('⚠️ 从备用报告提取建议内容');
      } else {
        ragContent = JSON.stringify(ragKnowledge).substring(0, 500);
          console.log('⚠️ 使用原始对象内容');
        }
      }
    } else if (typeof ragKnowledge === 'string') {
      ragContent = ragKnowledge;
      console.log('✅ 直接使用字符串格式的RAG内容');
    }
    
    console.log('📚 RAG知识内容长度:', ragContent.length, '字符');
    console.log('📝 RAG知识预览:', ragContent.substring(0, 100) + '...');
    console.log('📂 RAG来源数量:', ragSources.length);
    
    // 构建专业背景知识参考文本块
    let backgroundKnowledgeText = '';
    if (ragContent && ragContent.trim().length > 10) {
      backgroundKnowledgeText = `
【专业知识库检索结果】：
${ragContent}

【知识来源】：
`;
      if (ragSources && ragSources.length > 0) {
        ragSources.forEach((source, index) => {
          backgroundKnowledgeText += `${index + 1}. 来源文档：${source.file_path || '未知'}\n`;
          backgroundKnowledgeText += `   相关性评分：${source.score ? source.score.toFixed(3) : 'N/A'}\n`;
          if (source.content) {
            backgroundKnowledgeText += `   内容片段：${source.content.substring(0, 100)}...\n`;
          }
          backgroundKnowledgeText += '\n';
        });
      } else {
        backgroundKnowledgeText += '- 知识库综合检索结果\n';
      }
      
      console.log('✅ 背景知识参考文本块构建完成，长度:', backgroundKnowledgeText.length, '字符');
    } else {
      backgroundKnowledgeText = '暂无相关专业知识库检索结果，请基于通用心理学和社交动态理论进行分析。';
      console.log('⚠️ 未获取到有效RAG内容，使用默认提示');
    }
    
    // 构建用户信息材料包（不包含RAG知识，RAG知识放在系统提示中）
    const userMaterialPackage = buildUserMaterialPackage(userInfo, imageAnalyses);
    
    // 构建包含背景知识的专业系统提示词（V4版 - 一体化分析与策略）
    const systemPrompt = `你的角色：
你是一位顶尖的两性关系和心理分析师，拥有心理学博士学位，并对"谜男方法"、"红丸哲学"等现代社交动态有深刻的研究。

你的核心任务：
根据 【用户输入信息】 和 【背景知识参考】，生成一份包含"关键发现"和"专业建议"的、高度整合的情感安全预警报告。

【背景知识参考】：
${backgroundKnowledgeText}

最终报告生成规则 (V4版 - 极其重要):

一体化思考： 你的"关键发现"和"专业建议"必须是一个连贯的整体。你在"关键发现"中识别出的每一个"可疑信号"，都必须在"专业建议"中，找到一个直接对应的、源自【背景知识参考】的"应对策略"。

强制引用证据：

在**"关键发现"**中，当你识别出一个行为模式时，必须括号注明它来自哪个理论（例如：（源自《谜男方法》中的'打压'技巧））。

在**"专业建议"**中，当你给出一个应对策略时，也必须说明其理论依据（例如：根据知识库建议，应对'打压'的最佳方式是'幽默化解，重夺框架'，因此，建议您...）。

视角锁定： 整份报告都是写给我们的用户的，请使用"您应该"、"建议您"这样的第二人称。

【风险等级判断标准】：
**高风险行为特征（必须明确识别）：**
- 操控行为：Love Bombing（爱情轰炸）、Gaslighting（煤气灯效应）、情感勒索
- 贬低模式：Negging（打压式赞美）、持续批评或贬低自尊
- 快速进展：过快推进关系、急于确定关系、催促承诺
- 过度展示：炫富、夸大成就、不切实际的承诺
- 边界侵犯：不尊重拒绝、强迫行为、控制欲强
- PUA技巧：明显的操控套路、情感操纵、心理控制

**中等风险行为特征：**
- 沟通不一致、信息模糊或前后矛盾
- 过分关注外表或物质条件
- 缺乏同理心的表现
- 社交媒体行为异常

**低风险行为特征：**
- 真诚坦率的沟通
- 尊重边界和个人选择
- 健康的自我介绍和生活分享
- 稳定一致的行为模式

请严格按照以下JSON格式输出最终报告（注意：只包含实际提供信息的分析字段）：
{
  "risk_level": "低风险/中等风险/高风险",
  "key_findings": {
    "bio_analysis": "基于个人简介的具体分析内容，必须说明证据来源和理论依据",
    "chat_analysis": "【仅在提供聊天记录时包含】基于聊天记录的分析，必须说明证据来源和理论依据",
    "photo_analysis": "【仅在提供生活照时包含】基于生活照的视觉分析，必须说明证据来源和理论依据",
    "behavior_patterns": "识别出的行为模式，必须明确引用背景知识中的理论（源自XXX理论的XXX技巧）",
    "red_flags": "发现的具体红旗信号，必须说明来源和对应理论",
    "knowledge_application": "明确说明应用了哪些背景知识和理论进行分析"
  },
  "final_suggestion": "【核心精华建议】必须使用第二人称（您应该），必须针对每个关键发现提供对应的应对策略，必须明确说明理论依据（根据XXX知识库建议，应对XXX的方式是XXX，因此建议您...），必须给出可执行的行动或可参考的话术",
  "confidence_level": "高/中/低",
  "professional_insight": "基于背景知识中专业理论的深度洞察，帮助您更好地理解情况和应对策略"
}`;

    console.log('📤 发送给OpenAI GPT-4o:');
    console.log('  - 系统提示词长度:', systemPrompt.length);
    console.log('  - 用户材料包长度:', userMaterialPackage.length, '字符');
    console.log('  - 背景知识长度:', backgroundKnowledgeText.length, '字符');

    // 调用OpenAI GPT-4o进行最终分析
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userMaterialPackage
        }
      ],
      max_tokens: 2000, // 增加token限制以容纳更丰富的分析
      temperature: 0.1
    });
    
    const reportText = response.choices[0].message.content;
    
    console.log('✅ OpenAI GPT-4o最终分析完成');
    
    // 解析JSON报告
    let finalReport;
    try {
      // 清理markdown格式
      let cleanedText = reportText;
      if (typeof reportText === 'string') {
        if (cleanedText.includes('```json')) {
          cleanedText = cleanedText.split('```json')[1].split('```')[0];
        } else if (cleanedText.includes('```')) {
          cleanedText = cleanedText.split('```')[1].split('```')[0];
        }
        
        finalReport = JSON.parse(cleanedText.trim());
      } else {
        // 如果不是字符串，可能是streaming结果，需要处理
        cleanedText = String(reportText);
        finalReport = JSON.parse(cleanedText);
      }
      
      console.log('📋 最终报告解析成功，风险等级:', finalReport.risk_level);
      
    } catch (parseError) {
      console.warn('⚠️ JSON解析失败，使用结构化备用报告');
      console.warn('原始结果类型:', typeof reportText);
      console.warn('原始结果预览:', String(reportText).substring(0, 200));
      
      // 从RAG知识中提取关键信息用于备用报告
      let ragSummary = '';
      if (ragContent && ragContent.length > 10) {
        ragSummary = ragContent.substring(0, 200) + '...';
      }
      
      finalReport = {
        risk_level: "中等风险",
        key_findings: {
          analysis_result: String(reportText).substring(0, 300) + "...",
          rag_insights: ragSummary
        },
        final_suggestion: "建议结合专业知识进行综合判断，注意观察对方的行为模式和沟通风格，必要时寻求专业咨询。",
        confidence_level: "中",
        professional_insight: ragSummary || "系统生成的深度分析报告"
      };
    }
    
    return finalReport;
    
  } catch (error) {
    console.error('❌ GPT-4o最终报告生成失败:', error.message);
    console.error('错误详情:', error.stack);
    return generateFallbackReport();
  }
};

// 构建用户信息材料包（支持分类图片分析）
const buildUserMaterialPackage = (userInfo, imageAnalyses) => {
  console.log('📦 构建用户信息材料包（智能分类版）...');
  
  let materialPackage = `【待分析的用户信息】:

基本信息：
- 昵称：${userInfo.nickname || '未提供'}
- 职业：${userInfo.profession || '未提供'}
- 年龄：${userInfo.age || '未提供'}

个人简介或聊天记录：
${userInfo.bioOrChatHistory || '未提供相关信息'}

`;

  // 处理图片分析结果
  if (imageAnalyses && imageAnalyses.length > 0) {
    const successfulAnalyses = imageAnalyses.filter(a => a.success);
    
    if (successfulAnalyses.length > 0) {
      // 分别处理聊天记录和生活照
      const chatAnalyses = successfulAnalyses.filter(a => a.analysis_type === 'chat_record');
      const photoAnalyses = successfulAnalyses.filter(a => a.analysis_type === 'life_photo');
      
      // 聊天记录分析部分
      if (chatAnalyses.length > 0) {
        materialPackage += `\n【聊天记录分析】:\n`;
        materialPackage += `以下信息是基于用户上传的聊天截图生成的：\n\n`;
        
        chatAnalyses.forEach((analysis, index) => {
          // 安全处理可能是数组的字段
          const formatField = (field) => {
            if (!field) return '无';
            return Array.isArray(field) ? field.join(', ') : String(field);
          };
          
          materialPackage += `聊天记录${index + 1} (${analysis.filename}):\n`;
          materialPackage += `- 提取的对话内容: ${formatField(analysis.extracted_conversations)}\n`;
          materialPackage += `- 沟通模式分析: ${formatField(analysis.communication_patterns)}\n`;
          materialPackage += `- 情感倾向: ${formatField(analysis.emotional_indicators)}\n`;
          materialPackage += `- 红旗信号: ${formatField(analysis.red_flags)}\n`;
          materialPackage += `- 整体评估: ${formatField(analysis.overall_assessment)}\n`;
          materialPackage += `- 分析可信度: ${formatField(analysis.confidence)}\n\n`;
        });
      }
      
      // 生活照分析部分
      if (photoAnalyses.length > 0) {
        materialPackage += `\n【生活照分析】:\n`;
        materialPackage += `以下信息是基于用户上传的生活照生成的：\n\n`;
        
        photoAnalyses.forEach((analysis, index) => {
          // 安全处理可能是数组的字段
          const formatField = (field) => {
            if (!field) return '无';
            return Array.isArray(field) ? field.join(', ') : String(field);
          };
          
          materialPackage += `生活照${index + 1} (${analysis.filename}):\n`;
          materialPackage += `- 场景描述: ${formatField(analysis.scene_description)}\n`;
          materialPackage += `- 人物分析: ${formatField(analysis.person_analysis)}\n`;
          materialPackage += `- 生活方式线索: ${formatField(analysis.lifestyle_indicators)}\n`;
          materialPackage += `- 值得注意的细节: ${formatField(analysis.notable_details)}\n`;
          materialPackage += `- 安全评估: ${formatField(analysis.safety_assessment)}\n`;
          materialPackage += `- 分析可信度: ${formatField(analysis.confidence)}\n\n`;
        });
      }
      
      // 如果只有聊天记录，没有生活照
      if (chatAnalyses.length > 0 && photoAnalyses.length === 0) {
        materialPackage += `\n【重要提示】:\n咨询者只提供了聊天记录截图，没有提供生活照。\n在最终报告中，请不要生成[生活照分析]区块，只基于聊天记录和个人简介进行分析。\n\n`;
      }
      
      // 如果只有生活照，没有聊天记录
      if (photoAnalyses.length > 0 && chatAnalyses.length === 0) {
        materialPackage += `\n【重要提示】:\n咨询者只提供了生活照，没有提供聊天记录截图。\n在最终报告中，请不要生成[聊天记录分析]区块，只基于生活照和个人简介进行分析。\n\n`;
      }
      
    } else {
      materialPackage += `\n【重要提示】:\n咨询者没有提供任何有效的图片文件。\n请不要分析"生活照"或"聊天记录截图"。\n所有分析应仅基于提供的文字信息。\n在最终报告的key_findings中，如果没有对应的信息来源，请完全不要生成对应的分析区块。\n\n`;
    }
  } else {
    materialPackage += `\n【重要提示】:\n咨询者没有提供任何图片文件。\n请不要分析"生活照"或"聊天记录截图"。\n所有分析应仅基于提供的文字信息。\n在最终报告的key_findings中，如果没有对应的信息来源，请完全不要生成对应的分析区块。\n\n`;
  }

  materialPackage += `请基于上述专业背景知识对以上用户信息进行深度分析。`;

  console.log('✅ 用户材料包构建完成，总长度:', materialPackage.length, '字符');
  console.log('📄 用户材料包预览:');
  console.log(materialPackage.substring(0, 300) + '...');
  
  return materialPackage;
};

// 构建最终参考材料包（向后兼容，保留原函数）
const buildMaterialPackage = (userInfo, imageAnalyses, ragKnowledge) => {
  console.log('📦 构建最终参考材料包...');
  
  let materialPackage = `【用户提供的信息如下】:

基本信息：
- 昵称：${userInfo.nickname || '未提供'}
- 职业：${userInfo.profession || '未提供'}
- 年龄：${userInfo.age || '未提供'}

个人简介或聊天记录：
${userInfo.bioOrChatHistory || '未提供相关信息'}

`;

  // 添加图片分析结果
  if (imageAnalyses && imageAnalyses.length > 0) {
    materialPackage += `\n【多模态图片分析结果】:\n`;
    imageAnalyses.forEach((analysis, index) => {
      materialPackage += `图片${index + 1} (${analysis.filename || '未知文件'}):\n`;
      materialPackage += `- 图片类型: ${analysis.image_type || '未知'}\n`;
      materialPackage += `- 分析内容: ${analysis.content_analysis || analysis.visual_cues || '无分析内容'}\n`;
      materialPackage += `- 提取文字: ${analysis.extracted_text || '无文字内容'}\n`;
      materialPackage += `- 可信度: ${analysis.confidence || '未知'}\n\n`;
    });
  }

  // 添加RAG专业知识库检索结果
  if (ragKnowledge && ragKnowledge.trim().length > 10) {
    materialPackage += `\n【专业知识库检索结果】:\n`;
    materialPackage += ragKnowledge.substring(0, 1000); // 限制长度避免超出token限制
    if (ragKnowledge.length > 1000) {
      materialPackage += '\n...(知识库内容已截断)';
    }
    materialPackage += '\n\n';
  } else {
    materialPackage += `\n【专业知识库检索结果】:\n暂无专业知识库检索结果，请基于基础心理学和社交动态理论进行分析。\n\n`;
  }

  console.log('✅ 材料包构建完成，总长度:', materialPackage.length, '字符');
  console.log('📄 材料包预览:');
  console.log(materialPackage.substring(0, 300) + '...');
  
  return materialPackage;
};

// 生成备用报告
const generateFallbackReport = () => {
  console.log('🎭 生成备用分析报告...');
  
  return {
    risk_level: "中等风险",
    key_findings: {
      system_status: "深度分析系统暂时不可用，使用备用分析逻辑",
      basic_analysis: "已对提供的基本信息进行初步评估，建议保持谨慎态度"
    },
    final_suggestion: "由于深度分析系统暂时不可用，建议在交往过程中多观察对方的行为模式，注意是否存在不一致或令人担忧的迹象。如需专业建议，请咨询情感专家。",
    confidence_level: "低",
    note: "本报告为系统备用分析，建议稍后重试以获取更准确的评估"
  };
};

// ===== 异步处理核心函数 =====
const processAnalysisTask = async (taskId, userInfo, uploadedFiles) => {
  const startTime = Date.now();
  let imageAnalyses = [];
  let ragKnowledge = null;
  let finalReport = null;
  
  try {
    updateTaskStatus(taskId, TaskStatus.PROCESSING, '开始数据验证', 10);
    
    // ========== 第1步：接收并验证输入数据 ==========
    console.log(`\n📋 任务 ${taskId} - 第1步：接收并验证输入数据`);
    
    // 验证必要信息
    if (!userInfo.nickname.trim()) {
      throw new Error('昵称不能为空，这是进行情感安全分析的基础信息');
    }
    
    updateTaskStatus(taskId, TaskStatus.PROCESSING, '输入数据验证完成', 20);
    
    // ========== 第2步：智能图片分析（分类+专项分析）==========
    console.log(`\n🎨 任务 ${taskId} - 第2步：智能图片分析（分类+专项分析）`);
    
    // 检查是否真的有有效的图片文件
    const validImageFiles = uploadedFiles.filter(file => {
      return file && file.path && fs.existsSync(file.path) && file.size > 0;
    });
    
    if (validImageFiles.length > 0) {
      updateTaskStatus(taskId, TaskStatus.PROCESSING, `分析 ${validImageFiles.length} 张图片`, 30);
      
      for (let i = 0; i < validImageFiles.length; i++) {
        const file = validImageFiles[i];
        const progress = 30 + Math.round((i / validImageFiles.length) * 20);
        updateTaskStatus(taskId, TaskStatus.PROCESSING, `处理第 ${i + 1}/${validImageFiles.length} 张图片`, progress);
        
        try {
          // 步骤1：图片分类
          const classification = await classifyImageWithGPT4o(file.path, file.filename);
          
          if (!classification.success) {
            throw new Error(`图片分类失败: ${classification.error}`);
          }
          
          // 步骤2：根据分类进行专项分析
          let analysis;
          if (classification.classification === 'chat') {
            analysis = await analyzeChatImageWithGPT4o(file.path, file.filename);
          } else if (classification.classification === 'photo') {
            analysis = await analyzePhotoImageWithGPT4o(file.path, file.filename);
          } else {
            analysis = await analyzeImageWithGPT4o(file.path, file.filename);
            analysis.analysis_type = 'unknown';
          }
          
          // 步骤3：整合分析结果
          analysis.classification = classification.classification;
      imageAnalyses.push(analysis);
      
        } catch (imageError) {
          console.error(`   ❌ 图片分析失败: ${imageError.message}`);
          imageAnalyses.push({
            filename: file.filename,
            classification: 'error',
            analysis_type: 'error',
            extracted_conversations: `图片分析失败: ${imageError.message}`,
            scene_description: '分析不可用',
            confidence: '低',
            success: false,
            error: imageError.message
          });
        }
        
        // 清理临时文件
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupError) {
          console.warn(`   ⚠️ 清理文件失败: ${file.filename}`);
        }
      }
    } else {
      updateTaskStatus(taskId, TaskStatus.PROCESSING, '无图片需要分析', 50);
    }
    
    // ========== 第3步：AI查询扩展（解决检索偏见）==========
    console.log(`\n🔍 任务 ${taskId} - 第3步：AI查询扩展（解决检索偏见）`);
    updateTaskStatus(taskId, TaskStatus.PROCESSING, 'AI查询优化中', 55);
    
    let enhancedQuery = null;
    let queryOptimizationResult = null;
    
    try {
      queryOptimizationResult = await enhanceQueryWithAI(userInfo, imageAnalyses);
      
      if (queryOptimizationResult.success) {
        enhancedQuery = queryOptimizationResult.enhanced_query;
        console.log('✅ AI查询扩展成功');
        console.log(`📊 优化统计: 原始${queryOptimizationResult.optimization_stats.original_length}字符 → 扩展${queryOptimizationResult.optimization_stats.enhanced_length}字符 (扩展比例: ${queryOptimizationResult.optimization_stats.expansion_ratio}x)`);
        console.log(`🔧 Token消耗: ${queryOptimizationResult.token_usage}`);
      } else {
        console.warn('⚠️ AI查询扩展失败，使用原始查询:', queryOptimizationResult.error);
        enhancedQuery = queryOptimizationResult.enhanced_query; // 使用备用查询
      }
    } catch (enhanceError) {
      console.error('❌ AI查询扩展过程异常:', enhanceError.message);
      enhancedQuery = userInfo.bioOrChatHistory || `${userInfo.nickname} ${userInfo.profession} 情感安全分析`;
    }
    
    updateTaskStatus(taskId, TaskStatus.PROCESSING, 'AI查询优化完成', 58);
    
    // ========== 第4步：执行RAG知识库检索 ==========
    console.log(`\n🧠 任务 ${taskId} - 第4步：执行RAG知识库检索`);
    updateTaskStatus(taskId, TaskStatus.PROCESSING, 'RAG知识库检索中', 60);
    
    if (ragSystemReady) {
      try {
        ragKnowledge = await callRAGSystem(userInfo, imageAnalyses, enhancedQuery);
      } catch (ragError) {
        console.warn(`⚠️ RAG检索失败: ${ragError.message}`);
        ragKnowledge = generateFallbackReport();
      }
    } else {
      ragKnowledge = generateFallbackReport();
    }
    
    updateTaskStatus(taskId, TaskStatus.PROCESSING, 'RAG知识检索完成', 70);
    
    // ========== 第5步：执行最终综合分析 ==========
    console.log(`\n📝 任务 ${taskId} - 第5步：执行最终综合分析`);
    updateTaskStatus(taskId, TaskStatus.PROCESSING, '最终分析生成中', 80);
    
    try {
      finalReport = await generateFinalReportWithGPT4o(userInfo, imageAnalyses, ragKnowledge);
    } catch (finalError) {
      console.error(`❌ 最终分析失败: ${finalError.message}`);
      finalReport = generateFallbackReport();
    }
    
    // ========== 第6步：构建最终响应 ==========
    console.log(`\n🎊 任务 ${taskId} - 第6步：构建最终响应`);
    updateTaskStatus(taskId, TaskStatus.PROCESSING, '构建最终响应', 90);
    
    const processingTime = Date.now() - startTime;
    
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      processing_time: `${processingTime}ms`,
      
      // 用户输入信息
      user_info: userInfo,
      
      // 智能分类图片分析结果
      image_analyses: imageAnalyses.map(analysis => ({
        filename: analysis.filename,
        classification: analysis.classification,
        analysis_type: analysis.analysis_type,
        // 聊天记录特定字段
        extracted_conversations: analysis.extracted_conversations,
        communication_patterns: analysis.communication_patterns,
        emotional_indicators: analysis.emotional_indicators,
        // 生活照特定字段
        scene_description: analysis.scene_description,
        person_analysis: analysis.person_analysis,
        lifestyle_indicators: analysis.lifestyle_indicators,
        notable_details: analysis.notable_details,
        safety_assessment: analysis.safety_assessment,
        // 通用字段
        red_flags: analysis.red_flags,
        overall_assessment: analysis.overall_assessment,
        confidence: analysis.confidence,
        success: analysis.success,
        error: analysis.error
      })),
      
      // AI查询扩展结果
      query_optimization: queryOptimizationResult || {
        success: false,
        error: "查询优化未执行",
        original_query: userInfo.bioOrChatHistory || '',
        enhanced_query: userInfo.bioOrChatHistory || '',
        token_usage: 0,
        optimization_stats: { original_length: 0, enhanced_length: 0, expansion_ratio: 1.0 }
      },
      
      // RAG知识检索结果
      rag_knowledge: ragKnowledge,
      
      // 最终分析报告
      final_report: finalReport,
      
      // 系统信息
      system_info: {
        version: "4.1 - AI查询扩展版",
        analysis_engine: "AI情感安全助理 异步分析系统",
        models_used: {
          image_classification: "OpenAI GPT-4o (图片分类)",
          chat_analysis: "OpenAI GPT-4o (聊天记录OCR专项)",
          photo_analysis: "OpenAI GPT-4o (生活照视觉专项)",
          query_enhancement: "OpenAI GPT-4o (AI查询扩展)",
          knowledge_retrieval: "OpenAI Embeddings + 向量检索",
          final_analysis: "OpenAI GPT-4o (情感安全专家)"
        },
        processing_mode: "异步后台处理",
        task_id: taskId,
        new_features: ["AI查询扩展（解决RAG检索偏见）"]
      },
      
      // 分析统计
      analysis_stats: {
        images_processed: imageAnalyses.length,
        images_successful: imageAnalyses.filter(a => a.success).length,
        query_optimization_success: queryOptimizationResult?.success || false,
        query_enhancement_token_usage: queryOptimizationResult?.token_usage || 0,
        rag_status: ragSystemReady ? 'active' : 'fallback',
        final_analysis_status: finalReport ? 'success' : 'fallback',
        total_processing_time: processingTime
      }
    };
    
    setTaskResult(taskId, response);
    console.log(`\n🎊 任务 ${taskId} - AI情感安全分析完成，处理时间: ${processingTime}ms`);
    
  } catch (error) {
    console.error(`\n❌ 任务 ${taskId} - 分析流程发生错误:`, error.message);
    
    // 清理可能的临时文件
    if (uploadedFiles) {
      uploadedFiles.forEach(file => {
        try {
          if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.warn(`⚠️ 清理临时文件失败: ${file.filename}`);
        }
      });
    }
    
    setTaskError(taskId, error);
  }
};

// API路由

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 静态文件服务
app.use(express.static('public'));

// 主要API端点 - 生成警告报告（异步任务模式）
app.post('/api/generate_warning_report', upload.array('images', 10), async (req, res) => {
  console.log('\n🚀 ===== AI情感安全助理异步分析任务启动 =====');
  console.log('📨 收到分析任务创建请求');
  
  // 添加详细的请求解析日志
  console.log('🔍 ===== 前端数据接收详细日志 =====');
  console.log('📡 请求信息:');
  console.log(`   方法: ${req.method}`);
  console.log(`   路径: ${req.path}`);
  console.log(`   Content-Type: ${req.headers['content-type']}`);
  console.log(`   Content-Length: ${req.headers['content-length']}`);
  console.log(`   用户代理: ${req.headers['user-agent']?.substring(0, 50)}...`);
  
  console.log('📝 FormData 文本字段解析:');
  const textFields = ['nickname', 'profession', 'age', 'bioOrChatHistory', 'analysis_context'];
  textFields.forEach(field => {
    const value = req.body[field];
    if (value !== undefined) {
      console.log(`   ✅ ${field}: "${value}" (长度: ${value.length})`);
    } else {
      console.log(`   ⚠️ ${field}: 未提供`);
    }
  });
  
  console.log('📎 FormData 文件字段解析:');
  console.log(`   req.files 类型: ${Array.isArray(req.files) ? 'Array' : typeof req.files}`);
  console.log(`   req.files 长度: ${req.files?.length || 0}`);
  
  if (req.files && req.files.length > 0) {
    console.log('📁 接收到的文件详情:');
    req.files.forEach((file, index) => {
      console.log(`   文件 ${index + 1}:`);
      console.log(`     fieldname: ${file.fieldname}`);
      console.log(`     originalname: ${file.originalname}`);
      console.log(`     filename: ${file.filename}`);
      console.log(`     mimetype: ${file.mimetype}`);
      console.log(`     size: ${file.size} bytes (${Math.round(file.size / 1024)}KB)`);
      console.log(`     path: ${file.path}`);
      console.log(`     文件存在: ${fs.existsSync(file.path) ? '✅' : '❌'}`);
      
      // 验证文件实际大小
      if (fs.existsSync(file.path)) {
        const stats = fs.statSync(file.path);
        console.log(`     磁盘文件大小: ${stats.size} bytes`);
        console.log(`     大小匹配: ${stats.size === file.size ? '✅' : '❌'}`);
      }
    });
  } else {
    console.log('⚠️ 没有接收到任何文件');
  }
  
  // 验证multer处理状态
  console.log('🔧 Multer 处理状态:');
  console.log(`   req.body 存在: ${!!req.body ? '✅' : '❌'}`);
  console.log(`   req.files 存在: ${!!req.files ? '✅' : '❌'}`);
  console.log(`   req.file 存在: ${!!req.file ? '✅' : '❌'} (应该为false，因为使用array)`);
  
  // 检查是否有multer错误
  if (req.fileValidationError) {
    console.error(`❌ Multer 文件验证错误: ${req.fileValidationError}`);
  }
  
  console.log('✅ ===== 前端数据接收验证完成 =====\n');
  
  try {
    // ========== 快速验证输入数据 ==========
    console.log('📋 快速验证用户输入...');
    
    const userInfo = {
      nickname: req.body.nickname || '',
      profession: req.body.profession || '',
      age: req.body.age || '',
      bioOrChatHistory: req.body.bioOrChatHistory || ''
    };
    
    console.log('👤 用户基本信息:');
    console.log(`   昵称: "${userInfo.nickname}"`);
    console.log(`   职业: "${userInfo.profession}"`);
    console.log(`   年龄: "${userInfo.age}"`);
    console.log(`   个人简介/聊天记录: ${userInfo.bioOrChatHistory.length} 字符`);
    
    // 验证必要信息
    if (!userInfo.nickname.trim()) {
      console.error('❌ 验证失败: 昵称不能为空');
      return res.status(400).json({
        success: false,
        error: '昵称不能为空，这是进行情感安全分析的基础信息',
        timestamp: new Date().toISOString()
      });
    }
    
    const uploadedFiles = req.files || [];
    console.log(`🖼️ 上传的图片文件: ${uploadedFiles.length} 张`);
    
    if (uploadedFiles.length > 0) {
      uploadedFiles.forEach((file, index) => {
        console.log(`   图片 ${index + 1}: ${file.originalname} (${Math.round(file.size / 1024)}KB, ${file.mimetype})`);
      });
    }
    
    console.log('✅ 输入数据验证通过');
    
    // ========== 创建异步任务 ==========
    console.log('\n📝 创建异步分析任务...');
    
    const taskId = createTask({
      userInfo,
      filesCount: uploadedFiles.length,
      submittedAt: new Date().toISOString()
    });
    
    // 估算处理时间
    const estimatedTime = Math.max(30, uploadedFiles.length * 20 + 60); // 基础30秒 + 每张图20秒 + RAG 60秒
    
    console.log(`✅ 任务创建成功: ${taskId}`);
    console.log(`⏰ 预计处理时间: ${estimatedTime} 秒`);
    
    // 立即返回任务ID给前端
    const response = {
      success: true,
      task_id: taskId,
      message: '分析任务已创建，正在后台处理',
      estimated_time: `${estimatedTime} 秒`,
      status_check_url: `/api/report_status/${taskId}`,
      timestamp: new Date().toISOString(),
      system_info: {
        version: "4.0 - 异步任务处理版",
        processing_mode: "异步后台处理",
        task_management: "实时状态跟踪"
      }
    };
    
    console.log('🎉 立即响应已发送给前端');
    console.log(`📊 响应时间: ${new Date().toISOString()}`);
    console.log(`🔗 状态查询地址: /api/report_status/${taskId}`);
    
    res.json(response);
    
    // ========== 启动后台异步处理 ==========
    console.log('\n🔄 启动后台异步分析任务...');
    
    // 使用 setImmediate 确保响应先发送
    setImmediate(async () => {
      console.log(`📋 开始处理任务: ${taskId}`);
      try {
        await processAnalysisTask(taskId, userInfo, uploadedFiles);
        console.log(`✅ 任务处理完成: ${taskId}`);
      } catch (error) {
        console.error(`❌ 任务处理失败: ${taskId}`, error.message);
      }
    });
    
  } catch (error) {
    console.error('\n❌ ===== 任务创建失败 =====');
    console.error('错误信息:', error.message);
    console.error('错误详情:', error.stack);
    
    // 清理可能的临时文件
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`🗑️ 清理临时文件: ${file.filename}`);
        } catch (cleanupError) {
          console.warn(`⚠️ 清理临时文件失败: ${file.filename}`);
        }
      });
    }
    
    // 返回错误响应
    const errorResponse = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      system_info: {
        version: "4.0 - 异步任务处理版",
        error_handling: "任务创建失败",
        recovery_suggestions: [
          "检查输入数据格式",
          "验证图片文件格式",
          "稍后重试请求"
        ]
      }
    };
    
    res.status(500).json(errorResponse);
  }
});

// 健康检查API
app.get('/api/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0 - OpenAI统一版',
    system_status: {
      openai_client: 'ready',
      openai_configured: !!process.env.OPENAI_API_KEY,
      openai_base_url: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
    rag_system: ragSystemReady ? 'ready' : 'not_ready',
      multimodal_analysis: 'enabled',
      gpt4_brain: 'enabled',
      analysis_provider: 'OpenAI GPT-4o'
    },
    capabilities: {
      image_analysis: true,
      text_analysis: true,
      rag_knowledge: ragSystemReady,
      final_report: true
    },
    environment: {
      node_version: process.version,
      openai_configured: !!process.env.OPENAI_API_KEY
    }
  };
  
  res.json(health);
});

// RAG系统状态检查
app.get('/api/rag-status', (req, res) => {
  const storagePath = path.join(__dirname, 'storage');
  const indexFile = path.join(storagePath, 'index_store.json');
  
  let indexStats = null;
  try {
    if (fs.existsSync(indexFile)) {
      const stats = fs.statSync(indexFile);
      indexStats = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    }
  } catch (error) {
    console.warn('获取索引文件信息失败:', error.message);
  }
  
  res.json({
    rag_system_ready: ragSystemReady,
    storage_path: storagePath,
    index_file: indexFile,
    index_exists: fs.existsSync(indexFile),
    index_stats: indexStats,
    timestamp: new Date().toISOString()
  });
});

// 独立图片分析测试端点
app.post('/api/test_image_analysis', upload.single('image'), async (req, res) => {
  console.log('🧪 ===== 图片分析独立测试开始 =====');
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请上传一张图片文件'
      });
    }
    
    console.log('📝 测试输入验证:');
    console.log('   上传文件数量:', req.file ? 1 : 0);
    
    console.log('🎯 开始图片分析测试...');
    console.log('🔄 测试分析图片:', req.file.filename);
    
    // 调用图片分析函数
    const analysis = await analyzeImageWithGPT4o(req.file.path, req.file.filename);
    
    console.log('   ✅ 图片分析完成:', req.file.filename);
    console.log('   📊 图片类型:', analysis.image_type);
    console.log('   🎯 分析可信度:', analysis.confidence);
    console.log('   📄 成功状态:', analysis.success);
    
    if (!analysis.success && analysis.error) {
      console.log('   ❌ 分析错误:', analysis.error);
    }
    
    // 清理临时文件
    try {
      fs.unlinkSync(req.file.path);
      console.log('🗑️ 已清理临时文件:', req.file.filename);
    } catch (cleanupError) {
      console.warn(`⚠️ 清理临时文件失败: ${req.file.filename}`);
    }
    
    // 返回测试结果
  res.json({
    success: true,
      test_type: 'image_analysis_only',
      timestamp: new Date().toISOString(),
      analysis: analysis,
      system_info: {
        version: "2.0 - OpenAI统一版",
        analysis_engine: "OpenAI GPT-4o",
        model_used: "gpt-4o"
      }
    });
    
  } catch (error) {
    console.error('❌ 图片分析测试失败:', error.message);
    
    // 清理临时文件
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn(`⚠️ 清理临时文件失败: ${req.file.filename}`);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      test_type: 'image_analysis_only'
    });
  }
});

// 新API端点 - 查询任务状态和结果
app.get('/api/report_status/:taskId', (req, res) => {
  const { taskId } = req.params;
  
  console.log(`🔍 查询任务状态: ${taskId}`);
  
  const task = getTask(taskId);
  
  if (!task) {
    console.warn(`⚠️ 任务不存在: ${taskId}`);
    return res.status(404).json({
      success: false,
      error: '任务不存在或已过期',
      task_id: taskId,
      timestamp: new Date().toISOString()
    });
  }
  
  const response = {
    success: true,
    task_id: taskId,
    status: task.status,
    progress: task.progress,
    current_step: task.current_step,
    created_at: task.created_at,
    updated_at: task.updated_at,
    timestamp: new Date().toISOString()
  };
  
  // 如果任务完成，包含完整结果
  if (task.status === TaskStatus.COMPLETED && task.result) {
    response.completed = true;
    response.result = task.result;
    response.processing_time = task.processing_time;
    console.log(`✅ 返回完成任务结果: ${taskId}`);
  }
  // 如果任务失败，包含错误信息
  else if (task.status === TaskStatus.FAILED) {
    response.completed = true;
    response.failed = true;
    response.error = task.error;
    response.processing_time = task.processing_time;
    
    // 提供备用分析报告
    response.fallback_report = generateFallbackReport();
    console.log(`❌ 返回失败任务信息: ${taskId}`);
  }
  // 如果任务进行中，返回进度信息
  else {
    response.completed = false;
    response.message = task.current_step || '任务处理中...';
    console.log(`📊 返回任务进度: ${taskId} - ${task.progress}% - ${task.current_step}`);
  }
  
  res.json(response);
});

// 启动服务器并设置全局超时
const server = app.listen(PORT, () => {
  console.log('🔧 ===== 增强图片分析模块 =====');
  console.log('🔍 检查系统配置...');
  console.log('✅ OpenAI GPT-4o客户端初始化完成');
  console.log(`🔗 API地址: ${openai.baseURL}`);
  console.log('✅ RAG系统索引已就绪');
  console.log('🚀 AI情感安全助理 API服务器已启动');
  console.log(`📡 服务地址: http://localhost:${PORT}`);
  console.log(`🔗 API端点: http://localhost:${PORT}/api/generate_warning_report`);
  console.log(`🎯 约会后复盘: http://localhost:${PORT}/api/post_date_debrief`);
  console.log(`💊 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`🧠 RAG状态: http://localhost:${PORT}/api/rag-status`);
  console.log('📊 系统状态检查:');
  console.log('✅ RAG知识库系统: 已就绪');
  console.log('✅ OpenAI GPT-4o大脑: 已激活');
  console.log('✅ 多模态分析: 已启用 (via OpenAI)');
  console.log('✅ 音频转录: 已集成 (OpenAI Whisper)');
  console.log('✅ 情感教练: 已激活');
  console.log('🎯 AI助理核心能力 (v4.4完整版):');
  console.log('   🔍 智能图片分类器 (自动识别聊天记录 vs 生活照)');
  console.log('   💬 聊天记录专项分析 (OCR提取 + 对话模式识别 + 红旗检测)');
  console.log('   📸 生活照专项分析 (场景识别 + 人物分析 + 安全评估)');
  console.log('   🧠 OpenAI GPT-4o最终报告生成器 (顶级两性关系分析师)');
  console.log('   📚 RAG专业知识检索 (红药丸理论、Jordan Peterson、Sadia Khan)');
  console.log('   🛡️ 情感安全风险评估 (PUA行为识别、操控模式检测)');
  console.log('   📋 精准结构化报告 (只分析实际提供信息，避免分析幻觉)');
  console.log('   🎙️ 音频输入支持 (Whisper转录，25MB限制)');
  console.log('   🤖 情感教练服务 (约会后复盘，专业建议)');
  console.log('   💾 对话历史管理 (20轮对话记忆)');
  console.log('🎊 v4.4完整版系统已全面激活！');
  console.log('🚀 功能覆盖：约会前预警 + 约会后复盘 + 音频交互 + 专业教练');
  console.log('✨ 系统特点：无分析幻觉、针对性强、准确性高、专业指导！');
  console.log('🎯 ===== 昭妖镜AI情感安全助理 - 完整生态系统启动成功 =====');
});

// 设置服务器全局超时时间为300秒（5分钟）
server.timeout = 300000; // 300秒
server.keepAliveTimeout = 300000; // 300秒
server.headersTimeout = 300000; // 300秒

console.log('⏰ 服务器超时配置已更新:');
console.log('   Request Timeout: 300秒 (5分钟)');
console.log('   Keep-Alive Timeout: 300秒 (5分钟)');  
console.log('   Headers Timeout: 300秒 (5分钟)');
console.log('   RAG查询超时: 300秒 (5分钟)');
console.log('   情感教练RAG超时: 300秒 (5分钟)');
console.log('✅ 所有超时配置已延长至5分钟，支持复杂AI分析任务');

// ===== 约会后复盘功能模块 =====

// 🎧 音频转录函数 - 使用Replicate Whisper（内存流处理版）
const transcribeAudioWithWhisper = async (audioBuffer, filename) => {
  console.log(`🎧 开始音频转录（内存流模式）: ${filename}`);
  console.log(`📊 音频数据大小: ${(audioBuffer.length / (1024 * 1024)).toFixed(2)}MB`);
  
  try {
    // 第1步：验证Replicate API配置
    console.log('🔍 第1步：验证Replicate API配置...');
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new Error('REPLICATE_API_TOKEN环境变量未设置');
    }
    
    const apiTokenMasked = process.env.REPLICATE_API_TOKEN.substring(0, 7) + '...' + process.env.REPLICATE_API_TOKEN.slice(-4);
    console.log(`✅ API Token已配置: ${apiTokenMasked}`);
    
    // 第2步：验证音频数据
    console.log('🔍 第2步：验证音频数据...');
    const fileSizeInMB = audioBuffer.length / (1024 * 1024);
    
    if (audioBuffer.length === 0) {
      throw new Error('音频数据为空（0字节）');
    }
    
    if (fileSizeInMB > 25) {
      throw new Error(`音频文件过大: ${fileSizeInMB.toFixed(2)}MB，超过25MB限制`);
    }
    
    console.log(`✅ 音频数据验证通过: ${fileSizeInMB.toFixed(2)}MB`);
    
    // 第3步：验证音频文件格式
    console.log('🔍 第3步：验证音频格式...');
    const fileExtension = path.extname(filename).toLowerCase();
    const supportedFormats = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac'];
    
    if (!supportedFormats.includes(fileExtension)) {
      throw new Error(`不支持的音频格式: ${fileExtension}。支持的格式: ${supportedFormats.join(', ')}`);
    }
    console.log(`✅ 音频格式验证通过: ${fileExtension}`);
    
    // 第4步：初始化Replicate客户端
    console.log('🔍 第4步：初始化Replicate客户端...');
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN
    });
    
    // 第5步：直接调用 Replicate Whisper API（使用内存Buffer）
    console.log('🔍 第5步：调用 Replicate Whisper API（内存流模式）...');
    console.log('📤 API调用参数:');
    console.log(`   - model: openai/whisper:large-v3`);
    console.log(`   - language: zh`);
    console.log(`   - provider: Replicate`);
    console.log(`   - file: ${filename} (${fileSizeInMB.toFixed(2)}MB)`);
    console.log(`   - 处理模式: 内存流（无磁盘文件）`);
    
    const startTime = Date.now();
    
    // 直接使用Buffer数据调用Replicate API
    const output = await replicate.run(
      "openai/whisper:large-v3",
      {
        input: {
          audio: audioBuffer, // 直接传递Buffer数据
          model: "large-v3",
          language: "zh",
          temperature: 0.0,
          suppress_tokens: "-1",
          initial_prompt: "",
          condition_on_previous_text: true,
          word_timestamps: true
        }
      }
    );
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    // 第6步：解析转录结果
    console.log('🔍 第6步：解析转录结果...');
    
    let transcriptionText = "";
    let segments = [];
    
    if (typeof output === 'object' && output !== null) {
      // 获取主要转录文本
      transcriptionText = output.text || "";
      
      // 如果主要文本为空，尝试从segments中拼接
      if (!transcriptionText && output.segments && Array.isArray(output.segments)) {
        transcriptionText = output.segments
          .map(segment => (segment.text || "").trim())
          .filter(text => text.length > 0)
          .join(" ");
      }
      
      // 获取分段信息
      if (output.segments && Array.isArray(output.segments)) {
        segments = output.segments.map(segment => ({
          id: segment.id || 0,
          start: segment.start || 0.0,
          end: segment.end || 0.0,
          text: segment.text || "",
          tokens: segment.tokens || [],
          temperature: segment.temperature || 0.0,
          avg_logprob: segment.avg_logprob || 0.0,
          compression_ratio: segment.compression_ratio || 0.0,
          no_speech_prob: segment.no_speech_prob || 0.0
        }));
      }
    } else if (typeof output === 'string') {
      transcriptionText = output;
    }
    
    // 验证转录结果
    if (!transcriptionText || transcriptionText.trim().length === 0) {
      throw new Error('转录文本为空或无效');
    }
    
    console.log(`✅ 音频转录完成: ${filename}`);
    console.log(`📝 转录文本长度: ${transcriptionText.length} 字符`);
    console.log(`📄 转录文本预览: ${transcriptionText.substring(0, 100)}${transcriptionText.length > 100 ? '...' : ''}`);
    console.log(`⏱️ 处理时间: ${processingTime.toFixed(2)} 秒`);
    console.log(`🎭 分段数量: ${segments.length}`);
    console.log(`🔥 内存流处理完成，无临时文件生成`);
    
    // 返回成功结果
    return {
      success: true,
      transcription: transcriptionText,
      filename: filename,
      file_size_mb: parseFloat(fileSizeInMB.toFixed(2)),
      processing_time: processingTime,
      segments: segments,
      api_model: 'openai/whisper:large-v3',
      provider: 'Replicate',
      language: 'zh',
      processing_mode: 'memory_stream', // 标识内存流处理模式
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`❌ 音频转录失败: ${filename}`);
    console.error('错误详情:', error.message);
    console.error('错误类型:', error.constructor.name);
    
    // 返回详细的错误信息
    return {
      success: false,
      error: error.message,
      error_type: error.constructor.name,
      filename: filename,
      processing_mode: 'memory_stream',
      timestamp: new Date().toISOString(),
      troubleshooting: {
        'Connection Error': '请检查网络连接和REPLICATE_API_TOKEN设置',
        'Authentication Error': '请检查REPLICATE_API_TOKEN是否正确',
        'File Error': '请检查音频数据是否完整且格式正确',
        'Size Error': '请确保音频文件小于25MB',
        'Format Error': '请使用支持的音频格式（mp3, wav, m4a等）',
        'Buffer Error': '音频数据在内存中处理失败，请检查数据完整性'
      }
    };
  }
};

// 🧠 情感教练RAG检索 - 专门用于约会后复盘
const callPostDateRAGSystem = async (userQuestion, conversationHistory = []) => {
  console.log('🧠 开始情感教练RAG检索...');
  
  try {
    // 构建适配现有RAG系统的数据格式
    const ragInputData = {
      user_input: {
        nickname: "咨询用户",
        profession: "未知",
        age: "未知",
        bio: userQuestion, // 将用户问题作为bio字段
        bioOrChatHistory: userQuestion
      },
      image_analysis: [], // 约会后复盘不涉及图片分析
      user_info: {
        nickname: "咨询用户",
        profession: "未知", 
        age: "未知",
        bio: userQuestion,
        bioOrChatHistory: userQuestion
      },
      image_infos: [],
      diagnostic_mode: process.env.RAG_DIAGNOSTIC_MODE === 'true' || false  // 支持诊断模式
    };
    
    console.log('📤 发送给RAG系统的查询:');
    console.log('   用户问题长度:', userQuestion.length);
    console.log('   对话历史长度:', conversationHistory.length);
    console.log('   查询类型: post_date_debrief_diversity');
    
    // 调用增强版Python RAG系统，使用多样性强制检索机制
    const ragProcess = spawn('python', ['rag_query_service_enhanced.py', JSON.stringify(ragInputData)], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 设置超时
    const timeout = setTimeout(() => {
      ragProcess.kill();
      console.error('⏰ 情感教练RAG查询超时（300秒）');
    }, 300000); // 300秒超时（5分钟）
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      ragProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ragProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ragProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log('🐍 RAG进程结束，退出码:', code);
        
        // 在诊断模式下，即使成功也打印stderr中的诊断信息
        if (process.env.RAG_DIAGNOSTIC_MODE === 'true' && stderr.trim()) {
          console.log('🔬 RAG诊断信息:');
          console.log(stderr);
        }
        
        if (code !== 0) {
          console.error('RAG进程错误输出:', stderr);
          reject(new Error(`RAG进程异常退出: ${code}`));
          return;
        }
        
        try {
          console.log('📥 RAG原始输出 (前100字符):', stdout.substring(0, 100));
          const ragResult = JSON.parse(stdout);
          
          console.log('✅ 情感教练RAG分析完成');
          console.log('📊 RAG分析详情:');
          console.log('   状态:', ragResult.success ? 'active' : 'error');
          
          if (ragResult.success && ragResult.data && ragResult.data.rag_analysis) {
            console.log('   检索到文档数:', ragResult.data.rag_analysis.sources_count || 0);
            console.log('   知识回答长度:', ragResult.data.rag_analysis.knowledge_answer?.length || 0);
            
            if (ragResult.data.rag_analysis.knowledge_references && ragResult.data.rag_analysis.knowledge_references.length > 0) {
              console.log('   引用文档:');
              ragResult.data.rag_analysis.knowledge_references.forEach((source, index) => {
                console.log(`     ${index + 1}. 评分: ${source.score?.toFixed(3) || 'N/A'}, 来源: ${source.file_path || 'unknown'}`);
              });
            }
          }
          
          resolve(ragResult);
        } catch (parseError) {
          console.error('❌ 解析RAG结果失败:', parseError.message);
          reject(parseError);
        }
      });
      
      ragProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ RAG进程启动失败:', error.message);
        reject(error);
      });
    });
    
  } catch (error) {
    console.error('❌ 情感教练RAG检索失败:', error.message);
    throw error;
  }
};

// 🧠 情感教练RAG检索（支持增强查询）- 专门用于约会后复盘的AI查询扩展版本
const callPostDateRAGSystemWithEnhancedQuery = async (enhancedQuery, originalUserQuestion, conversationHistory = []) => {
  console.log('🧠 开始情感教练RAG检索（使用AI优化查询）...');
  
  try {
    // 构建适配现有RAG系统的数据格式，使用增强查询
    const ragInputData = {
      user_input: {
        nickname: "咨询用户",
        profession: "情感咨询",
        age: "未知",
        bio: enhancedQuery, // 使用AI优化后的查询
        bioOrChatHistory: enhancedQuery
      },
      image_analysis: [], // 约会后复盘不涉及图片分析
      user_info: {
        nickname: "咨询用户",
        profession: "情感咨询", 
        age: "未知",
        bio: enhancedQuery, // 使用AI优化后的查询
        bioOrChatHistory: enhancedQuery
      },
      image_infos: [],
      diagnostic_mode: process.env.RAG_DIAGNOSTIC_MODE === 'true' || false  // 支持诊断模式
    };
    
    console.log('📤 发送给RAG系统的优化查询:');
    console.log('   原始问题长度:', originalUserQuestion.length);
    console.log('   AI优化查询长度:', enhancedQuery.length);
    console.log('   查询扩展比例:', Math.round((enhancedQuery.length / originalUserQuestion.length) * 100) + '%');
    console.log('   对话历史长度:', conversationHistory.length);
    console.log('   查询类型: post_date_debrief_enhanced_diversity');
    
    // 调用增强版Python RAG系统，使用多样性强制检索机制
    const ragProcess = spawn('python', ['rag_query_service_enhanced.py', JSON.stringify(ragInputData)], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 设置超时
    const timeout = setTimeout(() => {
      ragProcess.kill();
      console.error('⏰ 情感教练RAG查询超时（300秒）');
    }, 300000); // 300秒超时（5分钟）
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      ragProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ragProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ragProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log('🐍 RAG进程结束，退出码:', code);
        
        // 在诊断模式下，即使成功也打印stderr中的诊断信息
        if (process.env.RAG_DIAGNOSTIC_MODE === 'true' && stderr.trim()) {
          console.log('🔬 RAG诊断信息:');
          console.log(stderr);
        }
        
        if (code !== 0) {
          console.error('RAG进程错误输出:', stderr);
          reject(new Error(`RAG进程异常退出: ${code}`));
          return;
        }
        
        try {
          console.log('📥 RAG原始输出 (前100字符):', stdout.substring(0, 100));
          const ragResult = JSON.parse(stdout);
          
          console.log('✅ 情感教练RAG分析完成（使用AI优化查询）');
          console.log('📊 RAG分析详情:');
          console.log('   状态:', ragResult.success ? 'active' : 'error');
          
          if (ragResult.success && ragResult.data && ragResult.data.rag_analysis) {
            console.log('   检索到文档数:', ragResult.data.rag_analysis.sources_count || 0);
            console.log('   知识回答长度:', ragResult.data.rag_analysis.knowledge_answer?.length || 0);
            
            if (ragResult.data.rag_analysis.knowledge_references && ragResult.data.rag_analysis.knowledge_references.length > 0) {
              console.log('   引用文档:');
              ragResult.data.rag_analysis.knowledge_references.forEach((source, index) => {
                console.log(`     ${index + 1}. 评分: ${source.score?.toFixed(3) || 'N/A'}, 来源: ${source.file_path || 'unknown'}`);
              });
              
              // 分析文档来源分布，检查检索偏见
              const sourceDistribution = {};
              ragResult.data.rag_analysis.knowledge_references.forEach(ref => {
                const fileName = ref.file_path ? ref.file_path.split('/').pop().replace(/\.(pdf|docx|txt)$/i, '') : 'unknown';
                sourceDistribution[fileName] = (sourceDistribution[fileName] || 0) + 1;
              });
              
              const totalRefs = ragResult.data.rag_analysis.knowledge_references.length;
              console.log('   📊 文档来源分布:');
              Object.entries(sourceDistribution)
                .sort(([,a], [,b]) => b - a)
                .forEach(([source, count]) => {
                  const percentage = (count / totalRefs * 100).toFixed(1);
                  console.log(`     ${source}: ${count}/${totalRefs} (${percentage}%)`);
                });
              
              // 评估检索偏见程度
              const maxSourcePercentage = Math.max(...Object.values(sourceDistribution)) / totalRefs * 100;
              let biasLevel = '';
              if (maxSourcePercentage >= 80) {
                biasLevel = '🔴 严重偏见';
              } else if (maxSourcePercentage >= 60) {
                biasLevel = '🟡 中等偏见';
              } else if (maxSourcePercentage >= 40) {
                biasLevel = '🟠 轻微偏见';
              } else {
                biasLevel = '🟢 均衡检索';
              }
              console.log(`   ⚖️ 偏见评估: ${biasLevel} (最高占比: ${maxSourcePercentage.toFixed(1)}%)`);
            }
          }
          
          resolve(ragResult);
        } catch (parseError) {
          console.error('❌ 解析RAG结果失败:', parseError.message);
          reject(parseError);
        }
      });
      
      ragProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ RAG进程启动失败:', error.message);
        reject(error);
      });
    });
    
  } catch (error) {
    console.error('❌ 情感教练RAG检索失败:', error.message);
    throw error;
  }
};

// 🎭 构建情感教练系统提示词 (修复版)
const createEmotionalCoachSystemPrompt = (ragResult = null) => {
  console.log('🧠 构建情感教练系统提示词...');
  
  let knowledgeSection = '';
  if (ragResult && ragResult.success && ragResult.data && ragResult.data.rag_analysis) {
    const ragAnalysis = ragResult.data.rag_analysis;
    const knowledgeAnswer = ragAnalysis.knowledge_answer || '';
    const knowledgeReferences = ragAnalysis.knowledge_references || [];
    
    console.log('📚 RAG知识内容长度:', knowledgeAnswer.length);
    console.log('📂 RAG来源数量:', knowledgeReferences.length);
    
    // 降低条件门槛，确保RAG知识能被使用
    if (knowledgeAnswer && knowledgeAnswer.length > 10) {
      knowledgeSection = `
【专业理论指导】

你拥有以下专业知识库检索结果，请务必基于这些理论来回答：

${knowledgeAnswer}

知识来源：${knowledgeReferences.map((ref, index) => 
  `${ref.file_path ? ref.file_path.split('/').pop().replace('.pdf', '').replace('.docx', '') : '专业理论'}`
).join('、')}

重要：请在分析和建议中明确体现和应用上述专业理论观点。

`;
    } else if (knowledgeReferences.length > 0) {
      knowledgeSection = `
【专业理论指导】

请基于专业两性关系理论提供科学指导。

检索文献：${knowledgeReferences.map((ref, index) => 
  `${ref.file_path ? ref.file_path.split('/').pop().replace('.pdf', '').replace('.docx', '') : '专业理论'}`
).join('、')}

`;
    }
  }
  
  if (!knowledgeSection) {
    knowledgeSection = `
【专业理论指导】

请基于心理学、两性关系理论等专业知识提供指导。

`;
  }
  
  const systemPrompt = `你是一位专业的情感教练，擅长分析约会经历和情感问题。

${knowledgeSection}

【回复要求】

1. 开头先表达理解和共情

2. 然后分段分析情况（每个关键点单独成段，段落间空行）

3. 接着提供具体建议（每条建议详细说明，段落间空行）

4. 最后给予鼓励支持

【排版要求】
- 每个段落间要有空行，让内容清晰易读
- 重要观点可以单独成行
- 不要使用过多的格式符号，保持自然的段落结构
- 确保逻辑清晰、层次分明

请用温暖专业的语调，给用户提供有深度有温度的情感指导。`;

  console.log('✅ 情感教练系统提示词构建完成，总长度:', systemPrompt.length);
  return systemPrompt;
};

// 🎭 情感教练对话生成 (修复版)
const generateCoachResponseWithGPT4o = async (conversationHistory, userQuestion, ragResult) => {
  console.log('🎭 开始生成情感教练回复...');
  
  try {
    // 构建系统提示词 (传递完整的ragResult对象)
    const systemPrompt = createEmotionalCoachSystemPrompt(ragResult);
    
    // 构建对话消息
    const messages = [
      {
        role: "system",
        content: systemPrompt
      }
    ];
    
    // 解析并添加历史对话（最近20轮）
    let parsedHistory = [];
    if (conversationHistory) {
      try {
        parsedHistory = typeof conversationHistory === 'string' 
          ? JSON.parse(conversationHistory) 
          : conversationHistory;
      } catch (parseError) {
        console.warn('⚠️ 对话历史解析失败，使用空数组');
        parsedHistory = [];
      }
    }
    
    // 确保对话历史格式正确并添加到消息数组
    const recentHistory = parsedHistory.slice(-20); // 保留最近20条消息
    recentHistory.forEach(msg => {
      if (msg && msg.content && msg.sender) {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    });
    
    // 添加用户最新问题
    messages.push({
      role: "user",
      content: userQuestion
    });
    
    console.log('📤 发送给OpenAI GPT-4o:');
    console.log('  - 系统提示词长度:', systemPrompt.length);
    console.log('  - 历史对话轮数:', recentHistory.length);
    console.log('  - 用户问题长度:', userQuestion.length);
    console.log('  - RAG知识状态:', ragResult ? '已获取' : '未获取');
    
    // 调用GPT-4o，增加max_tokens以获得更完整的回复
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7,
      frequency_penalty: 0.1,
      presence_penalty: 0.1
    });
    
    let response = completion.choices[0].message.content;
    
    // 格式化回复，优化排版
    response = formatCoachResponse(response);
    
    console.log('✅ 情感教练回复生成完成');
    console.log('📝 回复长度:', response.length);
    console.log('🎯 使用模型:', completion.model);
    console.log('📊 Token消耗:', completion.usage?.total_tokens || 'N/A');
    
    return {
      success: true,
      response: response,
      model_used: completion.model,
      tokens_used: completion.usage?.total_tokens || 0,
      finish_reason: completion.choices[0].finish_reason
    };
    
  } catch (error) {
    console.error('❌ 情感教练回复生成失败:', error.message);
    return {
      success: false,
      error: error.message,
      fallback_response: "很抱歉，我暂时无法为您提供专业建议。请稍后再试，或者尝试重新描述您的问题。"
    };
  }
};

// 📝 格式化情感教练回复 (简化版)
const formatCoachResponse = (response) => {
  console.log('📝 轻量优化回复格式...');
  
  // 最小化处理，主要保持AI的原始结构
  let formatted = response
    .replace(/\n{4,}/g, '\n\n\n')    // 限制过多连续换行（超过4个换行符改为3个）
    .trim();
  
  console.log('✅ 回复格式优化完成');
  return formatted;
};

// 🔍 用户意图识别函数 (快速分类)
const classifyUserIntent = async (userInput) => {
  console.log('🔍 开始用户意图识别...');
  console.log('📝 用户输入:', userInput.substring(0, 50) + (userInput.length > 50 ? '...' : ''));
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `你是一个对话分类机器人，专门用于"约会后复盘"情境。请判断用户的输入类型：

SIMPLE_REPLY - 适用于以下情况：
- 简单问候、闲聊（"你好"、"今天天气不错"、"谢谢"等）
- 单纯的确认或简短回应（"好的"、"明白了"、"是的"等）
- 非情感相关的日常话题（天气、工作、吃饭等普通聊天）
- 简单的礼貌性对话

DEEP_ANALYSIS - 适用于以下情况：
- 约会经历分享和复盘
- 情感困惑、关系问题咨询
- 对他人行为或动机的分析需求
- 需要专业建议的情感问题
- 涉及两性关系的具体情况

请只返回：SIMPLE_REPLY 或 DEEP_ANALYSIS`
        },
        {
          role: "user",
          content: userInput
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    });

    const intent = completion.choices[0].message.content.trim();
    console.log('🎯 识别意图:', intent);
    console.log('🔍 OpenAI完整返回:', JSON.stringify(completion, null, 2));
    console.log('⚡ 分类用时 & Token消耗:', completion.usage?.total_tokens || 'N/A');
    
    // 确保返回值的有效性
    if (intent === 'DEEP_ANALYSIS' || intent === 'SIMPLE_REPLY') {
      return {
        success: true,
        intent: intent,
        tokens_used: completion.usage?.total_tokens || 0
      };
    } else {
      console.log('⚠️ 意图识别返回异常值，默认为深度分析:', intent);
      return {
        success: true,
        intent: 'DEEP_ANALYSIS',
        tokens_used: completion.usage?.total_tokens || 0
      };
    }
    
  } catch (error) {
    console.error('❌ 用户意图识别失败:', error.message);
    // 失败时默认为深度分析，确保功能完整性
    return {
      success: false,
      intent: 'DEEP_ANALYSIS',
      error: error.message,
      tokens_used: 0
    };
  }
};

// 💬 简单回复生成函数 (轻量级对话)
const generateSimpleReply = async (conversationHistory, userInput) => {
  console.log('💬 生成简单回复...');
  
  try {
    // 构建对话历史上下文
    const messages = [
      {
        role: "system",
        content: `你是一个温暖、专业的情感教练助手。用户正在进行约会后的复盘交流。

请提供简短、自然的回复（1-3句话），保持对话的连贯性和温暖感。

回复风格要求：
- 简洁明了，不超过100字
- 温暖支持，显示理解
- 自然对话，避免说教
- 适当询问或鼓励继续分享`
      }
    ];

    // 添加对话历史（最近5轮）
    const recentHistory = conversationHistory.slice(-5);
    recentHistory.forEach(msg => {
      if (msg.sender === 'user') {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.sender === 'assistant') {
        messages.push({ role: "assistant", content: msg.content });
      }
    });

    // 添加当前用户输入
    messages.push({ role: "user", content: userInput });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 150,
      temperature: 0.7
    });

    const response = completion.choices[0].message.content.trim();
    console.log('✅ 简单回复生成完成，长度:', response.length);
    console.log('⚡ Token消耗:', completion.usage?.total_tokens || 'N/A');
    
    return {
      success: true,
      response: response,
      tokens_used: completion.usage?.total_tokens || 0,
      processing_type: 'simple_reply'
    };
    
  } catch (error) {
    console.error('❌ 简单回复生成失败:', error.message);
    return {
      success: false,
      error: error.message,
      fallback_response: "我理解您的感受。请继续和我分享，我会仔细倾听的。",
      tokens_used: 0,
      processing_type: 'simple_reply'
    };
  }
};

// 🎯 约会后复盘核心处理函数 (智能分流版)
const processPostDateDebrief = async (conversationHistory, userInput, audioFile = null) => {
  console.log('🎯 开始约会后复盘处理...');
  
  try {
    let userQuestion = userInput;
    let transcriptionResult = null;
    
    // 第1步：处理音频输入（如果有）
    if (audioFile) {
      console.log('🎧 第1步：处理音频输入（内存流模式）');
      console.log(`📊 音频文件信息: ${audioFile.originalname}, ${(audioFile.size / 1024).toFixed(2)}KB`);
      transcriptionResult = await transcribeAudioWithWhisper(audioFile.buffer, audioFile.originalname);
      
      if (!transcriptionResult.success) {
        throw new Error(`音频转录失败: ${transcriptionResult.error}`);
      }
      
      userQuestion = transcriptionResult.transcription;
      console.log('✅ 音频转录成功（内存流处理），提取文本:', userQuestion.substring(0, 100) + '...');
    }
    
    // 第2步：用户意图识别 (新增)
    console.log('🔍 第2步：用户意图识别');
    const intentResult = await classifyUserIntent(userQuestion);
    
    console.log('🎯 识别结果:', intentResult.intent);
    console.log('⚡ 意图识别Token消耗:', intentResult.tokens_used);
    
    // 根据意图选择处理路径
    if (intentResult.intent === 'SIMPLE_REPLY') {
      console.log('💬 选择轻量级对话路径');
      
      // 简单回复路径
      const simpleResponse = await generateSimpleReply(conversationHistory, userQuestion);
      
      if (!simpleResponse.success) {
        // 简单回复失败时的备用回复
        return {
          success: true,
          response: simpleResponse.fallback_response || "我理解您的感受。请继续和我分享，我会仔细倾听的。",
          metadata: {
            processing_steps: [
              audioFile ? '音频转录' : '文本输入',
              '用户意图识别',
              '简单回复生成'
            ],
            processing_type: 'simple_reply',
            intent_classification: intentResult.intent,
            transcription: transcriptionResult,
            tokens_used: (intentResult.tokens_used || 0) + (simpleResponse.tokens_used || 0),
            model_used: 'gpt-4o',
            timestamp: new Date().toISOString()
          }
        };
      }
      
      // 返回简单回复结果
      return {
        success: true,
        response: simpleResponse.response,
        metadata: {
          processing_steps: [
            audioFile ? '音频转录' : '文本输入',
            '用户意图识别',
            '简单回复生成'
          ],
          processing_type: 'simple_reply',
          intent_classification: intentResult.intent,
          transcription: transcriptionResult,
          tokens_used: (intentResult.tokens_used || 0) + (simpleResponse.tokens_used || 0),
          model_used: 'gpt-4o',
          timestamp: new Date().toISOString()
        }
      };
    } else {
      console.log('🧠 选择深度分析路径 (AI查询扩展 + RAG + 专业教练)');
      
      // 深度分析路径 - 集成AI查询扩展技术
      
      // 第3步：AI查询扩展（解决检索偏见）- 新增步骤
      console.log('🔍 第3步：AI查询扩展（解决检索偏见）');
      
      // 构造适配enhanceQueryWithAI函数的用户信息格式
      const userInfoForEnhancement = {
        nickname: "咨询用户",
        profession: "情感咨询",
        age: "未知",
        bioOrChatHistory: userQuestion
      };
      
      let enhancedQuery = null;
      let queryOptimizationResult = null;
      
      try {
        queryOptimizationResult = await enhanceQueryWithAI(userInfoForEnhancement, []); // 约会后复盘没有图片分析
        
        if (queryOptimizationResult.success) {
          enhancedQuery = queryOptimizationResult.enhanced_query;
          console.log('✅ AI查询扩展成功');
          console.log(`📊 优化统计: 原始${queryOptimizationResult.optimization_stats.original_length}字符 → 扩展${queryOptimizationResult.optimization_stats.enhanced_length}字符 (扩展比例: ${queryOptimizationResult.optimization_stats.expansion_ratio}x)`);
          console.log(`🔧 Token消耗: ${queryOptimizationResult.token_usage}`);
        } else {
          console.warn('⚠️ AI查询扩展失败，使用原始查询:', queryOptimizationResult.error);
          enhancedQuery = queryOptimizationResult.enhanced_query; // 使用备用查询
        }
      } catch (enhanceError) {
        console.error('❌ AI查询扩展过程异常:', enhanceError.message);
        enhancedQuery = userQuestion;
        queryOptimizationResult = {
          success: false,
          error: enhanceError.message,
          original_query: userQuestion,
          enhanced_query: userQuestion,
          token_usage: 0,
          optimization_stats: { original_length: userQuestion.length, enhanced_length: userQuestion.length, expansion_ratio: 1.0 }
        };
      }
      
      // 第4步：RAG知识检索（使用增强查询）
      console.log('🧠 第4步：RAG知识检索（使用增强查询）');
      console.log('🚀 使用AI优化查询进行RAG检索，查询长度:', enhancedQuery.length);
      console.log('🔄 优化查询预览:', enhancedQuery.substring(0, 150) + '...');
      
      const ragResult = await callPostDateRAGSystemWithEnhancedQuery(enhancedQuery, userQuestion, conversationHistory);
      
      // 输出RAG检索详细信息
      if (ragResult.success && ragResult.data) {
        console.log('✅ RAG知识检索成功:');
        console.log('   📄 检索状态:', ragResult.data.rag_analysis?.status || 'unknown');
        console.log('   📖 知识内容长度:', ragResult.data.rag_analysis?.knowledge_answer?.length || 0);
        console.log('   📚 引用文档数:', ragResult.data.rag_analysis?.knowledge_references?.length || 0);
      } else {
        console.log('⚠️ RAG知识检索失败或无结果');
      }
      
      // 第5步：生成情感教练回复 (传递完整的ragResult对象)
      console.log('🎭 第5步：生成情感教练回复');
      const coachResponse = await generateCoachResponseWithGPT4o(
        conversationHistory, 
        userQuestion, 
        ragResult  // 传递完整的ragResult而不是构建的字符串
      );
      
      if (!coachResponse.success) {
        throw new Error(`情感教练回复生成失败: ${coachResponse.error}`);
      }
      
      // 第6步：构建最终响应
      const finalResponse = {
        success: true,
        response: coachResponse.response,
        metadata: {
          processing_steps: [
            audioFile ? '音频转录' : '文本输入',
            '用户意图识别',
            'AI查询扩展',
            'RAG知识检索',
            '情感教练分析',
            '回复生成'
          ],
          processing_type: 'deep_analysis_with_enhancement',
          intent_classification: intentResult.intent,
          transcription: transcriptionResult,
          query_optimization: queryOptimizationResult || {
            success: false,
            error: "查询优化未执行",
            original_query: userQuestion,
            enhanced_query: userQuestion,
            token_usage: 0,
            optimization_stats: { original_length: userQuestion.length, enhanced_length: userQuestion.length, expansion_ratio: 1.0 }
          },
          rag_sources: ragResult.data?.rag_analysis?.knowledge_references?.length || 0,
          tokens_used: (intentResult.tokens_used || 0) + (queryOptimizationResult?.token_usage || 0) + (coachResponse.tokens_used || 0),
          model_used: coachResponse.model_used,
          timestamp: new Date().toISOString()
        }
      };
      
      console.log('✅ 约会后复盘处理完成（使用AI查询扩展技术）');
      console.log('📊 处理统计:', {
        有音频输入: !!audioFile,
        处理类型: 'deep_analysis_with_enhancement',
        意图识别: intentResult.intent,
        AI查询扩展: queryOptimizationResult?.success || false,
        查询扩展比例: queryOptimizationResult?.optimization_stats?.expansion_ratio || 1.0,
        RAG文档数: ragResult.data?.rag_analysis?.knowledge_references?.length || 0,
        回复长度: coachResponse.response.length,
        总Token消耗: (intentResult.tokens_used || 0) + (queryOptimizationResult?.token_usage || 0) + (coachResponse.tokens_used || 0)
      });
      
      return finalResponse;
    }
    
  } catch (error) {
    console.error('❌ 约会后复盘处理失败:', error.message);
    
    return {
      success: false,
      error: error.message,
      fallback_response: "很抱歉，我暂时无法为您提供完整的情感教练服务。请稍后再试，或者尝试重新描述您的问题。\n\n作为临时建议，请记住：\n\n诚实沟通是健康关系的基础\n给彼此时间和空间来发展感情\n保持真实的自己，不要刻意迎合",
      metadata: {
        error_type: error.constructor.name,
        timestamp: new Date().toISOString()
      }
    };
  }
};

// 🎯 约会后复盘API接口 (集成AI查询扩展技术)
// 本API已集成与约会前预警API相同的先进AI查询扩展技术：
// 1. 先用GPT-4o改写和扩展用户问题
// 2. 再用扩展后的问题进行RAG检索
// 3. 确保均衡、无偏见的知识库查询
app.post('/api/post_date_debrief', postDateUpload.single('audio'), async (req, res) => {
  console.log('🎯 ===== 约会后复盘API请求开始 (AI查询扩展版) =====');
  
  try {
    const { user_input, conversation_history } = req.body;
    const audioFile = req.file; // 可选的音频文件
    
    console.log('📝 请求数据验证:');
    console.log('   对话历史原始数据:', conversation_history ? 
      (typeof conversation_history === 'string' ? conversation_history.substring(0, 100) + '...' : 'JSON对象格式') 
      : '未提供');
    console.log('   用户输入:', user_input ? '已提供' : '未提供');
    console.log('   音频文件:', audioFile ? `已提供 (${audioFile.originalname}, ${(audioFile.size / 1024).toFixed(2)}KB)` : '未提供');
    
    // 验证必需字段
    if (!user_input && !audioFile) {
      return res.status(400).json({
        success: false,
        error: '需要提供用户输入或音频文件',
        error_type: 'ValidationError',
        troubleshooting: {
          solution: '请在请求中提供user_input文本或上传audio音频文件',
          examples: [
            '文本输入: {"user_input": "您的问题..."}',
            '音频输入: 使用FormData上传audio字段的音频文件'
          ]
        }
      });
    }
    
    // 安全解析对话历史
    let parsedConversationHistory = [];
    if (conversation_history) {
      if (Array.isArray(conversation_history)) {
        // 已经是数组格式（JSON请求）
        parsedConversationHistory = conversation_history;
      } else if (typeof conversation_history === 'string') {
        // 字符串格式（multipart请求）
        try {
          parsedConversationHistory = JSON.parse(conversation_history);
          if (!Array.isArray(parsedConversationHistory)) {
            parsedConversationHistory = [];
          }
        } catch (parseError) {
          console.log('⚠️ 对话历史JSON解析失败，使用空数组:', parseError.message);
          parsedConversationHistory = [];
        }
      } else {
        console.log('⚠️ 对话历史格式不支持，使用空数组');
        parsedConversationHistory = [];
      }
    }
    
    console.log('📊 处理参数统计:');
    console.log('   对话历史长度:', parsedConversationHistory.length);
    console.log('   用户输入长度:', user_input ? user_input.length : 0);
    console.log('   音频文件大小:', audioFile ? `${(audioFile.size / 1024).toFixed(2)}KB` : '无');
    
    // 调用约会后复盘处理函数（增强错误处理）
    let result;
    try {
      result = await processPostDateDebrief(parsedConversationHistory, user_input, audioFile);
    } catch (processingError) {
      console.error('❌ 约会后复盘处理过程发生错误:', processingError.message);
      
      // 根据错误类型提供不同的处理
      if (processingError.message.includes('音频转录失败')) {
        return res.status(422).json({
          success: false,
          error: '语音转录服务暂时不可用',
          error_detail: processingError.message,
          error_type: 'AudioTranscriptionError',
          troubleshooting: {
            immediate_action: '请尝试使用文字输入代替语音输入',
            audio_requirements: [
              '确保音频文件小于25MB',
              '使用支持的格式: mp3, wav, m4a, ogg等',
              '确保音频清晰，没有过多背景噪音',
              '检查网络连接是否稳定'
            ],
            alternative: '您可以将语音内容转换为文字后重新提交'
          },
          fallback_response: "很抱歉，语音转录功能暂时不可用。请将您的问题以文字形式重新提交，我会为您提供专业的情感教练建议。\n\n同时，请确保：\n- 音频文件格式正确（mp3、wav等）\n- 文件大小小于25MB\n- 网络连接稳定"
        });
      } else if (processingError.message.includes('RAG')) {
        return res.status(503).json({
          success: false,
          error: '知识库服务暂时不可用',
          error_detail: processingError.message,
          error_type: 'RAGServiceError',
          troubleshooting: {
            service_status: '情感教练知识库正在维护中',
            estimated_recovery: '请稍后重试，通常在1-2分钟内恢复',
            alternative: '系统会提供基础的情感支持建议'
          },
          fallback_response: "虽然专业知识库暂时不可用，但我仍然可以为您提供基础的情感支持。请详细描述您的情况，我会尽力为您提供有用的建议。\n\n记住：\n- 诚实沟通是健康关系的基础\n- 给彼此时间和空间发展感情\n- 保持真实的自己"
        });
      } else {
        return res.status(500).json({
          success: false,
          error: '服务暂时不可用',
          error_detail: processingError.message,
          error_type: 'InternalServerError',
          troubleshooting: {
            action: '请稍后重试',
            contact: '如果问题持续，请联系技术支持'
          },
          fallback_response: "很抱歉，服务暂时遇到了问题。请稍后重试。\n\n如果您急需情感建议，请记住这些核心原则：\n- 保持冷静和理性\n- 诚实面对自己的感受\n- 尊重对方的决定和边界\n- 专注于自我成长和提升"
        });
      }
    }
    
    // 处理成功情况
    if (result && result.success) {
      console.log('✅ 约会后复盘API处理成功');
      return res.json({
        success: true,
        response: result.response,
        metadata: {
          processing_steps: result.metadata.processing_steps,
          processing_type: result.metadata.processing_type,
          has_audio: !!audioFile,
          has_transcription: !!(result.metadata.transcription && result.metadata.transcription.success),
          rag_sources: result.metadata.rag_sources,
          response_length: result.response.length,
          tokens_used: result.metadata.tokens_used,
          model_used: result.metadata.model_used,
          timestamp: result.metadata.timestamp
        }
      });
    } else {
      // 处理失败但有fallback响应的情况
      console.log('⚠️ 约会后复盘API处理失败，返回备用回复');
      return res.status(202).json({
        success: false,
        error: result.error || '处理失败',
        fallback_response: result.fallback_response,
        metadata: result.metadata || {
          error_type: 'ProcessingFailure',
          timestamp: new Date().toISOString()
        },
        troubleshooting: {
          suggestion: '请尝试重新描述您的问题，或稍后重试',
          tips: [
            '提供更详细的情况描述',
            '确保网络连接稳定',
            '如果使用语音，请确保音频清晰'
          ]
        }
      });
    }
    
  } catch (error) {
    console.error('❌ 约会后复盘API发生未预期错误:', error);
    console.error('错误堆栈:', error.stack);
    
    // 最终的错误兜底处理
    return res.status(500).json({
      success: false,
      error: '服务器内部错误',
      error_detail: error.message,
      error_type: error.constructor.name,
      timestamp: new Date().toISOString(),
      troubleshooting: {
        immediate_action: '请稍后重试',
        contact_support: '如果问题持续，请联系技术支持',
        status_check: '您可以访问 /api/health 检查服务状态'
      },
      fallback_response: "很抱歉，系统暂时遇到了技术问题。请稍后重试。\n\n在等待的同时，请记住：\n\n💡 **情感自助建议**：\n- 深呼吸，保持冷静\n- 诚实面对自己的感受\n- 考虑对方的立场和感受\n- 专注于建设性的沟通\n\n如果是紧急情感困扰，建议寻求专业心理咨询师的帮助。"
    });
  }
});