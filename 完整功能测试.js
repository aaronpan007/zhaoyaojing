/**
 * AI情感安全助理完整功能测试脚本
 * 测试所有核心分析流程
 */

const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// 测试配置
const API_BASE_URL = 'http://localhost:3001';
const TEST_IMAGE_PATH = './venv/lib/python3.13/site-packages/networkx/drawing/tests/baseline/test_display_empty_graph.png';

// 测试用例数据
const testCases = [
  {
    name: "基础功能测试",
    data: {
      nickname: "测试用户",
      profession: "软件工程师",
      age: "28",
      bioOrChatHistory: "这是一个基础功能测试，验证系统能否正常处理文本信息。"
    },
    withImage: false,
    expectedRisk: "低风险"
  },
  {
    name: "图片分析测试",
    data: {
      nickname: "图片测试用户",
      profession: "UI设计师",
      age: "26",
      bioOrChatHistory: "我喜欢设计，希望找到志同道合的人。请分析上传的图片。"
    },
    withImage: true,
    expectedRisk: "低风险"
  },
  {
    name: "高风险行为模式测试",
    data: {
      nickname: "神秘男子",
      profession: "销售",
      age: "32",
      bioOrChatHistory: "我很有魅力，懂得如何与女性交流。我知道什么时候该推拉，什么时候该表现冷淡。我从不做舔狗，我有很多选择。我相信吸引力法则，女人都喜欢有挑战性的男人。我从不轻易表露真感情，这样能保持神秘感。"
    },
    withImage: false,
    expectedRisk: "中等风险"
  },
  {
    name: "空数据处理测试",
    data: {
      nickname: "最小数据用户",
      profession: "",
      age: "",
      bioOrChatHistory: ""
    },
    withImage: false,
    expectedRisk: "低风险"
  },
  {
    name: "综合分析测试",
    data: {
      nickname: "综合测试用户",
      profession: "产品经理",
      age: "30",
      bioOrChatHistory: "我是一名产品经理，对用户体验有很高的要求。我认为良好的沟通是关系的基础，希望能找到一个理解我工作并支持我的伴侣。我喜欢旅行和摄影，也希望对方有自己的爱好。"
    },
    withImage: true,
    expectedRisk: "低风险"
  }
];

// 工具函数
function log(message, level = 'INFO') {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    INFO: '\x1b[36m',  // 青色
    SUCCESS: '\x1b[32m', // 绿色
    ERROR: '\x1b[31m',   // 红色
    WARNING: '\x1b[33m', // 黄色
    RESET: '\x1b[0m'     // 重置
  };
  
  console.log(`${colors[level]}[${timestamp}] ${level}: ${message}${colors.RESET}`);
}

// HTTP请求函数
async function makeRequest(url, method = 'GET', formData = null) {
  const fetch = (await import('node-fetch')).default;
  
  const options = {
    method,
    timeout: 120000, // 2分钟超时
  };
  
  if (formData) {
    options.body = formData;
    options.headers = formData.getHeaders();
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

// 系统健康检查
async function checkSystemHealth() {
  log('开始系统健康检查...');
  
  try {
    const response = await makeRequest(`${API_BASE_URL}/api/health`);
    
    if (response.ok) {
      const health = response.data;
      log(`✅ 系统状态: ${health.status}`);
      log(`✅ OpenAI配置: ${health.system_status.openai_configured ? '已配置' : '未配置'}`);
      log(`✅ RAG系统: ${health.system_status.rag_system}`);
      log(`✅ 多模态分析: ${health.system_status.multimodal_analysis}`);
      
      return health.system_status.openai_configured && health.system_status.rag_system === 'ready';
    } else {
      log(`❌ 健康检查失败: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`❌ 无法连接到服务器: ${error.message}`, 'ERROR');
    return false;
  }
}

// RAG系统状态检查
async function checkRAGStatus() {
  log('检查RAG系统状态...');
  
  try {
    const response = await makeRequest(`${API_BASE_URL}/api/rag-status`);
    
    if (response.ok) {
      const ragStatus = response.data;
      log(`✅ RAG系统就绪: ${ragStatus.rag_system_ready}`);
      log(`✅ 索引文件存在: ${ragStatus.index_exists}`);
      
      if (ragStatus.index_stats) {
        log(`📊 索引大小: ${Math.round(ragStatus.index_stats.size / 1024)}KB`);
      }
      
      return ragStatus.rag_system_ready;
    } else {
      log(`❌ RAG状态检查失败: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`❌ RAG状态检查错误: ${error.message}`, 'ERROR');
    return false;
  }
}

// 执行单个测试用例
async function runTestCase(testCase, index) {
  log(`\n🧪 执行测试 ${index + 1}/${testCases.length}: ${testCase.name}`, 'INFO');
  log(`📝 测试数据: ${JSON.stringify(testCase.data, null, 2)}`);
  
  try {
    // 构建表单数据
    const formData = new FormData();
    
    // 添加文本字段
    Object.keys(testCase.data).forEach(key => {
      formData.append(key, testCase.data[key]);
    });
    
    // 添加图片（如果需要）
    if (testCase.withImage && fs.existsSync(TEST_IMAGE_PATH)) {
      formData.append('images', fs.createReadStream(TEST_IMAGE_PATH));
      log(`📎 添加测试图片: ${path.basename(TEST_IMAGE_PATH)}`);
    }
    
    // 发送请求
    const startTime = Date.now();
    log('🚀 发送分析请求...');
    
    const response = await makeRequest(`${API_BASE_URL}/api/generate_warning_report`, 'POST', formData);
    const processingTime = Date.now() - startTime;
    
    if (response.ok) {
      const result = response.data;
      
      log(`✅ 请求成功 (${processingTime}ms)`, 'SUCCESS');
      log(`📊 处理时间: ${result.processing_time || 'N/A'}`);
      log(`🎯 风险等级: ${result.final_report?.risk_level || 'N/A'}`);
      log(`📈 置信度: ${result.final_report?.confidence_level || 'N/A'}`);
      log(`🖼️ 处理图片数: ${result.analysis_stats?.images_processed || 0}`);
      log(`🧠 RAG状态: ${result.analysis_stats?.rag_status || 'N/A'}`);
      
      // 验证预期结果
      if (testCase.expectedRisk && result.final_report?.risk_level) {
        const actualRisk = result.final_report.risk_level;
        if (actualRisk === testCase.expectedRisk) {
          log(`✅ 风险等级预期匹配: ${actualRisk}`, 'SUCCESS');
        } else {
          log(`⚠️ 风险等级预期不匹配: 预期 ${testCase.expectedRisk}, 实际 ${actualRisk}`, 'WARNING');
        }
      }
      
      // 检查关键字段
      const requiredFields = ['success', 'user_info', 'final_report', 'system_info'];
      const missingFields = requiredFields.filter(field => !(field in result));
      
      if (missingFields.length === 0) {
        log('✅ 所有必需字段都存在', 'SUCCESS');
      } else {
        log(`⚠️ 缺少字段: ${missingFields.join(', ')}`, 'WARNING');
      }
      
      return {
        success: true,
        testCase: testCase.name,
        processingTime,
        result
      };
      
    } else {
      log(`❌ 请求失败: ${response.status}`, 'ERROR');
      log(`错误信息: ${response.data.error || 'Unknown error'}`);
      
      return {
        success: false,
        testCase: testCase.name,
        error: response.data.error,
        status: response.status
      };
    }
    
  } catch (error) {
    log(`❌ 测试执行错误: ${error.message}`, 'ERROR');
    
    return {
      success: false,
      testCase: testCase.name,
      error: error.message
    };
  }
}

// 主测试函数
async function runFullTest() {
  console.log('\n🎯 ===== AI情感安全助理完整功能测试 =====\n');
  
  // 步骤1: 系统健康检查
  log('📋 步骤1: 系统健康检查', 'INFO');
  const isHealthy = await checkSystemHealth();
  
  if (!isHealthy) {
    log('❌ 系统健康检查失败，终止测试', 'ERROR');
    return;
  }
  
  // 步骤2: RAG系统检查
  log('\n📋 步骤2: RAG系统状态检查', 'INFO');
  const ragReady = await checkRAGStatus();
  
  if (!ragReady) {
    log('⚠️ RAG系统未就绪，将使用备用模式', 'WARNING');
  }
  
  // 步骤3: 检查测试图片
  log('\n📋 步骤3: 检查测试资源', 'INFO');
  if (fs.existsSync(TEST_IMAGE_PATH)) {
    const stats = fs.statSync(TEST_IMAGE_PATH);
    log(`✅ 测试图片就绪: ${path.basename(TEST_IMAGE_PATH)} (${Math.round(stats.size / 1024)}KB)`);
  } else {
    log(`⚠️ 测试图片不存在: ${TEST_IMAGE_PATH}`, 'WARNING');
    log('   将跳过需要图片的测试用例');
  }
  
  // 步骤4: 执行测试用例
  log('\n📋 步骤4: 执行功能测试', 'INFO');
  const results = [];
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    
    // 如果没有测试图片，跳过需要图片的测试
    if (testCase.withImage && !fs.existsSync(TEST_IMAGE_PATH)) {
      log(`⏭️ 跳过测试: ${testCase.name}（需要图片）`, 'WARNING');
      continue;
    }
    
    const result = await runTestCase(testCase, i);
    results.push(result);
    
    // 测试间隔
    if (i < testCases.length - 1) {
      log('⏸️ 等待 2 秒后继续下一个测试...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // 步骤5: 测试结果总结
  log('\n📋 步骤5: 测试结果总结', 'INFO');
  
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;
  
  log(`\n🎊 ===== 测试完成 =====`);
  log(`📊 总测试数: ${results.length}`);
  log(`✅ 成功: ${successCount}`, successCount > 0 ? 'SUCCESS' : 'ERROR');
  log(`❌ 失败: ${failureCount}`, failureCount === 0 ? 'SUCCESS' : 'ERROR');
  
  if (successCount > 0) {
    const avgTime = results
      .filter(r => r.success && r.processingTime)
      .reduce((sum, r) => sum + r.processingTime, 0) / successCount;
    log(`⏱️ 平均处理时间: ${Math.round(avgTime)}ms`);
  }
  
  // 详细结果
  log('\n📋 详细结果:');
  results.forEach((result, index) => {
    if (result.success) {
      log(`  ✅ ${result.testCase}: 成功 (${result.processingTime}ms)`, 'SUCCESS');
    } else {
      log(`  ❌ ${result.testCase}: ${result.error}`, 'ERROR');
    }
  });
  
  // 系统建议
  if (failureCount > 0) {
    log('\n🔧 建议检查:', 'WARNING');
    log('  1. 确认服务器运行在端口 3001');
    log('  2. 检查 OpenAI API 密钥配置');
    log('  3. 验证 RAG 系统索引文件');
    log('  4. 查看服务器日志获取详细错误信息');
  } else {
    log('\n🎉 所有测试通过！AI情感安全助理功能完整！', 'SUCCESS');
  }
}

// 运行测试
if (require.main === module) {
  runFullTest().catch(error => {
    log(`❌ 测试执行失败: ${error.message}`, 'ERROR');
    process.exit(1);
  });
}

module.exports = { runFullTest, checkSystemHealth, checkRAGStatus }; 
 
 
 
 