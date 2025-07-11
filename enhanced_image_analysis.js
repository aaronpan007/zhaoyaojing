const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

console.log('🔧 ===== 增强图片分析模块 =====');

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
});

// 增强的图片分析函数 - 添加详细的错误处理和数据验证
const enhancedAnalyzeImageWithGPT4o = async (filePath, filename) => {
  console.log(`🎯 开始增强图片分析: ${filename}`);
  console.log(`📂 文件路径: ${filePath}`);
  
  try {
    // 第1步：文件存在性验证
    console.log('🔍 第1步：验证文件存在性...');
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    console.log('✅ 文件存在验证通过');
    
    // 第2步：文件权限检查
    console.log('🔍 第2步：检查文件权限...');
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      console.log('✅ 文件可读权限验证通过');
    } catch (accessError) {
      throw new Error(`文件无法读取，权限错误: ${accessError.message}`);
    }
    
    // 第3步：获取文件统计信息
    console.log('🔍 第3步：获取文件信息...');
    let stats;
    try {
      stats = fs.statSync(filePath);
      console.log(`📊 文件大小: ${stats.size} 字节 (${(stats.size / 1024).toFixed(2)} KB)`);
      console.log(`📅 文件修改时间: ${stats.mtime}`);
      
      // 检查文件大小限制
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        throw new Error(`文件过大: ${(stats.size / 1024 / 1024).toFixed(2)}MB，超过10MB限制`);
      }
      
      if (stats.size === 0) {
        throw new Error('文件为空');
      }
      
      console.log('✅ 文件信息验证通过');
    } catch (statError) {
      throw new Error(`获取文件信息失败: ${statError.message}`);
    }
    
    // 第4步：确定MIME类型
    console.log('🔍 第4步：确定文件MIME类型...');
    let mimeType = 'image/jpeg'; // 默认
    const ext = path.extname(filename).toLowerCase();
    
    switch (ext) {
      case '.png':
        mimeType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        mimeType = 'image/jpeg';
        break;
      case '.gif':
        mimeType = 'image/gif';
        break;
      case '.webp':
        mimeType = 'image/webp';
        break;
      default:
        console.warn(`⚠️ 未知图片格式: ${ext}，使用默认JPEG`);
    }
    
    console.log(`📄 确定的MIME类型: ${mimeType}`);
    
    // 第5步：安全读取文件
    console.log('🔍 第5步：安全读取文件数据...');
    let imageBuffer;
    try {
      // 使用异步读取，避免阻塞
      imageBuffer = await new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            reject(new Error(`文件读取失败: ${err.message}`));
          } else {
            resolve(data);
          }
        });
      });
      
      console.log(`✅ 文件读取成功，缓冲区大小: ${imageBuffer.length} 字节`);
      
      // 验证读取的数据
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('读取的文件数据为空');
      }
      
      // 检查是否为有效的图片数据（检查文件头）
      const isValidImage = validateImageBuffer(imageBuffer, mimeType);
      if (!isValidImage) {
        throw new Error('文件不是有效的图片格式');
      }
      
    } catch (readError) {
      throw new Error(`文件读取过程失败: ${readError.message}`);
    }
    
    // 第6步：转换为Base64
    console.log('🔍 第6步：转换为Base64编码...');
    let base64Image;
    try {
      base64Image = imageBuffer.toString('base64');
      console.log(`✅ Base64编码完成，长度: ${base64Image.length} 字符`);
      
      // 验证Base64编码
      if (!base64Image || base64Image.length === 0) {
        throw new Error('Base64编码失败，结果为空');
      }
      
      // 检查Base64格式
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(base64Image.substring(0, 100))) {
        throw new Error('Base64编码格式无效');
      }
      
    } catch (encodeError) {
      throw new Error(`Base64编码失败: ${encodeError.message}`);
    }
    
    // 第7步：构建数据URL
    console.log('🔍 第7步：构建数据URL...');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    console.log(`📄 数据URL长度: ${dataUrl.length} 字符`);
    console.log(`📄 数据URL前缀: ${dataUrl.substring(0, 50)}...`);
    
    // 第8步：构建分析提示词
    console.log('🔍 第8步：构建AI分析提示词...');
    const analysisPrompt = `你是一位专业的视觉分析师，专门分析约会和社交场景中的图片。

请分析这张图片（文件名：${filename}），从约会安全的角度进行专业评估。

分析要求：
1. 判断图片类型：是聊天记录截图还是生活照片
2. 如果是聊天记录：提取主要对话内容，分析沟通模式和情感倾向
3. 如果是生活照：描述人物形象、环境背景、生活方式展现
4. 识别任何可能的红旗信号或值得注意的细节

请严格按照以下JSON格式返回分析结果：
{
  "image_type": "chat" 或 "photo" 或 "unknown",
  "content_analysis": "详细的内容分析",
  "extracted_text": "如果是聊天记录，提取的文字内容",
  "visual_cues": "视觉线索和细节观察",
  "red_flags": "发现的警告信号（如果有）",
  "confidence": "分析可信度（高/中/低）"
}`;

    // 第9步：调用OpenAI API
    console.log('🔍 第9步：调用OpenAI GPT-4o进行图片分析...');
    let analysisText;
    try {
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
                  url: dataUrl
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1
      });
      
      analysisText = response.choices[0].message.content;
      console.log(`✅ OpenAI API调用成功`);
      console.log(`📄 分析结果长度: ${analysisText.length} 字符`);
      console.log(`📄 分析结果预览: ${analysisText.substring(0, 200)}...`);
      
    } catch (apiError) {
      throw new Error(`OpenAI API调用失败: ${apiError.message}`);
    }
    
    // 第10步：解析分析结果
    console.log('🔍 第10步：解析AI分析结果...');
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
        
        // 移除可能的前后空白
        cleanedText = cleanedText.trim();
        
        analysisResult = JSON.parse(cleanedText);
        console.log('✅ JSON解析成功');
      } else {
        throw new Error('分析结果不是字符串格式');
      }
    } catch (parseError) {
      console.warn(`⚠️ JSON解析失败，使用原始分析: ${parseError.message}`);
      analysisResult = {
        image_type: 'unknown',
        content_analysis: String(analysisText),
        extracted_text: '',
        visual_cues: '无法解析结构化数据',
        red_flags: '',
        confidence: '中'
      };
    }
    
    // 第11步：构建最终结果
    console.log('🔍 第11步：构建最终分析结果...');
    const finalResult = {
      filename: filename,
      size: stats.size,
      mime_type: mimeType,
      image_type: analysisResult.image_type || 'unknown',
      content_analysis: analysisResult.content_analysis || '',
      extracted_text: analysisResult.extracted_text || '',
      visual_cues: analysisResult.visual_cues || '',
      red_flags: analysisResult.red_flags || '',
      confidence: analysisResult.confidence || '中',
      success: true,
      processing_steps: 11,
      analysis_timestamp: new Date().toISOString()
    };
    
    console.log(`✅ 增强图片分析完成: ${filename}`);
    console.log(`📊 最终结果:`, {
      filename: finalResult.filename,
      size: finalResult.size,
      image_type: finalResult.image_type,
      confidence: finalResult.confidence,
      success: finalResult.success
    });
    
    return finalResult;
    
  } catch (error) {
    console.error(`❌ 增强图片分析失败 (${filename}):`, error.message);
    console.error(`🔍 错误堆栈:`, error.stack);
    
    // 返回详细的错误信息
    let stats = { size: 0 };
    try {
      if (fs.existsSync(filePath)) {
        stats = fs.statSync(filePath);
      }
    } catch (statError) {
      console.warn(`⚠️ 无法获取文件统计信息: ${statError.message}`);
    }
    
    return {
      filename: filename,
      size: stats.size,
      mime_type: 'unknown',
      image_type: 'unknown',
      content_analysis: `增强图片分析失败: ${error.message}`,
      extracted_text: '',
      visual_cues: `分析不可用 - 错误: ${error.message}`,
      red_flags: '',
      confidence: '低',
      success: false,
      error: error.message,
      error_type: error.constructor.name,
      processing_steps: 0,
      analysis_timestamp: new Date().toISOString()
    };
  }
};

// 验证图片缓冲区的有效性
const validateImageBuffer = (buffer, expectedMimeType) => {
  if (!buffer || buffer.length < 10) {
    return false;
  }
  
  // 检查常见图片格式的文件头
  const header = buffer.subarray(0, 10);
  
  // JPEG文件头: FF D8 FF
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return expectedMimeType === 'image/jpeg';
  }
  
  // PNG文件头: 89 50 4E 47 0D 0A 1A 0A
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return expectedMimeType === 'image/png';
  }
  
  // GIF文件头: 47 49 46 38
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
    return expectedMimeType === 'image/gif';
  }
  
  // WebP文件头: 52 49 46 46 ... 57 45 42 50
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
    if (buffer.length >= 12) {
      const webpHeader = buffer.subarray(8, 12);
      if (webpHeader[0] === 0x57 && webpHeader[1] === 0x45 && webpHeader[2] === 0x42 && webpHeader[3] === 0x50) {
        return expectedMimeType === 'image/webp';
      }
    }
  }
  
  // 如果无法确定格式，返回true（允许处理）
  console.warn('⚠️ 无法验证图片格式，但继续处理');
  return true;
};

// 独立图片分析测试函数
const testImageAnalysis = async (filePath, filename) => {
  console.log('🧪 ===== 独立图片分析测试 =====');
  console.log(`📂 测试文件: ${filename}`);
  console.log(`📍 文件路径: ${filePath}`);
  
  const startTime = Date.now();
  
  try {
    const result = await enhancedAnalyzeImageWithGPT4o(filePath, filename);
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.log('🎊 ===== 测试完成 =====');
    console.log(`⏱️ 处理时间: ${processingTime}ms`);
    console.log(`📊 测试结果: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    
    if (result.success) {
      console.log('📋 分析摘要:');
      console.log(`   图片类型: ${result.image_type}`);
      console.log(`   置信度: ${result.confidence}`);
      console.log(`   内容摘要: ${result.content_analysis.substring(0, 100)}...`);
    } else {
      console.log('❌ 错误信息:', result.error);
    }
    
    return {
      ...result,
      processing_time_ms: processingTime,
      test_completed: true
    };
    
  } catch (error) {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.error('❌ 测试失败:', error.message);
    return {
      success: false,
      error: error.message,
      processing_time_ms: processingTime,
      test_completed: false
    };
  }
};

module.exports = {
  enhancedAnalyzeImageWithGPT4o,
  validateImageBuffer,
  testImageAnalysis
}; 
 
 
 
 