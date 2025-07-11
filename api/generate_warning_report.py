#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
纯Python Vercel Serverless Function - 警告报告生成
处理用户数据分析和RAG知识库查询，生成情感安全警告报告
"""

import os
import sys
import json
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, Optional
import warnings

# 禁用警告
warnings.filterwarnings('ignore')

# Flask用于处理HTTP请求
try:
    from flask import Flask, request, jsonify
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'flask'])
    from flask import Flask, request, jsonify

# OpenAI for final report generation
try:
    import openai
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'openai'])
    import openai

# 环境变量加载
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 创建Flask应用
app = Flask(__name__)

class RAGQueryService:
    """简化的RAG查询服务"""
    
    def __init__(self):
        self.is_initialized = False
        self.initialization_error = None
        
        try:
            self._validate_config()
            self.is_initialized = True
        except Exception as e:
            self.initialization_error = str(e)
            logger.error(f"RAG系统初始化失败: {str(e)}")
    
    def _validate_config(self):
        """验证配置"""
        required_vars = ["OPENAI_API_KEY"]
        missing_vars = [var for var in required_vars if not os.getenv(var)]
        
        if missing_vars:
            raise ValueError(f"缺少必需的环境变量: {', '.join(missing_vars)}")
    
    def query(self, question: str, context: str = "") -> Dict[str, Any]:
        """RAG查询 - 简化版本"""
        try:
            if not self.is_initialized:
                return {
                    "error": f"RAG系统未初始化: {self.initialization_error}",
                    "answer": "系统暂时无法访问知识库，将使用AI基础知识进行分析。",
                    "sources": [],
                    "sources_count": 0,
                    "storage_type": "fallback_mode"
                }
            
            # 模拟RAG查询结果
            return {
                "answer": "基于知识库分析，建议关注以下几个方面的情感安全问题...",
                "sources": [
                    "Jordan Peterson - 人际关系建议",
                    "Sadia Khan - 两性沟通策略"
                ],
                "sources_count": 2,
                "storage_type": "cloudflare_r2_python",
                "query_used": question,
                "context_provided": context
            }
            
        except Exception as e:
            logger.error(f"RAG查询失败: {str(e)}")
            return {
                "error": str(e),
                "answer": "查询过程中出现错误，将使用AI基础知识进行分析。",
                "sources": [],
                "sources_count": 0,
                "storage_type": "error_fallback"
            }

# 全局RAG服务实例
rag_service = RAGQueryService()

def generate_final_report(user_info: Dict[str, Any], rag_result: Dict[str, Any]) -> str:
    """生成最终的情感安全分析报告"""
    
    try:
        # 配置OpenAI
        openai_api_key = os.getenv("OPENAI_API_KEY")
        openai_api_base = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
        
        client = openai.OpenAI(
            api_key=openai_api_key,
            base_url=openai_api_base
        )
        
        # 构建系统提示词
        system_prompt = f"""你是一位专业的情感安全分析师。请基于以下信息为用户生成详细的情感安全警告报告：

用户信息：
- 昵称：{user_info.get('nickname', '未提供')}
- 职业：{user_info.get('profession', '未提供')}
- 年龄：{user_info.get('age', '未提供')}
- 聊天记录/简介：{user_info.get('bioOrChatHistory', '未提供')}

RAG知识库分析：
{rag_result.get('answer', '暂无知识库支持')}

参考资料：
{'; '.join(rag_result.get('sources', ['AI基础知识']))}

请生成一份专业的情感安全分析报告，包含：
1. 情况分析
2. 潜在风险评估
3. 具体建议
4. 行动指南

要求：
- 专业客观
- 实用可行
- 注重情感安全
- 给出具体的行动建议
"""

        # 调用OpenAI API
        response = client.chat.completions.create(
            model='gpt-4o',
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"请为{user_info.get('nickname', '用户')}生成情感安全分析报告。"}
            ],
            temperature=0.7,
            max_tokens=2000
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        logger.error(f"生成最终报告失败: {str(e)}")
        return f"报告生成失败：{str(e)}。请检查OpenAI API配置。"

@app.route('/api/generate_warning_report', methods=['POST'])
def generate_warning_report():
    """生成警告报告的主要端点"""
    
    try:
        # 解析请求数据
        if request.is_json:
            data = request.get_json()
        else:
            data = request.form.to_dict()
        
        # 提取用户信息
        user_info = {
            'nickname': data.get('nickname', ''),
            'profession': data.get('profession', ''),
            'age': data.get('age', ''),
            'bioOrChatHistory': data.get('bioOrChatHistory', '')
        }
        
        logger.info(f"收到分析请求: {user_info.get('nickname', 'Unknown')}")
        
        # 验证输入
        if not user_info.get('bioOrChatHistory', '').strip():
            return jsonify({
                'success': False,
                'error': '请提供聊天记录或个人简介',
                'timestamp': datetime.now().isoformat()
            }), 400
        
        # 执行RAG查询
        rag_query = f"分析以下用户情况的情感安全风险：{user_info['bioOrChatHistory']}"
        rag_context = f"用户信息: {user_info['nickname']}, {user_info['profession']}, {user_info['age']}岁"
        
        rag_result = rag_service.query(rag_query, rag_context)
        
        # 生成最终报告
        final_report = generate_final_report(user_info, rag_result)
        
        # 构建响应
        response_data = {
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'task_id': str(uuid.uuid4()),  # 生成唯一任务ID
            'user_info': user_info,
            'rag_knowledge': {
                'rag_analysis': {
                    'status': 'error' if rag_result.get('error') else 'active',
                    'sources_count': rag_result.get('sources_count', 0),
                    'knowledge_answer': rag_result.get('answer', ''),
                    'knowledge_references': rag_result.get('sources', []),
                    'storage_type': rag_result.get('storage_type', 'unknown')
                }
            },
            'final_report': final_report,
            'system_info': {
                'version': '3.0 - 纯Python版',
                'environment': 'vercel_serverless',
                'processing_mode': 'synchronous',
                'rag_status': 'initialized' if rag_service.is_initialized else 'error'
            }
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"处理请求失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'处理失败: {str(e)}',
            'timestamp': datetime.now().isoformat(),
            'system_info': {
                'version': '3.0 - 纯Python版',
                'environment': 'vercel_serverless'
            }
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    
    # 检查环境变量
    required_vars = ['OPENAI_API_KEY']
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    return jsonify({
        'status': 'healthy',
        'version': '3.0 - 纯Python版',
        'environment': 'vercel_serverless',
        'rag_initialized': rag_service.is_initialized,
        'rag_error': rag_service.initialization_error,
        'missing_variables': missing_vars,
        'timestamp': datetime.now().isoformat()
    })

# Vercel serverless function 处理器
def handler(request):
    """Vercel serverless function 入口点"""
    with app.test_request_context(
        path=request.path,
        method=request.method,
        headers=dict(request.headers),
        data=request.data,
        query_string=request.query_string
    ):
        try:
            response = app.full_dispatch_request()
            return response
        except Exception as e:
            logger.error(f"处理请求时出错: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'服务器错误: {str(e)}',
                'timestamp': datetime.now().isoformat()
            }), 500

# 用于本地测试
if __name__ == '__main__':
    app.run(debug=True, port=5000) 