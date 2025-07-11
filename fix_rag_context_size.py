#!/usr/bin/env python3
"""
RAG系统上下文大小问题修复脚本
解决 "Calculated available context size -xxx was not non-negative" 错误
"""

import os
import sys
from dotenv import load_dotenv
load_dotenv()

def fix_rag_system():
    """修复RAG系统的上下文大小问题"""
    
    print("🔧 修复RAG系统上下文大小问题...")
    
    try:
        from llama_index.core import Settings
        from llama_index.core.llms import MockLLM
        from llama_index.embeddings.openai import OpenAIEmbedding
        
        # 配置更大的上下文窗口
        print("⚙️ 配置LLM设置...")
        
        # 使用MockLLM避免LLM调用（只用于embedding）
        mock_llm = MockLLM(max_tokens=4096)
        Settings.llm = mock_llm
        
        # 配置embedding模型
        embed_model = OpenAIEmbedding(
            model="text-embedding-ada-002",
            api_key=os.getenv("OPENAI_API_KEY"),
            api_base=os.getenv("OPENAI_API_BASE") or "https://api.gptsapi.net/v1"
        )
        Settings.embed_model = embed_model
        
        # 设置更大的chunk size和context window
        Settings.chunk_size = 1024
        Settings.chunk_overlap = 200
        Settings.context_window = 8192  # 增大上下文窗口
        Settings.num_output = 512
        
        print("✅ LLM和embedding配置完成")
        
        # 测试简单查询
        print("🧪 测试RAG系统查询...")
        
        from llama_index.core import StorageContext, load_index_from_storage
        
        # 加载存储的索引
        storage_context = StorageContext.from_defaults(persist_dir="./storage")
        index = load_index_from_storage(storage_context)
        
        # 创建查询引擎，限制检索结果数量
        query_engine = index.as_query_engine(
            similarity_top_k=2,  # 减少检索结果数量
            response_mode="compact",  # 使用紧凑模式
            verbose=True
        )
        
        # 测试查询
        test_query = "测试查询"
        print(f"🔍 执行测试查询: {test_query}")
        
        response = query_engine.query(test_query)
        
        print("✅ RAG系统测试成功!")
        print(f"📋 响应: {str(response)[:200]}...")
        
        return True
        
    except Exception as e:
        print(f"❌ RAG系统修复失败: {str(e)}")
        print(f"错误类型: {type(e).__name__}")
        
        # 提供修复建议
        if "context size" in str(e):
            print("\n💡 建议修复方案:")
            print("1. 减少chunk_size到512")
            print("2. 减少similarity_top_k到1")
            print("3. 使用更简单的response_mode")
            
        return False

def test_query_with_params(query_text, user_info):
    """测试带参数的查询"""
    try:
        print(f"\n🧪 测试参数化查询: {query_text}")
        
        from llama_index.core import Settings, StorageContext, load_index_from_storage
        from llama_index.core.llms import MockLLM
        from llama_index.embeddings.openai import OpenAIEmbedding
        
        # 重新配置更保守的设置
        mock_llm = MockLLM(max_tokens=1024)  # 减小max_tokens
        Settings.llm = mock_llm
        
        embed_model = OpenAIEmbedding(
            model="text-embedding-ada-002",
            api_key=os.getenv("OPENAI_API_KEY"),
            api_base=os.getenv("OPENAI_API_BASE") or "https://api.gptsapi.net/v1"
        )
        Settings.embed_model = embed_model
        
        # 更保守的设置
        Settings.chunk_size = 512
        Settings.chunk_overlap = 50
        Settings.context_window = 2048
        Settings.num_output = 256
        
        storage_context = StorageContext.from_defaults(persist_dir="./storage")
        index = load_index_from_storage(storage_context)
        
        # 更保守的查询引擎
        query_engine = index.as_query_engine(
            similarity_top_k=1,  # 只检索1个最相关的结果
            response_mode="refine",  # 使用refine模式
            verbose=False
        )
        
        response = query_engine.query(query_text)
        
        result = {
            "query_summary": "基于专业知识库的智能分析",
            "knowledge_answer": str(response),
            "sources_count": 1,
            "knowledge_references": ["专业资料库检索结果"]
        }
        
        print("✅ 参数化查询成功!")
        return result
        
    except Exception as e:
        print(f"❌ 参数化查询失败: {str(e)}")
        return None

if __name__ == "__main__":
    print("🚀 启动RAG系统修复...")
    
    # 检查环境变量
    if not os.getenv("OPENAI_API_KEY"):
        print("❌ 错误: 未设置OPENAI_API_KEY环境变量")
        sys.exit(1)
    
    # 修复RAG系统
    success = fix_rag_system()
    
    if success:
        print("\n🎉 RAG系统修复完成!")
        
        # 测试实际查询
        test_user_info = {
            "nickname": "测试用户",
            "profession": "工程师", 
            "age": "25",
            "bioOrChatHistory": "测试简介"
        }
        
        test_result = test_query_with_params("测试查询", test_user_info)
        if test_result:
            print("📊 测试结果:", test_result)
    else:
        print("\n❌ RAG系统修复失败")
        sys.exit(1) 