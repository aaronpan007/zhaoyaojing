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

// 检查OpenAI配置
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ 错误: 未设置OPENAI_API_KEY环境变量');
  console.error('请在 .env 文件中添加: OPENAI_API_KEY=your_openai_api_key');
  process.exit(1);
}

// 检查Cloudflare R2配置
const requiredR2Vars = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BUCKET_NAME'];
const missingR2Vars = requiredR2Vars.filter(var => !process.env[var]);

if (missingR2Vars.length > 0) {
  console.error('❌ 错误: 缺少Cloudflare R2环境变量:');
  missingR2Vars.forEach(var => {
    console.error(`   - ${var}`);
  });
  console.error('请在 .env 文件中配置完整的R2存储信息');
  process.exit(1);
}

console.log('✅ Cloudflare R2配置验证通过');
console.log(`   Account ID: ${process.env.CLOUDFLARE_ACCOUNT_ID}`);
console.log(`   Bucket: ${process.env.BUCKET_NAME}`);

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
});

console.log('✅ OpenAI GPT-4o客户端初始化完成');
console.log('🔗 API地址:', process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');

// 检查RAG系统是否就绪 - 现在检查R2连接而不是本地文件
const checkRAGSystem = async () => {
  try {
    console.log('🔄 检查Cloudflare R2 RAG系统连接...');
    
    // 通过Python脚本测试R2连接
    return new Promise((resolve) => {
      const testProcess = spawn('python3', ['rag_query_service_r2.py', '--test-connection'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let output = '';
      let error = '';
      
      testProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      testProcess.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      testProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ R2 RAG系统连接成功');
          resolve(true);
        } else {
          console.warn('⚠️  警告: R2 RAG系统连接测试失败');
          console.warn('错误信息:', error);
          resolve(false);
        }
      });
      
      // 超时处理
      setTimeout(() => {
        testProcess.kill();
        console.warn('⚠️  警告: R2连接测试超时');
        resolve(false);
      }, 10000);
    });
  } catch (error) {
    console.warn('⚠️  警告: 无法测试R2连接:', error.message);
    return false;
  }
};

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
    // 只允许音频文件
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('约会复盘只允许上传音频文件！'), false);
    }
  }
});

// 启动时检查R2 RAG系统
let ragSystemReady = false;
checkRAGSystem().then(result => {
  ragSystemReady = result;
});

// ===== 图片分析相关函数 =====

/**
 * 使用GPT-4o进行图片智能分类
 */
const classifyImageWithGPT4o = async (filePath, filename) => {
  try {
    console.log(`🖼️ 开始分类图片: ${filename}`);
    
    // 读取图片文件
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    // 准备图片数据
    const imageData = `data:image/jpeg;base64,${base64Image}`;
    
    // 调用GPT-4o进行图片分类
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请分析这张图片属于以下哪个类别，只返回类别名称：
              1. 聊天记录 (包含微信、QQ、其他社交软件的对话界面)
              2. 个人照片 (人物照片、自拍、生活照等)
              3. 其他 (不属于以上两类的图片)
              
              请只返回类别名称，不要其他解释。`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });
    
    const classification = response.choices[0]?.message?.content?.trim() || '其他';
    console.log(`📊 图片分类结果: ${classification}`);
    
    return classification;
    
  } catch (error) {
    console.error(`❌ 图片分类失败 (${filename}):`, error.message);
    return '其他';
  }
};

/**
 * 使用GPT-4o分析聊天记录图片
 */
const analyzeChatImageWithGPT4o = async (filePath, filename) => {
  try {
    console.log(`💬 开始分析聊天记录: ${filename}`);
    
    // 读取图片文件
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    // 准备图片数据
    const imageData = `data:image/jpeg;base64,${base64Image}`;
    
    // 调用GPT-4o分析聊天记录
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请仔细分析这张聊天记录图片，提取以下关键信息：

1. 对话双方的基本情况（身份、年龄等可推测信息）
2. 对话的主要内容和话题
3. 交流的语气和情感倾向
4. 对话中体现的价值观和态度
5. 任何潜在的红旗信号（如：过度热情、经济相关话题、不当要求等）
6. 交流的频率和时间模式

请基于专业情感安全角度进行分析，重点识别可能的风险信号。`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });
    
    const analysis = response.choices[0]?.message?.content || '无法分析聊天内容';
    console.log(`✅ 聊天记录分析完成: ${filename}`);
    
    return {
      type: '聊天记录',
      analysis: analysis,
      filename: filename,
      details: {
        analyzed_at: new Date().toISOString(),
        model_used: 'gpt-4o',
        analysis_focus: 'chat_content_safety'
      }
    };
    
  } catch (error) {
    console.error(`❌ 聊天记录分析失败 (${filename}):`, error.message);
    return {
      type: '聊天记录',
      analysis: `分析失败: ${error.message}`,
      filename: filename,
      error: true
    };
  }
};

/**
 * 使用GPT-4o分析个人照片
 */
const analyzePhotoImageWithGPT4o = async (filePath, filename) => {
  try {
    console.log(`📸 开始分析个人照片: ${filename}`);
    
    // 读取图片文件
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    // 准备图片数据  
    const imageData = `data:image/jpeg;base64,${base64Image}`;
    
    // 调用GPT-4o分析个人照片
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请从情感安全专家的角度分析这张个人照片，重点关注：

1. 照片的拍摄环境和背景（豪华、普通、特殊场所等）
2. 人物的外在形象和风格（着装、打扮、气质等）
3. 照片可能传达的生活状态和经济水平
4. 人物的表情、姿态和可能的性格特征
5. 照片是否有修图、滤镜等美化痕迹
6. 照片的真实性和可信度评估
7. 任何可能的风险信号（如：过度炫富、不当暗示、虚假包装等）

请基于专业分析，评估这个人在约会场景中的可信度和潜在风险。`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });
    
    const analysis = response.choices[0]?.message?.content || '无法分析照片内容';
    console.log(`✅ 个人照片分析完成: ${filename}`);
    
    return {
      type: '个人照片',
      analysis: analysis,
      filename: filename,
      details: {
        analyzed_at: new Date().toISOString(),
        model_used: 'gpt-4o',
        analysis_focus: 'personal_photo_safety'
      }
    };
    
  } catch (error) {
    console.error(`❌ 个人照片分析失败 (${filename}):`, error.message);
    return {
      type: '个人照片',
      analysis: `分析失败: ${error.message}`,
      filename: filename,
      error: true
    };
  }
};

/**
 * 主图片分析函数 - 根据分类调用相应的专业分析
 */
const analyzeImageWithGPT4o = async (filePath, filename) => {
  try {
    // 第一步：图片分类
    const classification = await classifyImageWithGPT4o(filePath, filename);
    
    // 第二步：根据分类进行专业分析
    let analysisResult;
    
    switch (classification) {
      case '聊天记录':
        analysisResult = await analyzeChatImageWithGPT4o(filePath, filename);
        break;
        
      case '个人照片':
        analysisResult = await analyzePhotoImageWithGPT4o(filePath, filename);
        break;
        
      default:
        // 其他类型图片的通用分析
        analysisResult = {
          type: '其他',
          analysis: '此图片不属于聊天记录或个人照片类别，无法进行专业情感安全分析。',
          filename: filename,
          details: {
            analyzed_at: new Date().toISOString(),
            classification: classification
          }
        };
    }
    
    // 添加分类信息到结果中
    analysisResult.classification = classification;
    
    return analysisResult;
    
  } catch (error) {
    console.error(`❌ 图片分析流程失败 (${filename}):`, error.message);
    return {
      type: 'error',
      analysis: `图片分析失败: ${error.message}`,
      filename: filename,
      error: true,
      classification: 'unknown'
    };
  }
};

// ===== AI增强查询生成 =====

/**
 * 使用AI增强用户查询
 */
const enhanceQueryWithAI = async (userInfo, imageAnalyses) => {
  try {
    console.log('🧠 开始AI查询增强...');
    
    // 构建用户信息摘要
    const userSummary = [
      userInfo.nickname ? `昵称: ${userInfo.nickname}` : '',
      userInfo.age ? `年龄: ${userInfo.age}` : '',
      userInfo.profession ? `职业: ${userInfo.profession}` : '',
      userInfo.bioOrChatHistory ? `个人信息: ${userInfo.bioOrChatHistory.substring(0, 200)}` : ''
    ].filter(Boolean).join('\n');
    
    // 构建图片分析摘要
    const imageSummary = imageAnalyses.map((analysis, index) => {
      return `图片${index + 1} (${analysis.type}): ${analysis.analysis.substring(0, 300)}`;
    }).join('\n\n');
    
    // 使用GPT-4o生成增强查询
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `你是一位专业的情感安全专家，擅长识别约会和恋爱中的潜在风险。
          请基于提供的用户信息和图片分析，生成一个简洁而准确的查询语句，用于搜索相关的专业知识。
          
          查询应该包含：
          1. 关键的风险点或特征
          2. 需要关注的行为模式
          3. 相关的专业术语
          
          查询长度控制在100字以内，重点突出。`
        },
        {
          role: 'user',
          content: `请基于以下信息生成专业查询：
          
          用户信息：
          ${userSummary}
          
          图片分析结果：
          ${imageSummary}
          
          请生成一个专业的查询语句，用于搜索相关的情感安全知识。`
        }
      ],
      max_tokens: 200,
      temperature: 0.3
    });
    
    const enhancedQuery = response.choices[0]?.message?.content?.trim() || '';
    console.log(`✅ AI查询增强完成: ${enhancedQuery}`);
    
    return enhancedQuery;
    
  } catch (error) {
    console.error('❌ AI查询增强失败:', error.message);
    return '约会安全分析 风险识别 情感诈骗';
  }
};

// ===== RAG系统调用 (R2版本) =====

/**
 * 调用RAG系统进行知识库查询 - 使用R2云存储
 */
const callRAGSystem = async (userInfo, imageInfos, enhancedQuery = null) => {
  return new Promise((resolve) => {
    console.log('🔍 调用R2 RAG系统...');
    
    // 准备查询数据
    const queryData = {
      user_input: userInfo,
      image_analysis: imageInfos,
      enhanced_query: enhancedQuery
    };
    
    // 启动Python RAG查询进程 - 使用R2版本
    const ragProcess = spawn('python3', ['rag_query_service_r2.py'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 发送查询数据
    ragProcess.stdin.write(JSON.stringify(queryData));
    ragProcess.stdin.end();
    
    let output = '';
    let error = '';
    
    // 收集输出
    ragProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ragProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    // 处理完成
    ragProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // 清理输出并解析JSON
          const cleanOutput = output.trim();
          const lines = cleanOutput.split('\n');
          const jsonLine = lines.find(line => line.startsWith('{') && line.endsWith('}'));
          
          if (jsonLine) {
            const result = JSON.parse(jsonLine);
            console.log('✅ R2 RAG查询成功');
            resolve(result);
          } else {
            throw new Error('未找到有效的JSON输出');
          }
        } catch (parseError) {
          console.error('❌ R2 RAG输出解析失败:', parseError.message);
          console.error('原始输出:', output);
          resolve({
            error: 'RAG输出解析失败',
            answer: '',
            sources: [],
            sources_count: 0
          });
        }
      } else {
        console.error('❌ R2 RAG进程执行失败:', error);
        resolve({
          error: 'RAG系统执行失败',
          answer: '',
          sources: [],
          sources_count: 0
        });
      }
    });
    
    // 超时处理
    setTimeout(() => {
      ragProcess.kill();
      console.error('⏰ R2 RAG查询超时');
      resolve({
        error: 'RAG查询超时',
        answer: '',
        sources: [],
        sources_count: 0
      });
    }, 60000); // 60秒超时
  });
};

// ===== 后续的函数保持不变，但需要调用R2版本的RAG系统 =====

/**
 * Post-Date复盘专用RAG查询 - 使用R2版本
 */
const callPostDateRAGSystem = async (userQuestion, conversationHistory = []) => {
  return new Promise((resolve) => {
    console.log('🔍 调用R2 Post-Date RAG系统...');
    
    // 准备查询数据
    const queryData = {
      user_question: userQuestion,
      conversation_history: conversationHistory,
      query_type: 'post_date_debrief'
    };
    
    // 启动Python RAG查询进程 - 使用R2版本
    const ragProcess = spawn('python3', ['query_rag_system_r2.py'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 发送查询数据
    ragProcess.stdin.write(JSON.stringify(queryData));
    ragProcess.stdin.end();
    
    let output = '';
    let error = '';
    
    // 收集输出
    ragProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ragProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    // 处理完成
    ragProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // 清理输出并解析JSON
          const cleanOutput = output.trim();
          const lines = cleanOutput.split('\n');
          const jsonLine = lines.find(line => line.startsWith('{') && line.endsWith('}'));
          
          if (jsonLine) {
            const result = JSON.parse(jsonLine);
            console.log('✅ R2 Post-Date RAG查询成功');
            resolve(result);
          } else {
            throw new Error('未找到有效的JSON输出');
          }
        } catch (parseError) {
          console.error('❌ R2 Post-Date RAG输出解析失败:', parseError.message);
          console.error('原始输出:', output);
          resolve({
            error: 'Post-Date RAG输出解析失败',
            answer: '',
            sources: [],
            sources_count: 0
          });
        }
      } else {
        console.error('❌ R2 Post-Date RAG进程执行失败:', error);
        resolve({
          error: 'Post-Date RAG系统执行失败',
          answer: '',
          sources: [],
          sources_count: 0
        });
      }
    });
    
    // 超时处理
    setTimeout(() => {
      ragProcess.kill();
      console.error('⏰ R2 Post-Date RAG查询超时');
      resolve({
        error: 'Post-Date RAG查询超时',
        answer: '',
        sources: [],
        sources_count: 0
      });
    }, 60000); // 60秒超时
  });
};

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📁 访问地址: http://localhost:${PORT}`);
  console.log(`☁️  使用Cloudflare R2存储: ${process.env.BUCKET_NAME}`);
  console.log('🔄 正在初始化R2 RAG系统...');
});

module.exports = app; 