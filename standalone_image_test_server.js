const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 导入增强的图片分析模块
const { enhancedAnalyzeImageWithGPT4o, testImageAnalysis } = require('./enhanced_image_analysis');

const app = express();
const PORT = process.env.TEST_PORT || 3002;

console.log('🧪 ===== 独立图片分析测试服务器 =====');

// 检查环境配置
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ 错误: 未设置OPENAI_API_KEY环境变量');
  console.error('请在 .env 文件中添加: OPENAI_API_KEY=your_openai_api_key');
  process.exit(1);
}

console.log('✅ OpenAI API配置检查通过');
console.log('🔗 API地址:', process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置multer用于文件上传 - 更严格的配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'test_uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成更安全的文件名
    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `test_${timestamp}_${randomSuffix}_${safeName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB限制
    files: 1 // 单个文件测试
  },
  fileFilter: function (req, file, cb) {
    console.log('📋 文件过滤检查:');
    console.log('   原始文件名:', file.originalname);
    console.log('   MIME类型:', file.mimetype);
    console.log('   字段名:', file.fieldname);
    
    // 只允许图片文件
    if (file.mimetype.startsWith('image/')) {
      console.log('✅ 文件类型验证通过');
      cb(null, true);
    } else {
      console.log('❌ 文件类型验证失败');
      cb(new Error(`不支持的文件类型: ${file.mimetype}，只允许图片文件`), false);
    }
  }
});

// 主页
app.get('/', (req, res) => {
  res.json({
    name: "独立图片分析测试服务器",
    version: "1.0.0",
    status: "运行中",
    endpoints: {
      upload_test: "POST /api/test-image-upload",
      analysis_test: "POST /api/test-image-analysis",
      health: "GET /api/health"
    },
    timestamp: new Date().toISOString()
  });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server_type: 'standalone_image_test',
    openai_configured: !!process.env.OPENAI_API_KEY,
    openai_base_url: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
    test_uploads_dir: path.resolve('test_uploads'),
    capabilities: {
      file_upload: true,
      image_analysis: true,
      enhanced_error_handling: true
    }
  });
});

// 简单文件上传测试（不进行AI分析）
app.post('/api/test-image-upload', upload.single('test_image'), async (req, res) => {
  console.log('📤 ===== 文件上传测试开始 =====');
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '没有上传文件',
        test_type: 'upload_only'
      });
    }
    
    console.log('📋 上传文件信息:');
    console.log('   原始文件名:', req.file.originalname);
    console.log('   保存文件名:', req.file.filename);
    console.log('   文件大小:', req.file.size, '字节');
    console.log('   MIME类型:', req.file.mimetype);
    console.log('   保存路径:', req.file.path);
    
    // 验证文件确实存在
    const fileExists = fs.existsSync(req.file.path);
    console.log('📂 文件存在验证:', fileExists ? '✅ 通过' : '❌ 失败');
    
    // 获取文件统计信息
    let stats = null;
    if (fileExists) {
      stats = fs.statSync(req.file.path);
      console.log('📊 文件统计信息:');
      console.log('   实际大小:', stats.size, '字节');
      console.log('   创建时间:', stats.birthtime);
      console.log('   修改时间:', stats.mtime);
    }
    
    // 清理测试文件
    if (fileExists) {
      fs.unlinkSync(req.file.path);
      console.log('🗑️ 测试文件已清理');
    }
    
    console.log('✅ 文件上传测试完成');
    
    res.json({
      success: true,
      test_type: 'upload_only',
      timestamp: new Date().toISOString(),
      file_info: {
        original_name: req.file.originalname,
        saved_name: req.file.filename,
        size: req.file.size,
        mime_type: req.file.mimetype,
        uploaded_successfully: true,
        file_exists_check: fileExists,
        stats: stats
      },
      message: '文件上传测试成功，文件已被清理'
    });
    
  } catch (error) {
    console.error('❌ 文件上传测试失败:', error.message);
    
    // 尝试清理文件
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ 错误后文件已清理');
      } catch (cleanupError) {
        console.warn('⚠️ 清理文件失败:', cleanupError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      test_type: 'upload_only'
    });
  }
});

// 完整图片分析测试（包含AI分析）
app.post('/api/test-image-analysis', upload.single('test_image'), async (req, res) => {
  console.log('🧠 ===== 完整图片分析测试开始 =====');
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '没有上传文件',
        test_type: 'full_analysis'
      });
    }
    
    console.log('📋 分析测试文件信息:');
    console.log('   原始文件名:', req.file.originalname);
    console.log('   保存文件名:', req.file.filename);
    console.log('   文件大小:', req.file.size, '字节');
    console.log('   MIME类型:', req.file.mimetype);
    console.log('   保存路径:', req.file.path);
    
    // 执行增强的图片分析
    console.log('🔄 开始执行增强图片分析...');
    const analysisResult = await enhancedAnalyzeImageWithGPT4o(req.file.path, req.file.originalname);
    
    console.log('📊 分析结果摘要:');
    console.log('   分析成功:', analysisResult.success ? '✅' : '❌');
    console.log('   图片类型:', analysisResult.image_type);
    console.log('   置信度:', analysisResult.confidence);
    console.log('   处理步骤:', analysisResult.processing_steps);
    
    // 清理测试文件
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ 测试文件已清理');
      }
    } catch (cleanupError) {
      console.warn('⚠️ 清理文件失败:', cleanupError.message);
    }
    
    console.log('✅ 完整图片分析测试完成');
    
    res.json({
      success: true,
      test_type: 'full_analysis',
      timestamp: new Date().toISOString(),
      upload_info: {
        original_name: req.file.originalname,
        saved_name: req.file.filename,
        size: req.file.size,
        mime_type: req.file.mimetype
      },
      analysis_result: analysisResult,
      message: '完整图片分析测试完成'
    });
    
  } catch (error) {
    console.error('❌ 完整图片分析测试失败:', error.message);
    console.error('🔍 错误堆栈:', error.stack);
    
    // 尝试清理文件
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ 错误后文件已清理');
      } catch (cleanupError) {
        console.warn('⚠️ 清理文件失败:', cleanupError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      error_type: error.constructor.name,
      test_type: 'full_analysis',
      stack_trace: error.stack
    });
  }
});

// 错误处理中间件
app.use((error, req, res, next) => {
  console.error('🚨 服务器错误:', error.message);
  
  if (error instanceof multer.MulterError) {
    console.error('📁 Multer错误类型:', error.code);
    
    let errorMessage = '文件上传错误';
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        errorMessage = '文件过大，限制为10MB';
        break;
      case 'LIMIT_FILE_COUNT':
        errorMessage = '文件数量超限，只允许单个文件';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        errorMessage = '意外的文件字段';
        break;
      default:
        errorMessage = `文件上传错误: ${error.message}`;
    }
    
    return res.status(400).json({
      success: false,
      error: errorMessage,
      error_code: error.code
    });
  }
  
  res.status(500).json({
    success: false,
    error: error.message
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log('🚀 独立图片分析测试服务器已启动');
  console.log(`📡 服务地址: http://localhost:${PORT}`);
  console.log(`🧪 文件上传测试: http://localhost:${PORT}/api/test-image-upload`);
  console.log(`🧠 完整分析测试: http://localhost:${PORT}/api/test-image-analysis`);
  console.log(`💊 健康检查: http://localhost:${PORT}/api/health`);
  console.log('');
  console.log('🎯 测试目标:');
  console.log('   1. 验证文件上传功能');
  console.log('   2. 验证图片数据读取');
  console.log('   3. 验证Base64编码');
  console.log('   4. 验证OpenAI API调用');
  console.log('   5. 验证完整分析流程');
  console.log('');
  console.log('📋 使用方法:');
  console.log('   curl -X POST -F "test_image=@your_image.jpg" http://localhost:3002/api/test-image-analysis');
  console.log('');
  console.log('�� 独立测试服务器已就绪！');
}); 
 
 
 
 