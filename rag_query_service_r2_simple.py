#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化版 RAG查询服务模块 (Cloudflare R2版本)
下载R2索引文件到临时目录，然后使用标准方法加载
"""

# 优先加载环境变量 - 必须在所有其他代码之前
from dotenv import load_dotenv
load_dotenv()

import os
import sys
import json
import logging
import tempfile
import shutil
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
        Settings
    )
    from llama_index.embeddings.openai import OpenAIEmbedding
    from llama_index.core.llms import MockLLM
    
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

class RAGR2SimpleQueryService:
    """简化版 RAG查询服务类 - Cloudflare R2版本"""
    
    def __init__(self):
        """
        初始化RAG查询服务 - 使用Cloudflare R2云存储
        """
        self.index = None
        self.query_engine = None
        self.s3fs = None
        self.temp_dir = None
        
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
            
            # 下载并加载索引
            if self.download_and_load_index():
                self.is_initialized = True
            else:
                self.initialization_error = "从R2下载并加载索引失败"
                
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
        except Exception as e:
            raise ValueError(f"连接Cloudflare R2失败: {str(e)}")
    
    def download_and_load_index(self):
        """从R2下载索引文件到临时目录并加载"""
        try:
            bucket_name = os.getenv("BUCKET_NAME")
            
            # 创建临时目录
            self.temp_dir = tempfile.mkdtemp(prefix="rag_r2_")
            temp_storage = Path(self.temp_dir)
            
            # 需要下载的文件
            required_files = [
                "index_store.json",
                "default__vector_store.json",
                "docstore.json"
            ]
            
            # 下载必需文件
            for filename in required_files:
                remote_path = f"{bucket_name}/{filename}"
                local_path = temp_storage / filename
                
                if not self.s3fs.exists(remote_path):
                    logger.error(f"R2中未找到必需文件: {remote_path}")
                    return False
                
                # 下载文件
                self.s3fs.get_file(remote_path, str(local_path))
                
                if not local_path.exists():
                    logger.error(f"下载文件失败: {filename}")
                    return False
            
            # 临时重定向stdout，防止loading信息输出
            original_stdout = sys.stdout
            sys.stdout = DevNull()
            
            try:
                # 从临时目录加载索引
                storage_context = StorageContext.from_defaults(persist_dir=str(temp_storage))
                self.index = load_index_from_storage(storage_context)
                
                # 创建查询引擎
                self.query_engine = self.index.as_query_engine(
                    similarity_top_k=5,         # 优化：取5个最相关的文档片段，提升知识库覆盖度
                    response_mode="compact",    # 使用compact模式
                    text_qa_template=None,      # 不使用模板
                    streaming=False,
                    verbose=False               # 禁用verbose输出
                )
                
            finally:
                # 恢复stdout
                sys.stdout = original_stdout
            
            return True
            
        except Exception as e:
            logger.error(f"从R2下载并加载索引失败: {str(e)}")
            return False
    
    def cleanup(self):
        """清理临时文件"""
        if self.temp_dir and Path(self.temp_dir).exists():
            try:
                shutil.rmtree(self.temp_dir)
            except:
                pass
    
    def __del__(self):
        """析构函数，自动清理"""
        self.cleanup()
    
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
                    logger.info(f"🔍 R2检索到 {len(response.source_nodes)} 个相关文档片段:")
                
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
                        logger.info(f"  📄 R2片段 {i+1}: {file_name}")
                        logger.info(f"     相似度: {similarity_score:.3f}")
                        logger.info(f"     预览: {text_preview[:100]}...")
                        logger.info("")
            
            # 🔍 诊断模式：输出最终答案到stderr
            if diagnostic_mode:
                logger.info(f"🎯 R2 RAG系统返回答案:")
                logger.info(f"   查询: {question}")
                logger.info(f"   答案: {str(response)[:200]}...")
                logger.info(f"   使用R2源数量: {len(sources)}")
                logger.info("=" * 50)
            
            return {
                "answer": str(response),
                "sources": sources,
                "query": question,
                "context": context,
                "sources_count": len(sources),
                "storage_type": "cloudflare_r2_simple"
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

def stdin_handler():
    """处理从stdin输入的JSON查询"""
    try:
        # 读取stdin中的JSON数据
        input_data = sys.stdin.read().strip()
        
        if not input_data:
            return {
                "error": "未收到输入数据",
                "answer": "",
                "sources": [],
                "sources_count": 0
            }
        
        # 解析JSON
        try:
            data = json.loads(input_data)
        except json.JSONDecodeError as e:
            return {
                "error": f"JSON解析失败: {str(e)}",
                "answer": "",
                "sources": [],
                "sources_count": 0
            }
        
        # 提取查询参数
        query = data.get('query', '')
        context = data.get('context', '')
        diagnostic_mode = data.get('diagnostic_mode', False)
        
        if not query:
            return {
                "error": "缺少query参数",
                "answer": "",
                "sources": [],
                "sources_count": 0
            }
        
        # 创建服务实例并执行查询
        service = RAGR2SimpleQueryService()
        
        if not service.is_initialized:
            return {
                "error": f"RAG系统初始化失败: {service.initialization_error}",
                "answer": "",
                "sources": [],
                "sources_count": 0
            }
        
        # 执行查询
        result = service.query(query, context, diagnostic_mode)
        
        # 清理临时文件
        service.cleanup()
        
        return result
        
    except Exception as e:
        return {
            "error": f"处理查询时出错: {str(e)}",
            "answer": "",
            "sources": [],
            "sources_count": 0
        }

def main():
    """主函数 - 判断是否从stdin读取数据还是运行测试"""
    import select
    
    # 检查是否有stdin输入
    if select.select([sys.stdin], [], [], 0)[0]:
        # 有stdin输入，处理JSON查询
        result = stdin_handler()
        print(json.dumps(result, ensure_ascii=False, indent=None))
    else:
        # 没有stdin输入，运行测试
        print("🧪 测试简化版R2 RAG查询服务...")
        
        # 创建服务实例
        service = RAGR2SimpleQueryService()
        
        if not service.is_initialized:
            print(f"❌ 服务初始化失败: {service.initialization_error}")
            return
        
        print("✅ 服务初始化成功！")
        
        # 测试查询
        test_query = "如何识别约会中的红旗信号？"
        result = service.query(test_query, diagnostic_mode=True)
        
        if result.get("error"):
            print(f"❌ 查询失败: {result['error']}")
        else:
            print(f"✅ 查询成功!")
            print(f"📄 使用了 {result.get('sources_count', 0)} 个专业资料")
            print(f"💡 答案预览: {result.get('answer', '')[:200]}...")
        
        # 清理
        service.cleanup()

if __name__ == "__main__":
    main() 