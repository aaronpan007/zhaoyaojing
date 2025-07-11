#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG查询服务模块 (Cloudflare R2版本)
为后端API提供智能知识库查询功能
使用Cloudflare R2云存储代替本地storage
"""

# 优先加载环境变量 - 必须在所有其他代码之前
from dotenv import load_dotenv
load_dotenv()

import os
import sys
import json
import logging
from pathlib import Path
from typing import List, Dict, Any

# 完全禁用所有可能的输出到stdout
import warnings
warnings.filterwarnings('ignore')

# 重定向所有可能的输出到null
class DevNull:
    def write(self, msg):
        pass
    def flush(self):
        pass

# 在导入LlamaIndex之前，先设置环境变量禁用verbose输出
os.environ["LLAMA_INDEX_LOGGING_LEVEL"] = "CRITICAL"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# 临时重定向stdout，防止LlamaIndex的导入时输出
original_stdout = sys.stdout
sys.stdout = DevNull()

try:
    # LlamaIndex核心模块
    from llama_index.core import (
        StorageContext,
        load_index_from_storage,
        Settings,
        VectorStoreIndex
    )
    from llama_index.embeddings.openai import OpenAIEmbedding
    from llama_index.core.llms import MockLLM
    
    # S3兼容存储模块
    from llama_index.storage.kvstore.s3 import S3DBKVStore
    from llama_index.storage.docstore.s3 import S3DocumentStore
    from llama_index.vector_stores.simple import SimpleVectorStore
    
    # S3FS文件系统（S3兼容）
    import s3fs
    
finally:
    # 恢复stdout
    sys.stdout = original_stdout

# 配置日志，重定向到stderr避免污染stdout
logging.basicConfig(
    level=logging.CRITICAL,  # 只输出严重错误
    stream=sys.stderr,       # 重定向到stderr
    format='%(message)s'
)
logger = logging.getLogger(__name__)

class RAGR2QueryService:
    """RAG查询服务类 - Cloudflare R2版本"""
    
    def __init__(self):
        """
        初始化RAG查询服务 - 使用Cloudflare R2云存储
        """
        self.index = None
        self.query_engine = None
        self.s3fs = None
        
        # 初始化状态
        self.is_initialized = False
        self.initialization_error = None
        
        try:
            # 验证R2配置
            self._validate_r2_config()
            
            # 配置LlamaIndex设置
            self._setup_llama_index()
            
            # 初始化S3FS文件系统
            self._setup_s3fs()
            
            # 加载索引
            if self.load_index_from_r2():
                self.is_initialized = True
            else:
                self.initialization_error = "从R2加载索引失败"
                
        except Exception as e:
            self.initialization_error = str(e)
            logger.error(f"RAG系统初始化失败: {str(e)}")
    
    def _validate_r2_config(self):
        """验证Cloudflare R2配置"""
        required_vars = [
            "CLOUDFLARE_ACCOUNT_ID",
            "R2_ACCESS_KEY_ID", 
            "R2_SECRET_ACCESS_KEY",
            "BUCKET_NAME"
        ]
        
        missing_vars = []
        for var in required_vars:
            if not os.getenv(var):
                missing_vars.append(var)
        
        if missing_vars:
            raise ValueError(f"缺少必需的环境变量: {', '.join(missing_vars)}")
        
        logger.debug("R2配置验证通过")
    
    def _setup_llama_index(self):
        """配置LlamaIndex全局设置 - 使用OpenAI"""
        
        # 检查OpenAI API密钥
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("未找到OPENAI_API_KEY环境变量！请在.env文件中配置您的OpenAI API密钥")
        
        # 获取OpenAI API基础URL
        openai_api_base = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
        
        # 使用OpenAI embedding
        Settings.embed_model = OpenAIEmbedding(
            model="text-embedding-3-small",
            api_key=openai_api_key,
            api_base=openai_api_base
        )
        
        # 使用MockLLM避免LLM调用，同时设置极其保守的参数
        Settings.llm = MockLLM(max_tokens=128)
        
        # 设置极其保守的上下文参数避免超出限制
        Settings.chunk_size = 128    # 极小的chunk size
        Settings.chunk_overlap = 20   # 极小的overlap
        Settings.context_window = 512 # 极小的上下文窗口
        Settings.num_output = 64      # 极小的输出长度
        
        logger.debug("LlamaIndex配置完成 (OpenAI Embedding)")
    
    def _setup_s3fs(self):
        """初始化S3FS文件系统连接R2"""
        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
        access_key = os.getenv("R2_ACCESS_KEY_ID")
        secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
        
        # Cloudflare R2的endpoint URL格式
        endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
        
        try:
            self.s3fs = s3fs.S3FileSystem(
                key=access_key,
                secret=secret_key,
                endpoint_url=endpoint_url,
                use_ssl=True
            )
            
            # 测试连接
            bucket_name = os.getenv("BUCKET_NAME")
            if not self.s3fs.exists(bucket_name):
                raise ValueError(f"R2存储桶不存在或无法访问: {bucket_name}")
            
            logger.debug(f"S3FS连接到R2成功: {endpoint_url}")
            
        except Exception as e:
            raise ValueError(f"连接Cloudflare R2失败: {str(e)}")
    
    def load_index_from_r2(self):
        """从Cloudflare R2加载索引"""
        try:
            bucket_name = os.getenv("BUCKET_NAME")
            
            # 检查必需的索引文件是否存在
            required_files = [
                f"{bucket_name}/index_store.json",
                f"{bucket_name}/default__vector_store.json",
                f"{bucket_name}/docstore.json"
            ]
            
            for file_path in required_files:
                if not self.s3fs.exists(file_path):
                    logger.error(f"R2中未找到必需文件: {file_path}")
                    return False
            
            # 临时重定向stdout，防止loading信息输出
            original_stdout = sys.stdout
            sys.stdout = DevNull()
            
            try:
                # 配置S3兼容的存储上下文
                account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
                access_key = os.getenv("R2_ACCESS_KEY_ID")
                secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
                endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
                
                # 创建基于R2的KV存储
                kv_store = S3DBKVStore(
                    s3_bucket=bucket_name,
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    aws_endpoint_url=endpoint_url
                )
                
                # 创建基于R2的文档存储
                docstore = S3DocumentStore(
                    s3_bucket=bucket_name,
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    aws_endpoint_url=endpoint_url
                )
                
                # 创建存储上下文
                storage_context = StorageContext.from_defaults(
                    docstore=docstore,
                    index_store=kv_store,
                    vector_store=SimpleVectorStore()  # 使用简单向量存储
                )
                
                # 从R2存储中加载索引
                self.index = load_index_from_storage(storage_context)
                
                # 创建查询引擎 - 使用最最保守的设置避免上下文问题
                self.query_engine = self.index.as_query_engine(
                    similarity_top_k=5,         # 优化：取5个最相关的文档片段，提升知识库覆盖度
                    response_mode="compact",    # 使用compact模式
                    text_qa_template=None,      # 不使用模板
                    streaming=False,
                    verbose=False               # 禁用verbose输出
                )
                
                logger.debug("从R2成功加载RAG索引")
                
            finally:
                # 恢复stdout
                sys.stdout = original_stdout
            
            return True
            
        except Exception as e:
            logger.error(f"从R2加载索引失败: {str(e)}")
            return False
    
    def query(self, question: str, context: str = "", diagnostic_mode: bool = False) -> Dict[str, Any]:
        """
        执行RAG查询
        
        Args:
            question: 查询问题
            context: 额外上下文
            diagnostic_mode: 是否启用诊断模式，输出详细检索信息到stderr
            
        Returns:
            查询结果字典
        """
        if not self.is_initialized:
            return {
                "error": f"RAG系统未初始化: {self.initialization_error}",
                "answer": "",
                "sources": [],
                "query": question,
                "context": context,
                "sources_count": 0
            }
        
        try:
            # 构建查询 - 截断过长的内容避免上下文超限
            if len(question) > 100:
                question = question[:100] + "..."
            
            if context and len(context) > 50:
                context = context[:50] + "..."
            
            full_query = f"{question}\n{context}" if context else question
            
            # 临时重定向stdout，防止查询过程的输出
            original_stdout = sys.stdout
            sys.stdout = DevNull()
            
            try:
                # 执行查询
                response = self.query_engine.query(full_query)
            finally:
                # 恢复stdout
                sys.stdout = original_stdout
            
            # 提取源信息
            sources = []
            if hasattr(response, 'source_nodes'):
                # 🔍 诊断模式：详细输出检索信息到stderr
                if diagnostic_mode:
                    logger.info(f"🔍 检索到 {len(response.source_nodes)} 个相关文档片段:")
                
                for i, node in enumerate(response.source_nodes):
                    similarity_score = getattr(node, 'score', 0.0)
                    
                    # 获取元数据
                    metadata = getattr(node.node, 'metadata', {})
                    file_name = metadata.get('file_name', 'unknown')
                    file_path = metadata.get('file_path', '')
                    
                    # 截断文本内容进行预览
                    text_preview = node.node.text[:200] + "..." if len(node.node.text) > 200 else node.node.text
                    
                    source_info = {
                        "file_name": file_name,
                        "file_path": file_path,
                        "similarity_score": round(similarity_score, 3),
                        "text_preview": text_preview,
                        "node_id": node.node.node_id
                    }
                    
                    sources.append(source_info)
                    
                    # 🔍 诊断模式：输出详细信息到stderr
                    if diagnostic_mode:
                        logger.info(f"  📄 片段 {i+1}: {file_name}")
                        logger.info(f"     相似度: {similarity_score:.3f}")
                        logger.info(f"     预览: {text_preview[:100]}...")
                        logger.info("")
            
            # 🔍 诊断模式：输出最终答案到stderr
            if diagnostic_mode:
                logger.info(f"🎯 RAG系统返回答案:")
                logger.info(f"   查询: {question}")
                logger.info(f"   答案: {str(response)[:200]}...")
                logger.info(f"   使用源数量: {len(sources)}")
                logger.info("=" * 50)
            
            return {
                "answer": str(response),
                "sources": sources,
                "query": question,
                "context": context,
                "sources_count": len(sources),
                "storage_type": "cloudflare_r2"
            }
            
        except Exception as e:
            logger.error(f"RAG查询失败: {str(e)}")
            return {
                "error": f"查询失败: {str(e)}",
                "answer": "",
                "sources": [],
                "query": question,
                "context": context,
                "sources_count": 0
            }

def create_rag_query(user_input: dict, image_analysis: list) -> str:
    """
    根据用户输入和图片分析结果创建RAG查询字符串
    """
    query_parts = []
    
    if user_input.get('nickname'):
        query_parts.append(f"分析对象昵称: {user_input['nickname']}")
    
    if user_input.get('profession'):
        query_parts.append(f"职业: {user_input['profession']}")
    
    if user_input.get('age'):
        query_parts.append(f"年龄: {user_input['age']}")
    
    if user_input.get('bioOrChatHistory'):
        query_parts.append(f"个人简介或聊天记录: {user_input['bioOrChatHistory']}")
    
    if image_analysis:
        query_parts.append("图片分析结果:")
        for i, analysis in enumerate(image_analysis):
            query_parts.append(f"图片{i+1}: {analysis.get('analysis', '')}")
    
    return " ".join(query_parts)

def generate_final_report(rag_result: dict, user_input: dict, image_analysis: list) -> dict:
    """
    基于RAG查询结果生成最终分析报告
    """
    try:
        # 基础报告结构
        report = {
            "risk_level": "unknown",
            "key_findings": {},
            "final_suggestion": "",
            "confidence_level": "medium",
            "professional_insight": "",
            "analysis_metadata": {
                "processed_images": len(image_analysis),
                "analysis_timestamp": "",
                "processing_time": "",
                "rag_sources_count": rag_result.get("sources_count", 0),
                "storage_type": rag_result.get("storage_type", "cloudflare_r2")
            }
        }
        
        # 如果RAG查询成功，使用返回的分析
        if rag_result.get("answer") and not rag_result.get("error"):
            # 简单的风险等级判断逻辑
            answer_text = rag_result["answer"].lower()
            
            if any(word in answer_text for word in ["高风险", "危险", "警告", "不建议"]):
                report["risk_level"] = "high"
            elif any(word in answer_text for word in ["中等风险", "谨慎", "注意"]):
                report["risk_level"] = "medium"
            elif any(word in answer_text for word in ["低风险", "安全", "可以"]):
                report["risk_level"] = "low"
            else:
                report["risk_level"] = "medium"
            
            # 设置主要发现和建议
            report["professional_insight"] = rag_result["answer"]
            report["final_suggestion"] = "基于专业知识库分析，请参考上述详细分析。"
            
            # 设置关键发现
            if rag_result.get("sources"):
                report["key_findings"]["knowledge_sources"] = f"引用了{len(rag_result['sources'])}个专业资料"
            
        else:
            # RAG查询失败的后备方案
            report["professional_insight"] = "由于知识库查询失败，无法提供专业分析。建议手动评估。"
            report["final_suggestion"] = "建议寻求专业人士意见。"
            report["risk_level"] = "unknown"
        
        return report
        
    except Exception as e:
        logger.error(f"生成最终报告失败: {str(e)}")
        return {
            "risk_level": "unknown",
            "key_findings": {"error": "报告生成失败"},
            "final_suggestion": "系统出错，请稍后重试。",
            "confidence_level": "low",
            "professional_insight": f"报告生成出错: {str(e)}",
            "analysis_metadata": {
                "processed_images": len(image_analysis),
                "analysis_timestamp": "",
                "processing_time": "",
                "error": str(e)
            }
        }

def main():
    """测试函数"""
    print("测试RAG R2查询服务...")
    
    # 创建服务实例
    service = RAGR2QueryService()
    
    if not service.is_initialized:
        print(f"服务初始化失败: {service.initialization_error}")
        return
    
    print("服务初始化成功！")
    
    # 测试查询
    test_query = "如何识别约会中的红旗信号？"
    result = service.query(test_query, diagnostic_mode=True)
    
    print(f"查询结果: {result}")

if __name__ == "__main__":
    main() 