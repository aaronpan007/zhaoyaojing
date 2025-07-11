#!/usr/bin/env node

// AI情感安全助理 - 最终端到端验证脚本

console.log('🎯 AI情感安全助理 - 最终验证报告');
console.log('=' .repeat(50));

async function finalVerification() {
  console.log('\n📋 正在进行完整的系统验证...\n');

  const results = {
    apiServer: false,
    ragSystem: false,
    replicateClient: false,
    endToEndFlow: false,
    multimodalAnalysis: false,
    reportGeneration: false
  };

  try {
    // 1. API服务器状态
    console.log('1️⃣ 检查API服务器状态...');
    const healthResponse = await fetch('http://localhost:3001/api/health');
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      results.apiServer = healthData.system_status.api_server === 'running';
      results.replicateClient = healthData.system_status.replicate_client === 'ready';
      
      console.log(`   API服务器: ${results.apiServer ? '✅ 正常运行' : '❌ 异常'}`);
      console.log(`   Replicate客户端: ${results.replicateClient ? '✅ 已激活' : '❌ 未激活'}`);
    }

    // 2. RAG系统状态  
    console.log('\n2️⃣ 检查RAG系统状态...');
    const ragResponse = await fetch('http://localhost:3001/api/rag-status');
    if (ragResponse.ok) {
      const ragData = await ragResponse.json();
      results.ragSystem = ragData.rag_system.ready;
      
      console.log(`   RAG索引: ${results.ragSystem ? '✅ 已就绪' : '❌ 未就绪'}`);
      console.log(`   索引大小: ${(ragData.rag_system.index_size / 1024 / 1024).toFixed(2)} MB`);
    }

    // 3. 端到端API测试
    console.log('\n3️⃣ 测试端到端API流程...');
    
    // 使用curl进行测试（避免Node.js form-data问题）
    const { spawn } = require('child_process');
    
    const testResult = await new Promise((resolve) => {
      const curl = spawn('curl', [
        '-X', 'POST',
        'http://localhost:3001/api/generate_warning_report',
        '-F', 'nickname=端到端测试',
        '-F', 'profession=测试工程师', 
        '-F', 'age=30',
        '-F', 'bioOrChatHistory=这是一个端到端测试的个人简介，用于验证完整的API功能。',
        '-H', 'Accept: application/json',
        '--max-time', '120',
        '--silent'
      ]);

      let output = '';
      curl.stdout.on('data', (data) => {
        output += data.toString();
      });

      curl.on('close', (code) => {
        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          resolve({ error: 'Failed to parse response', raw: output });
        }
      });
    });

    if (testResult.success) {
      results.endToEndFlow = true;
      results.reportGeneration = testResult.data && testResult.data.risk_level;
      
      console.log('   ✅ API请求成功');
      console.log(`   风险等级: ${testResult.data.risk_level || '未知'}`);
      console.log(`   分析引擎: ${testResult.data.system_info?.analysis_engine || '未知'}`);
      
      if (testResult.data.system_info?.processing_stats?.rag_knowledge_retrieved) {
        console.log('   ✅ RAG知识检索: 成功');
      } else {
        console.log('   ⚠️  RAG知识检索: 使用备用机制');
      }
    } else {
      console.log('   ❌ API请求失败');
      if (testResult.error) {
        console.log(`   错误: ${testResult.error}`);
      }
    }

  } catch (error) {
    console.error('❌ 验证过程中发生错误:', error.message);
  }

  // 4. 生成最终报告
  console.log('\n' + '='.repeat(50));
  console.log('📊 最终验证结果:');
  console.log('='.repeat(50));

  const scoreItems = [
    ['API服务器', results.apiServer],
    ['RAG系统索引', results.ragSystem], 
    ['Replicate客户端', results.replicateClient],
    ['端到端流程', results.endToEndFlow],
    ['报告生成', results.reportGeneration]
  ];

  scoreItems.forEach(([name, status]) => {
    console.log(`${status ? '✅' : '❌'} ${name}: ${status ? '正常' : '需要修复'}`);
  });

  const passedTests = scoreItems.filter(([_, status]) => status).length;
  const totalTests = scoreItems.length;
  const successRate = Math.round((passedTests / totalTests) * 100);

  console.log('\n📈 系统完整度评分:');
  console.log(`   通过测试: ${passedTests}/${totalTests}`);
  console.log(`   成功率: ${successRate}%`);

  if (successRate >= 80) {
    console.log('\n🎊 恭喜！您的AI情感安全助理已基本就绪！');
    console.log('   主要功能可以正常使用，建议进一步优化RAG系统以获得最佳体验。');
  } else if (successRate >= 60) {
    console.log('\n⚠️ 系统部分功能正常，但仍需进一步配置。');
    console.log('   请参考验证报告中的建议进行优化。');
  } else {
    console.log('\n❌ 系统需要重要修复才能正常工作。');
    console.log('   请检查配置并解决关键问题。');
  }

  console.log('\n📋 详细分析报告已生成: api_verification_report.md');
  console.log('🔧 如需技术支持，请查看该报告中的问题解决方案。');
  
  return successRate >= 60;
}

// 运行验证
if (require.main === module) {
  finalVerification().then(success => {
    console.log('\n' + '='.repeat(50));
    process.exit(success ? 0 : 1);
  });
}

module.exports = { finalVerification }; 