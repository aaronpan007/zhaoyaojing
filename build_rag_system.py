#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI情感安全助手 - RAG系统构建脚本 (OpenAI代理版本)
使用LlamaIndex + OpenAI API (通过代理) 构建基于本地知识库的智能查询系统
"""

# 优先加载环境变量 - 必须在所有其他代码之前
from dotenv import load_dotenv
load_dotenv()

import os
import sys
from pathlib import Path
from typing import List, Any
import logging

# 环境检查：确保使用OpenAI API代理
def validate_environment():
    """验证环境配置，确保OpenAI API密钥可用"""
    # 检查必需的OpenAI API密钥
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key or openai_key == "your_openai_api_key_here":
        print("❌ 错误: 未找到有效的OPENAI_API_KEY环境变量！")
        print("请在.env文件中配置您的OpenAI API密钥")
        print('格式: OPENAI_API_KEY="sk-your_api_key_here"')
        sys.exit(1)
    
    # 设置OpenAI代理配置
    proxy_base_url = "https://api.gptsapi.net/v1"
    os.environ["OPENAI_API_BASE"] = proxy_base_url
    
    print("✅ 环境验证通过，已配置OpenAI API代理")
    print(f"🔗 API代理地址: {proxy_base_url}")
    return openai_key, proxy_base_url

# 执行环境验证
api_key, base_url = validate_environment()

# LlamaIndex核心模块
from llama_index.core import (
    VectorStoreIndex, 
    SimpleDirectoryReader, 
    StorageContext,
    load_index_from_storage,
    Settings
)
from llama_index.embeddings.openai import OpenAIEmbedding

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('rag_build.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class RAGSystemBuilder:
    """RAG系统构建器 - OpenAI代理版本"""
    
    def __init__(self, knowledge_path: str = "my_knowledge", storage_path: str = "storage"):
        """
        初始化RAG系统构建器
        
        Args:
            knowledge_path: 知识库文件夹路径
            storage_path: 索引存储路径
        """
        self.knowledge_path = Path(knowledge_path)
        self.storage_path = Path(storage_path)
        self.index = None
        self.query_engine = None
        
        # 创建存储目录
        self.storage_path.mkdir(exist_ok=True)
        
        # 配置LlamaIndex设置
        self._setup_llama_index()
    
    def _setup_llama_index(self):
        """配置LlamaIndex全局设置 - OpenAI代理版本"""
        logger.info("⚙️ 配置LlamaIndex全局设置...")
        
        # 创建OpenAI Embedding实例，使用代理地址
        self.embed_model = OpenAIEmbedding(
            model="text-embedding-3-small",  # 使用高效的embedding模型
            api_key=api_key,
            api_base="https://api.gptsapi.net/v1",  # 使用正确的代理地址
            embed_batch_size=10,  # 减少批处理大小以避免速率限制
            max_retries=5  # 增加重试次数
        )
        
        # 设置全局配置
        Settings.embed_model = self.embed_model
        Settings.llm = None  # 明确禁用LLM（在后端处理）
        Settings.chunk_size = 1024
        Settings.chunk_overlap = 100
        
        logger.info("✅ LlamaIndex配置完成")
        logger.info(f"🧠 Embedding模型: text-embedding-3-small")
        logger.info(f"🔗 API代理地址: {base_url}")
        logger.info("🚫 LLM已禁用，将在后端处理")
    
    def check_knowledge_base(self) -> bool:
        """检查知识库文件夹是否存在"""
        if not self.knowledge_path.exists():
            logger.error(f"❌ 知识库文件夹不存在: {self.knowledge_path}")
            return False
        
        # 统计文件数量
        supported_extensions = {'.pdf', '.txt', '.docx'}
        file_count = 0
        
        for ext in supported_extensions:
            count = len(list(self.knowledge_path.rglob(f"*{ext}")))
            if count > 0:
                logger.info(f"📁 发现 {count} 个 {ext} 文件")
                file_count += count
        
        if file_count == 0:
            logger.error("❌ 未发现任何支持的文档文件(.pdf, .txt, .docx)")
            return False
        
        logger.info(f"✅ 知识库检查完成，共发现 {file_count} 个文档文件")
        return True
    
    def load_documents(self):
        """加载所有文档"""
        logger.info("📚 开始加载文档...")
        
        try:
            # 使用SimpleDirectoryReader递归加载所有支持的文档
            reader = SimpleDirectoryReader(
                input_dir=str(self.knowledge_path),
                recursive=True,
                required_exts=[".pdf", ".txt", ".docx"],
                encoding="utf-8"
            )
            
            documents = reader.load_data()
            
            if not documents:
                logger.error("❌ 未能加载任何文档！")
                return None
            
            logger.info(f"✅ 成功加载 {len(documents)} 个文档片段")
            
            # 显示文档来源统计
            sources = set()
            for doc in documents:
                if hasattr(doc, 'metadata') and 'file_path' in doc.metadata:
                    sources.add(doc.metadata['file_path'])
            
            logger.info(f"📂 文档来源: {len(sources)} 个不同文件")
            
            return documents
            
        except Exception as e:
            logger.error(f"❌ 文档加载失败: {str(e)}")
            return None
    
    def build_index(self, documents):
        """构建向量索引 - 使用OpenAI Embedding"""
        logger.info("🏗️ 开始构建向量索引...")
        logger.info(f"🧠 使用模型: text-embedding-3-small")
        logger.info(f"🔗 API代理地址: {base_url}")
        logger.info("⏳ 开始处理文档，这可能需要一些时间...")
        
        try:
            # 使用OpenAI embedding模型创建向量索引
            self.index = VectorStoreIndex.from_documents(
                documents,
                embed_model=self.embed_model,  # 明确指定我们的embedding模型
                show_progress=True,
                use_async=False  # 避免并发问题
            )
            
            logger.info("🎉 向量索引构建完成！")
            return True
            
        except Exception as e:
            logger.error(f"❌ 索引构建失败: {str(e)}")
            logger.error(f"详细错误信息: {repr(e)}")
            return False
    
    def save_index(self):
        """持久化保存索引"""
        if not self.index:
            logger.error("❌ 没有可保存的索引")
            return False
        
        logger.info("💾 保存索引到本地存储...")
        
        try:
            # 保存索引到指定目录
            self.index.storage_context.persist(persist_dir=str(self.storage_path))
            logger.info(f"✅ 索引已保存到: {self.storage_path}")
            return True
            
        except Exception as e:
            logger.error(f"❌ 索引保存失败: {str(e)}")
            return False
    
    def load_existing_index(self):
        """加载已存在的索引"""
        if not (self.storage_path / "index_store.json").exists():
            logger.info("📝 未发现已存在的索引文件")
            return False
        
        logger.info("📂 加载已存在的索引...")
        
        try:
            # 确保使用相同的embedding模型配置
            Settings.embed_model = self.embed_model
            
            # 从存储中加载索引
            storage_context = StorageContext.from_defaults(persist_dir=str(self.storage_path))
            self.index = load_index_from_storage(storage_context)
            
            logger.info("✅ 成功加载已存在的索引")
            logger.info(f"🧠 使用embedding模型: text-embedding-3-small")
            return True
            
        except Exception as e:
            logger.error(f"❌ 加载索引失败: {str(e)}")
            logger.error(f"详细错误信息: {repr(e)}")
            return False
    
    def create_query_engine(self):
        """创建查询引擎"""
        if not self.index:
            logger.error("❌ 需要先构建或加载索引")
            return False
        
        logger.info("🔍 创建查询引擎...")
        
        try:
            # 创建查询引擎，配置相似度搜索参数
            self.query_engine = self.index.as_query_engine(
                similarity_top_k=5,
                response_mode="compact"
            )
            
            logger.info("✅ 查询引擎创建完成！")
            return True
            
        except Exception as e:
            logger.error(f"❌ 查询引擎创建失败: {str(e)}")
            return False
    
    def test_query(self, test_question: str = "什么是红药丸理论？"):
        """测试查询功能"""
        if not self.query_engine:
            logger.error("❌ 查询引擎未就绪")
            return
        
        logger.info(f"🧪 测试查询: {test_question}")
        
        try:
            # 注意：这里只测试检索，不进行LLM回答
            retriever = self.index.as_retriever(similarity_top_k=3)
            nodes = retriever.retrieve(test_question)
            
            logger.info("✅ 查询测试成功！")
            logger.info(f"📝 检索到 {len(nodes)} 个相关文档片段")
            
            for i, node in enumerate(nodes, 1):
                logger.info(f"   📄 片段 {i}: {node.text[:100]}...")
            
        except Exception as e:
            logger.error(f"❌ 查询测试失败: {str(e)}")
    
    def build_complete_system(self, force_rebuild: bool = False):
        """构建完整的RAG系统"""
        logger.info("🚀 开始构建AI情感安全助手RAG系统 (OpenAI代理版本)...")
        
        # 1. 检查知识库
        if not self.check_knowledge_base():
            return False
        
        # 2. 尝试加载已存在的索引（如果不强制重建）
        if not force_rebuild and self.load_existing_index():
            logger.info("💡 使用已存在的索引，跳过重建步骤")
        else:
            # 3. 加载文档
            documents = self.load_documents()
            if not documents:
                return False
            
            # 4. 构建索引
            if not self.build_index(documents):
                return False
            
            # 5. 保存索引
            if not self.save_index():
                return False
        
        # 6. 创建查询引擎
        if not self.create_query_engine():
            return False
        
        # 7. 测试查询
        self.test_query()
        
        logger.info("🎉 RAG系统构建完成！")
        logger.info("📊 系统摘要:")
        logger.info(f"   🧠 Embedding模型: OpenAI text-embedding-3-small")
        logger.info(f"   🔗 API代理地址: {base_url}")
        logger.info(f"   📚 知识库路径: {self.knowledge_path}")
        logger.info(f"   💾 索引存储: {self.storage_path}")
        logger.info(f"   🔍 查询引擎: 已就绪")
        
        return True

def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="构建RAG知识库系统 (OpenAI代理版本)")
    parser.add_argument("--rebuild", action="store_true", help="强制重建索引")
    parser.add_argument("--knowledge", default="my_knowledge", help="知识库文件夹路径")
    parser.add_argument("--storage", default="storage", help="索引存储路径")
    
    args = parser.parse_args()
    
    # 创建RAG构建器
    builder = RAGSystemBuilder(
        knowledge_path=args.knowledge,
        storage_path=args.storage
    )
    
    # 构建系统
    success = builder.build_complete_system(force_rebuild=args.rebuild)
    
    if success:
        logger.info("✅ RAG系统构建成功！")
        logger.info("💡 下一步：启动后端服务测试查询功能")
        sys.exit(0)
    else:
        logger.error("❌ RAG系统构建失败！")
        logger.error("💡 请检查日志文件获取详细错误信息")
        sys.exit(1)

if __name__ == "__main__":
    main() 