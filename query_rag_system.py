#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI情感安全助手 - RAG查询系统 (Replicate版本)
智能查询本地知识库并返回专业分析结果
"""

import os
import sys
from pathlib import Path
import logging
from dotenv import load_dotenv
import json
import replicate
from typing import List

# LlamaIndex核心模块
from llama_index.core import (
    StorageContext,
    load_index_from_storage,
    Settings
)
from llama_index.core.embeddings import BaseEmbedding

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ReplicateEmbedding(BaseEmbedding):
    """
    基于Replicate API的自定义embedding类
    使用高质量的BGE embedding模型
    （与build_rag_system.py保持一致）
    """
    
    def __init__(self, model_name: str = "nateraw/bge-large-en-v1.5", **kwargs):
        """
        初始化Replicate Embedding
        
        Args:
            model_name: Replicate上的embedding模型名称
        """
        super().__init__(**kwargs)
        self.model_name = model_name
        
        # 初始化Replicate客户端
        load_dotenv()
        self.api_token = os.getenv("REPLICATE_API_TOKEN")
        if not self.api_token:
            raise ValueError("未找到REPLICATE_API_TOKEN环境变量！请在.env文件中配置您的Replicate API密钥")
        
        # 配置replicate
        os.environ["REPLICATE_API_TOKEN"] = self.api_token
        
        logger.debug(f"Replicate Embedding初始化完成，使用模型: {self.model_name}")
    
    def _get_text_embedding(self, text: str) -> List[float]:
        """获取单个文本的embedding"""
        try:
            # 调用Replicate embedding API
            output = replicate.run(
                self.model_name,
                input={"text": text}
            )
            
            # 处理输出格式
            if isinstance(output, list) and len(output) > 0:
                if isinstance(output[0], list):
                    # 如果是嵌套列表，取第一个
                    embedding = output[0]
                else:
                    # 如果是单层列表
                    embedding = output
            else:
                raise ValueError(f"意外的embedding输出格式: {type(output)}")
            
            # 确保返回的是float列表
            return [float(x) for x in embedding]
            
        except Exception as e:
            logger.error(f"Replicate embedding调用失败: {str(e)}")
            raise e
    
    def _get_query_embedding(self, query: str) -> List[float]:
        """获取查询文本的embedding（与文档embedding相同）"""
        return self._get_text_embedding(query)
    
    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        """批量获取文本embedding"""
        embeddings = []
        for text in texts:
            embedding = self._get_text_embedding(text)
            embeddings.append(embedding)
        return embeddings
    
    async def _aget_query_embedding(self, query: str) -> List[float]:
        """异步获取查询embedding"""
        return self._get_query_embedding(query)
    
    async def _aget_text_embedding(self, text: str) -> List[float]:
        """异步获取文本embedding"""
        return self._get_text_embedding(text)

class RAGQueryService:
    """RAG查询服务类 - Replicate版本"""
    
    def __init__(self, storage_path: str = "storage"):
        """
        初始化RAG查询服务
        
        Args:
            storage_path: 索引存储路径
        """
        self.storage_path = Path(storage_path)
        self.index = None
        self.query_engine = None
        
        # 配置LlamaIndex设置
        self._setup_llama_index()
        
        # 加载索引
        self.load_index()
    
    def _setup_llama_index(self):
        """配置LlamaIndex全局设置 - 使用Replicate"""
        load_dotenv()
        
        # 检查Replicate API密钥
        api_token = os.getenv("REPLICATE_API_TOKEN")
        if not api_token:
            logger.error("未找到REPLICATE_API_TOKEN环境变量！请在.env文件中配置您的Replicate API密钥")
            sys.exit(1)
        
        # 配置自定义Replicate Embedding模型
        Settings.embed_model = ReplicateEmbedding(
            model_name="nateraw/bge-large-en-v1.5",  # 使用高质量的BGE模型
            embed_batch_size=1  # Replicate API通常每次处理一个文本
        )
        
        # 不设置LLM，因为我们在后端单独处理
        Settings.llm = None
        
        logger.debug("LlamaIndex配置完成 (Replicate BGE Embedding)")
    
    def load_index(self):
        """加载已存在的索引"""
        if not (self.storage_path / "index_store.json").exists():
            logger.error(f"未找到索引文件: {self.storage_path}/index_store.json")
            logger.error("请先运行 python build_rag_system.py 来构建索引")
            return False
        
        logger.info("🔄 加载RAG索引...")
        
        try:
            # 从存储中加载索引
            storage_context = StorageContext.from_defaults(persist_dir=str(self.storage_path))
            self.index = load_index_from_storage(storage_context)
            
            # 创建查询引擎
            self.query_engine = self.index.as_query_engine(
                similarity_top_k=5,  # 返回最相似的5个文档片段
                response_mode="compact"  # 紧凑模式回答
            )
            
            logger.info("✅ RAG系统加载完成")
            return True
            
        except Exception as e:
            logger.error(f"❌ 加载索引失败: {str(e)}")
            return False
    
    def query(self, question: str, context: str = "", diagnostic_mode: bool = False) -> dict:
        """
        执行智能查询
        
        Args:
            question: 查询问题
            context: 额外上下文信息
            diagnostic_mode: 是否启用诊断模式，详细打印检索信息
            
        Returns:
            包含查询结果的字典
        """
        if not self.query_engine:
            return {
                "error": "RAG系统未就绪",
                "answer": "",
                "sources": []
            }
        
        # 构建完整查询
        full_query = question
        if context.strip():
            full_query = f"上下文信息: {context.strip()}\n\n问题: {question}"
        
        logger.info(f"🔍 执行查询: {question}")
        
        try:
            # 执行查询
            response = self.query_engine.query(full_query)
            
            # 提取源文档信息
            sources = []
            if hasattr(response, 'source_nodes') and response.source_nodes:
                # 🔍 诊断模式：详细打印检索信息
                if diagnostic_mode:
                    print("\n" + "="*80)
                    print("🔬 RAG系统检索诊断报告")
                    print("="*80)
                    print(f"📝 查询问题: {question}")
                    if context.strip():
                        print(f"📄 上下文: {context}")
                    print(f"🔍 完整查询: {full_query}")
                    print(f"📊 检索到 {len(response.source_nodes)} 个相关文档片段\n")
                
                for i, node in enumerate(response.source_nodes, 1):
                    source_info = {
                        "content": node.text[:200] + "..." if len(node.text) > 200 else node.text,
                        "score": getattr(node, 'score', 0.0)
                    }
                    
                    # 添加文件路径信息（如果有）
                    if hasattr(node, 'metadata') and 'file_path' in node.metadata:
                        source_info['file_path'] = node.metadata['file_path']
                    
                    # 🔍 诊断模式：详细打印每个检索片段
                    if diagnostic_mode:
                        print(f"📄 片段 {i}")
                        print("-" * 60)
                        
                        # 相关性得分
                        score = getattr(node, 'score', 0.0)
                        print(f"🎯 相关性得分: {score:.4f}")
                        
                        # 来源元数据
                        metadata = getattr(node, 'metadata', {})
                        if 'file_path' in metadata:
                            file_name = os.path.basename(metadata['file_path'])
                            print(f"📁 来源文件: {file_name}")
                            print(f"📂 完整路径: {metadata['file_path']}")
                        
                        # 其他元数据信息
                        if metadata:
                            for key, value in metadata.items():
                                if key != 'file_path':
                                    print(f"📋 {key}: {value}")
                        
                        # 原始文本块
                        print(f"📝 原始文本块 (长度: {len(node.text)} 字符):")
                        print("-" * 40)
                        print(node.text)
                        print("-" * 40)
                        
                        # 文本块ID（如果有）
                        if hasattr(node, 'node_id'):
                            print(f"🆔 节点ID: {node.node_id}")
                        
                        print()  # 空行分隔
                    
                    sources.append(source_info)
                
                # 🔍 诊断模式：打印文档来源统计
                if diagnostic_mode:
                    print("📊 文档来源统计:")
                    print("-" * 40)
                    file_count = {}
                    for source in sources:
                        if 'file_path' in source:
                            file_name = os.path.basename(source['file_path'])
                            file_count[file_name] = file_count.get(file_name, 0) + 1
                    
                    for file_name, count in sorted(file_count.items(), key=lambda x: x[1], reverse=True):
                        print(f"📂 {file_name}: {count} 个片段")
                    
                    print("\n💡 检索偏见分析:")
                    print("-" * 40)
                    total_sources = len(sources)
                    if total_sources > 0:
                        most_cited = max(file_count.items(), key=lambda x: x[1])
                        bias_ratio = most_cited[1] / total_sources
                        print(f"🔍 最常引用文档: {most_cited[0]} ({most_cited[1]}/{total_sources} = {bias_ratio:.1%})")
                        if bias_ratio > 0.6:
                            print("⚠️  警告: 存在明显的检索偏见！单一文档占比过高")
                        elif bias_ratio > 0.4:
                            print("🟡 注意: 存在轻微的检索偏见")
                        else:
                            print("✅ 检索结果相对均衡")
                    
                    print("="*80)
                    print("🔬 诊断报告结束")
                    print("="*80 + "\n")
            
            result = {
                "answer": str(response),
                "sources": sources,
                "query": question,
                "context": context
            }
            
            logger.info("✅ 查询完成")
            return result
            
        except Exception as e:
            logger.error(f"❌ 查询失败: {str(e)}")
            return {
                "error": str(e),
                "answer": "",
                "sources": [],
                "query": question,
                "context": context
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
    # 基础查询
    base_query = f"""
请分析以下约会对象的情况并提供专业建议：

个人信息：
- 昵称：{user_input.get('nickname', '未知')}
- 职业：{user_input.get('profession', '未知')}
- 年龄：{user_input.get('age', '未知')}
- 个人简介：{user_input.get('bio', '未提供')}
"""
    
    # 添加图片分析信息
    if image_analysis:
        base_query += "\n图片分析结果：\n"
        for i, analysis in enumerate(image_analysis, 1):
            base_query += f"{i}. {analysis}\n"
    
    # 添加具体查询问题
    base_query += """
基于上述信息，请从以下角度进行专业分析：
1. 红旗信号识别：是否存在PUA行为模式、情感操控迹象？
2. 安全风险评估：约会过程中需要注意的安全事项
3. 行为模式分析：对方的沟通风格和行为特征反映了什么？
4. 建议与预防：如何保护自己，建立健康的情感边界？

请提供具体、实用的建议，并引用相关的心理学和两性关系理论。
"""
    
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
    report = {
        "title": "AI情感安全分析报告 (Replicate RAG版本)",
        "timestamp": "",
        "user_data": {
            "target_nickname": user_input.get('nickname', '未知'),
            "target_profession": user_input.get('profession', '未知'),
            "target_age": user_input.get('age', '未知'),
            "target_bio": user_input.get('bio', '未提供')
        },
        "image_analysis": image_analysis,
        "rag_analysis": {
            "query": rag_result.get('query', ''),
            "answer": rag_result.get('answer', ''),
            "sources_count": len(rag_result.get('sources', [])),
            "knowledge_references": rag_result.get('sources', [])
        },
        "risk_assessment": {
            "overall_risk": "需要专业评估",
            "red_flags": [],
            "safety_tips": []
        },
        "recommendations": [],
        "api_status": {
            "rag_system": "active" if not rag_result.get('error') else "error",
            "embedding_model": "Replicate BGE-large-en-v1.5",
            "knowledge_base": "本地专业资料库"
        }
    }
    
    # 如果有错误，记录错误信息
    if rag_result.get('error'):
        report["error"] = rag_result['error']
    
    return report

def main():
    """主函数 - 支持交互式和命令行查询"""
    import argparse
    
    parser = argparse.ArgumentParser(description="RAG智能查询系统 (Replicate版本)")
    parser.add_argument("query", nargs="?", help="查询问题")
    parser.add_argument("--context", default="", help="额外上下文信息")
    parser.add_argument("--storage", default="storage", help="索引存储路径")
    parser.add_argument("--json", action="store_true", help="输出JSON格式结果")
    parser.add_argument("--diagnostic", action="store_true", help="启用诊断模式，详细显示检索过程")
    
    args = parser.parse_args()
    
    # 初始化RAG服务
    rag_service = RAGQueryService(storage_path=args.storage)
    
    if not rag_service.query_engine:
        logger.error("❌ RAG系统初始化失败")
        sys.exit(1)
    
    if args.query:
        # 命令行模式
        result = rag_service.query(args.query, args.context, diagnostic_mode=args.diagnostic)
        
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            if result.get('error'):
                logger.error(f"查询错误: {result['error']}")
            else:
                print(f"\n问题: {result['query']}")
                print(f"回答: {result['answer']}")
                if result['sources']:
                    print(f"\n参考来源: {len(result['sources'])} 个文档片段")
    else:
        # 交互式模式
        print("🤖 AI情感安全助手 - RAG查询系统 (Replicate版本)")
        if args.diagnostic:
            print("🔬 诊断模式已启用")
        print("💡 输入您的问题，输入 'quit' 退出")
        print("📝 输入 '/diagnostic' 切换诊断模式")
        print("=" * 50)
        
        diagnostic_mode = args.diagnostic  # 从命令行参数初始化
        
        while True:
            try:
                question = input(f"\n🔍 请输入您的问题{' (诊断模式)' if diagnostic_mode else ''}: ").strip()
                
                if question.lower() in ['quit', 'exit', 'q']:
                    print("👋 再见！")
                    break
                
                if question.lower() == '/diagnostic':
                    diagnostic_mode = not diagnostic_mode
                    status = "启用" if diagnostic_mode else "关闭"
                    print(f"🔬 诊断模式已{status}")
                    continue
                
                if not question:
                    continue
                
                result = rag_service.query(question, diagnostic_mode=diagnostic_mode)
                
                if result.get('error'):
                    print(f"❌ 查询错误: {result['error']}")
                else:
                    print(f"\n📋 回答:")
                    print(result['answer'])
                    
                    if result['sources'] and not diagnostic_mode:
                        print(f"\n📚 参考来源: {len(result['sources'])} 个文档片段")
                        for i, source in enumerate(result['sources'][:3], 1):
                            print(f"   {i}. {source['content'][:100]}...")
            
            except KeyboardInterrupt:
                print("\n👋 再见！")
                break
            except Exception as e:
                print(f"❌ 发生错误: {str(e)}")

if __name__ == "__main__":
    main() 