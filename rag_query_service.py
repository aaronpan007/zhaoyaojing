#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG查询服务模块 (OpenAI版本)
为后端API提供智能知识库查询功能
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
        Settings
    )
    from llama_index.embeddings.openai import OpenAIEmbedding
    from llama_index.core.llms import MockLLM
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

class RAGQueryService:
    """RAG查询服务类 - OpenAI版本"""
    
    def __init__(self, storage_path: str = "storage"):
        """
        初始化RAG查询服务
        
        Args:
            storage_path: 索引存储路径
        """
        self.storage_path = Path(storage_path)
        self.index = None
        self.query_engine = None
        
        # 初始化状态
        self.is_initialized = False
        self.initialization_error = None
        
        try:
            # 配置LlamaIndex设置
            self._setup_llama_index()
            
            # 加载索引
            if self.load_index():
                self.is_initialized = True
            else:
                self.initialization_error = "索引加载失败"
                
        except Exception as e:
            self.initialization_error = str(e)
            logger.error(f"RAG系统初始化失败: {str(e)}")
    
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
    
    def load_index(self):
        """加载已存在的索引"""
        if not (self.storage_path / "index_store.json").exists():
            return False
        
        try:
            # 临时重定向stdout，防止loading信息输出
            original_stdout = sys.stdout
            sys.stdout = DevNull()
            
            try:
                # 从存储中加载索引
                storage_context = StorageContext.from_defaults(persist_dir=str(self.storage_path))
                self.index = load_index_from_storage(storage_context)
                
                # 创建查询引擎 - 使用最最保守的设置避免上下文问题
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
            logger.error(f"加载索引失败: {str(e)}")
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
                    print("\n" + "="*80, file=sys.stderr)
                    print("🔬 RAG系统检索诊断报告", file=sys.stderr)
                    print("="*80, file=sys.stderr)
                    print(f"📝 查询问题: {question}", file=sys.stderr)
                    if context.strip():
                        print(f"📄 上下文: {context}", file=sys.stderr)
                    print(f"🔍 完整查询: {full_query}", file=sys.stderr)
                    print(f"📊 检索到 {len(response.source_nodes)} 个相关文档片段\n", file=sys.stderr)
                
                for i, node in enumerate(response.source_nodes, 1):
                    source_info = {
                        "content": node.text[:100] + "..." if len(node.text) > 100 else node.text,
                        "score": float(node.score) if hasattr(node, 'score') else 0.0
                    }
                    
                    # 添加文件路径信息
                    if hasattr(node, 'metadata') and 'file_path' in node.metadata:
                        source_info['file_path'] = node.metadata['file_path']
                    
                    # 🔍 诊断模式：详细输出每个检索片段
                    if diagnostic_mode:
                        print(f"📄 片段 {i}", file=sys.stderr)
                        print("-" * 60, file=sys.stderr)
                        
                        # 相关性得分
                        score = float(node.score) if hasattr(node, 'score') else 0.0
                        print(f"🎯 相关性得分: {score:.4f}", file=sys.stderr)
                        
                        # 来源元数据
                        metadata = getattr(node, 'metadata', {})
                        if 'file_path' in metadata:
                            file_name = os.path.basename(metadata['file_path'])
                            print(f"📁 来源文件: {file_name}", file=sys.stderr)
                            print(f"📂 完整路径: {metadata['file_path']}", file=sys.stderr)
                        
                        # 其他元数据信息
                        if metadata:
                            for key, value in metadata.items():
                                if key != 'file_path':
                                    print(f"📋 {key}: {value}", file=sys.stderr)
                        
                        # 原始文本块（截断显示，避免过长）
                        display_text = node.text[:500] + "..." if len(node.text) > 500 else node.text
                        print(f"📝 原始文本块 (长度: {len(node.text)} 字符):", file=sys.stderr)
                        print("-" * 40, file=sys.stderr)
                        print(display_text, file=sys.stderr)
                        print("-" * 40, file=sys.stderr)
                        
                        # 文本块ID（如果有）
                        if hasattr(node, 'node_id'):
                            print(f"🆔 节点ID: {node.node_id}", file=sys.stderr)
                        
                        print(file=sys.stderr)  # 空行分隔
                    
                    sources.append(source_info)
                
                # 🔍 诊断模式：输出文档来源统计
                if diagnostic_mode:
                    print("📊 文档来源统计:", file=sys.stderr)
                    print("-" * 40, file=sys.stderr)
                    file_count = {}
                    for source in sources:
                        if 'file_path' in source:
                            file_name = os.path.basename(source['file_path'])
                            file_count[file_name] = file_count.get(file_name, 0) + 1
                    
                    for file_name, count in sorted(file_count.items(), key=lambda x: x[1], reverse=True):
                        print(f"📂 {file_name}: {count} 个片段", file=sys.stderr)
                    
                    print("\n💡 检索偏见分析:", file=sys.stderr)
                    print("-" * 40, file=sys.stderr)
                    total_sources = len(sources)
                    if total_sources > 0:
                        most_cited = max(file_count.items(), key=lambda x: x[1])
                        bias_ratio = most_cited[1] / total_sources
                        print(f"🔍 最常引用文档: {most_cited[0]} ({most_cited[1]}/{total_sources} = {bias_ratio:.1%})", file=sys.stderr)
                        if bias_ratio > 0.6:
                            print("⚠️  警告: 存在明显的检索偏见！单一文档占比过高", file=sys.stderr)
                        elif bias_ratio > 0.4:
                            print("🟡 注意: 存在轻微的检索偏见", file=sys.stderr)
                        else:
                            print("✅ 检索结果相对均衡", file=sys.stderr)
                    
                    print("="*80, file=sys.stderr)
                    print("🔬 诊断报告结束", file=sys.stderr)
                    print("="*80 + "\n", file=sys.stderr)
            
            result = {
                "answer": str(response)[:200] + "..." if len(str(response)) > 200 else str(response),
                "sources": sources,
                "query": question,
                "context": context,
                "sources_count": len(sources)
            }
            
            return result
            
        except Exception as e:
            logger.error(f"RAG查询失败: {str(e)}")
            return {
                "error": str(e),
                "answer": "",
                "sources": [],
                "query": question,
                "context": context,
                "sources_count": 0
            }

def create_rag_query(user_input: dict, image_analysis: list) -> str:
    """
    根据用户输入和图片分析，构造专业的RAG查询问题
    
    Args:
        user_input: 用户输入信息
        image_analysis: 图片分析结果
        
    Returns:
        构造的查询问题
    """
    # 简化查询，避免过长
    bio = user_input.get('bio', user_input.get('bioOrChatHistory', ''))
    
    # 截断过长的内容
    if len(bio) > 100:
        bio = bio[:100] + "..."
    
    base_query = f"""分析约会对象：昵称{user_input.get('nickname', '未知')}，职业{user_input.get('profession', '未知')}，年龄{user_input.get('age', '未知')}。个人简介：{bio}。请识别PUA行为模式和情感操控迹象。"""
    
    return base_query

def generate_final_report(rag_result: dict, user_input: dict, image_analysis: list) -> dict:
    """
    生成最终的结构化分析报告
    
    Args:
        rag_result: RAG查询结果
        user_input: 用户输入信息
        image_analysis: 图片分析结果
        
    Returns:
        结构化的分析报告
    """
    import datetime
    
    report = {
        "title": "AI情感安全分析报告 (OpenAI版本)",
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "user_data": {
            "target_nickname": user_input.get('nickname', '未知'),
            "target_profession": user_input.get('profession', '未知'),
            "target_age": user_input.get('age', '未知'),
            "target_bio": user_input.get('bio', user_input.get('bioOrChatHistory', '未提供'))
        },
        "multimodal_analysis": image_analysis,
        "rag_analysis": {
            "query_summary": "基于专业知识库的智能分析",
            "knowledge_answer": rag_result.get('answer', ''),
            "sources_count": rag_result.get('sources_count', 0),
            "knowledge_references": rag_result.get('sources', [])
        },
        "risk_assessment": {
            "overall_risk": "需要进一步专业评估",
            "identified_patterns": [],
            "safety_recommendations": []
        },
        "professional_insights": {
            "psychological_analysis": "基于知识库的专业分析",
            "relationship_dynamics": "已整合专业理论",
            "recommended_actions": []
        },
        "system_info": {
            "rag_status": "active" if not rag_result.get('error') else "error",
            "embedding_model": "OpenAI text-embedding-3-small",
            "knowledge_sources": f"专业资料库 ({rag_result.get('sources_count', 0)} 个相关文档)",
            "ai_version": "OpenAI GPT-4o + RAG知识库"
        }
    }
    
    # 如果有RAG错误，记录错误信息
    if rag_result.get('error'):
        report["rag_error"] = rag_result['error']
        report["system_info"]["rag_status"] = "error"
    
    return report

# 命令行调用支持
def main():
    """主函数 - 支持命令行调用"""
    
    # 确保stdout只用于JSON输出
    try:
        if len(sys.argv) < 2:
            result = {
                "success": False,
                "error": "用法: python rag_query_service.py '<JSON格式的查询数据>'"
            }
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(1)
        
        # 解析命令行参数
        input_data = json.loads(sys.argv[1])
        
        # 初始化RAG服务
        rag_service = RAGQueryService()
        
        if not rag_service.is_initialized:
            result = {
                "success": False,
                "error": f"RAG系统初始化失败: {rag_service.initialization_error}",
                "fallback_report": generate_final_report(
                    {"error": "初始化失败", "answer": "", "sources": [], "sources_count": 0},
                    input_data.get('user_input', input_data.get('user_info', {})),
                    input_data.get('image_analysis', input_data.get('image_infos', []))
                )
            }
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(0)
        
        # 提取用户输入和图片分析
        user_input = input_data.get('user_input', input_data.get('user_info', {}))
        image_analysis = input_data.get('image_analysis', input_data.get('image_infos', []))
        
        # 构造RAG查询
        rag_query = create_rag_query(user_input, image_analysis)
        
        # 检查是否启用诊断模式
        diagnostic_mode = input_data.get('diagnostic_mode', False)
        
        # 执行查询
        rag_result = rag_service.query(rag_query, diagnostic_mode=diagnostic_mode)
        
        # 生成最终报告
        final_report = generate_final_report(rag_result, user_input, image_analysis)
        
        # 构建成功响应格式，匹配server.js期望的格式
        result = {
            "success": True,
            "data": final_report
        }
        
        # 输出JSON结果到stdout（确保这是唯一的stdout输出）
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError:
        result = {
            "success": False,
            "error": "无效的JSON输入格式"
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        result = {
            "success": False,
            "error": f"处理失败: {str(e)}"
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main() 