#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版RAG查询服务 - 多样性强制检索机制
解决RAG系统检索偏见问题，确保来源多样性
"""

import os
import sys
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime
from collections import Counter, defaultdict
import re
from contextlib import redirect_stdout

# 全局重定向stdout到stderr，防止污染JSON输出
class StdoutRedirector:
    def __init__(self):
        self.original_stdout = sys.stdout
        
    def __enter__(self):
        sys.stdout = sys.stderr
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self.original_stdout

# 加载环境变量
load_dotenv()

# 设置日志格式
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

# 在导入llama_index之前设置日志级别
with StdoutRedirector():
    # 设置llama_index日志级别为WARNING，减少debug输出
    import logging as llama_logging
    llama_logging.getLogger("llama_index").setLevel(llama_logging.WARNING)

class EnhancedRAGService:
    """增强版RAG服务 - 多样性强制检索"""
    
    def __init__(self, storage_path: str = "storage"):
        self.storage_path = Path(storage_path)
        self.index = None
        self.query_engine = None
        self.knowledge_sources = {
            'jordan_peterson': ['12-Rules-for-Life.pdf', 'jordan peterson2.pdf', 'Jordan_Peterson_Toxic_Masculinity_FINAL'],
            'sadia_khan': ['Sadia Khan', 'sadia khan'],
            'red_pill': ['红药丸', '紅藥丸', 'Week'],
            'mystery_method': ['谜男方法.pdf'],
            'abovelight': ['AB的異想世界']
        }
        self.initialize_rag_system()
    
    def initialize_rag_system(self):
        """初始化RAG系统"""
        try:
            logger.info("🚀 初始化增强版RAG系统...")
            
            # 验证API配置
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("未找到OPENAI_API_KEY环境变量！")
            
            # 重定向标准输出到stderr，防止污染JSON输出
            import sys
            from contextlib import redirect_stdout
            
            # 导入必要模块时重定向输出
            with redirect_stdout(sys.stderr):
                from llama_index.core import (
                    StorageContext,
                    load_index_from_storage,
                    Settings
                )
                from llama_index.embeddings.openai import OpenAIEmbedding
                
                # 配置embedding模型
                Settings.embed_model = OpenAIEmbedding(
                    model="text-embedding-3-small",
                    api_key=api_key,
                    api_base="https://api.gptsapi.net/v1"
                )
                
                # 加载索引
                storage_context = StorageContext.from_defaults(persist_dir=str(self.storage_path))
                self.index = load_index_from_storage(storage_context)
            
            logger.info("✅ 增强版RAG系统初始化成功")
            return True
            
        except Exception as e:
            logger.error(f"❌ RAG系统初始化失败: {str(e)}")
            return False
    
    def classify_query_intent(self, query: str) -> dict:
        """分析查询意图，识别用户想要的知识源"""
        intent_mapping = {
            'jordan_peterson': ['jordan peterson', 'jp', '个人责任', '心理学', '12条规则', '责任', '自信建设'],
            'sadia_khan': ['sadia khan', '现代关系', '女性心理', '关系咨询'],
            'red_pill': ['红药丸', '两性动态', '择偶策略', 'red pill', '蓝药丸'],
            'mystery_method': ['谜男方法', '社交技巧', 'pua', '搭讪'],
            'general': ['约会', '感情', '关系', '心理', '分析']
        }
        
        query_lower = query.lower()
        intent_scores = defaultdict(float)
        
        for source, keywords in intent_mapping.items():
            for keyword in keywords:
                if keyword.lower() in query_lower:
                    intent_scores[source] += 1.0
                    # 如果是明确指名的专家，给更高权重
                    if keyword.lower() in ['jordan peterson', 'sadia khan', '谜男方法', '红药丸']:
                        intent_scores[source] += 2.0
        
        return dict(intent_scores)
    
    def diversified_retrieval(self, query: str, top_k: int = 5) -> list:
        """多样性强制均衡检索 - 强硬方案解决检索偏见"""
        try:
            logger.info(f"🔍 开始多样性强制均衡检索: {query[:100]}...")
            
            # === 第一步：扩大初始检索范围 ===
            logger.info("📈 第一步：扩大检索范围到20个候选片段...")
            
            # 重定向输出避免污染JSON
            import sys
            from contextlib import redirect_stdout
            
            with redirect_stdout(sys.stderr):
                retriever = self.index.as_retriever(similarity_top_k=20)  # 获取前20个候选
                all_candidates = retriever.retrieve(query)
            
            logger.info(f"✅ 检索到 {len(all_candidates)} 个候选片段")
            
            # === 第二步：多样性筛选后处理 ===
            logger.info("🎯 第二步：执行多样性强制筛选...")
            
            # 创建空的"最终知识列表"
            final_knowledge_list = []
            author_count = {}  # 统计每个作者的片段数量
            
            # 对候选片段按相关性排序（已经是按相关性排序的）
            logger.info("📋 候选片段列表:")
            author_groups = {}  # 按作者分组
            
            for i, node in enumerate(all_candidates):
                file_path = getattr(node, 'metadata', {}).get('file_path', 'unknown')
                author = self.identify_source(file_path)
                
                if author not in author_groups:
                    author_groups[author] = []
                author_groups[author].append((i, node))
                
                logger.info(f"  {i+1}. [{author}] 评分: {node.score:.4f}, 来源: {file_path}")
            
            logger.info(f"🔍 发现 {len(author_groups)} 个不同作者的内容")
            for author, nodes in author_groups.items():
                logger.info(f"   {author}: {len(nodes)} 个候选片段")
            
            # === 强化多样性策略 ===
            # 如果有多个作者，优先确保多样性
            if len(author_groups) > 1:
                logger.info("🌈 执行强化多样性策略（多作者模式）...")
                
                # 第一轮：每个作者选择最好的1个片段
                for author, nodes in author_groups.items():
                    if len(final_knowledge_list) < top_k:
                        best_node = nodes[0][1]  # 选择该作者最相关的片段
                        final_knowledge_list.append(best_node)
                        author_count[author] = 1
                        logger.info(f"   ✅ 选择 {author} 的最佳片段 (评分: {best_node.score:.4f})")
                
                # 第二轮：如果还有空位，每个作者再选择1个片段
                for author, nodes in author_groups.items():
                    if len(final_knowledge_list) < top_k and len(nodes) > 1:
                        if author_count.get(author, 0) < 2:  # 确保每个作者最多2个
                            second_best_node = nodes[1][1]  # 选择该作者第二相关的片段
                            final_knowledge_list.append(second_best_node)
                            author_count[author] = author_count.get(author, 0) + 1
                            logger.info(f"   ✅ 选择 {author} 的第二个片段 (评分: {second_best_node.score:.4f})")
                
                # 第三轮：如果仍有空位，按相关性继续填充（仍遵守每作者最多2个限制）
                if len(final_knowledge_list) < top_k:
                    remaining_candidates = []
                    for author, nodes in author_groups.items():
                        for i, node in nodes[2:]:  # 从第3个片段开始
                            remaining_candidates.append((i, node, author))
                    
                    # 按原始相关性排序
                    remaining_candidates.sort(key=lambda x: x[0])
                    
                    for original_index, node, author in remaining_candidates:
                        if len(final_knowledge_list) >= top_k:
                            break
                        if author_count.get(author, 0) < 2:
                            final_knowledge_list.append(node)
                            author_count[author] = author_count.get(author, 0) + 1
                            logger.info(f"   ✅ 补充选择 {author} 的片段 (评分: {node.score:.4f})")
                
            else:
                # 单一作者模式：直接按相关性选择，但仍限制最多2个
                logger.info("📖 执行单一作者模式...")
                author = list(author_groups.keys())[0]
                nodes = author_groups[author]
                
                for i, (original_index, node) in enumerate(nodes):
                    if i >= 2 or len(final_knowledge_list) >= top_k:  # 最多2个片段
                        break
                    final_knowledge_list.append(node)
                    author_count[author] = author_count.get(author, 0) + 1
                    logger.info(f"   ✅ 选择 {author} 的片段 {i+1} (评分: {node.score:.4f})")
            
            # === 多样性验证和统计 ===
            logger.info("📊 多样性强制均衡结果:")
            logger.info(f"   最终片段数量: {len(final_knowledge_list)}")
            
            final_author_count = {}
            for node in final_knowledge_list:
                file_path = getattr(node, 'metadata', {}).get('file_path', 'unknown')
                author = self.identify_source(file_path)
                final_author_count[author] = final_author_count.get(author, 0) + 1
            
            for author, count in final_author_count.items():
                percentage = (count / len(final_knowledge_list) * 100) if final_knowledge_list else 0
                logger.info(f"   {author}: {count} 个片段 ({percentage:.1f}%)")
            
            # 验证约束条件
            max_author_count = max(final_author_count.values()) if final_author_count else 0
            unique_authors = len(final_author_count)
            
            if max_author_count <= 2:
                logger.info("✅ 约束验证成功: 每个作者最多2个片段")
            else:
                logger.warning(f"⚠️ 约束验证失败: 发现作者超出限制 ({max_author_count}个片段)")
            
            if unique_authors >= 2:
                logger.info(f"✅ 多样性目标达成: {unique_authors} 个不同作者")
            else:
                logger.info(f"⚠️ 多样性有限: 只有 {unique_authors} 个作者（可能是查询过于专一）")
            
            return final_knowledge_list
            
        except Exception as e:
            logger.error(f"❌ 多样性强制均衡检索失败: {str(e)}")
            # 降级到基础检索
            with redirect_stdout(sys.stderr):
                retriever = self.index.as_retriever(similarity_top_k=top_k)
                return retriever.retrieve(query)
    
    def identify_source(self, file_path: str) -> str:
        """识别文档来源"""
        if not file_path:
            return 'unknown'
        
        file_name = Path(file_path).name.lower()
        
        # 检查每个知识源的标识符
        for source, identifiers in self.knowledge_sources.items():
            for identifier in identifiers:
                if identifier.lower() in file_name:
                    return source
        
        return 'other'
    
    def process_query(self, query_data: str) -> dict:
        """处理查询请求"""
        try:
            logger.info("🎯 开始处理增强版RAG查询...")
            
            # 解析输入数据
            data = json.loads(query_data)
            user_info = data.get('user_info', {})
            
            # 提取查询内容
            query = user_info.get('bioOrChatHistory', '') or user_info.get('bio', '')
            if not query:
                raise ValueError("未找到有效的查询内容")
            
            logger.info(f"📝 查询内容: {query[:100]}...")
            
            # 执行多样性强制检索
            nodes = self.diversified_retrieval(query, top_k=5)
            
            # 构建知识回答
            knowledge_answer = self.build_knowledge_answer(nodes, query)
            
            # 构建引用信息
            knowledge_references = []
            for i, node in enumerate(nodes):
                ref = {
                    'score': float(node.score) if hasattr(node, 'score') else 0.0,
                    'file_path': node.metadata.get('file_path', 'unknown'),
                    'text_snippet': node.text[:200] + '...' if len(node.text) > 200 else node.text
                }
                knowledge_references.append(ref)
            
            # 构建响应
            result = {
                'success': True,
                'data': {
                    'title': 'AI情感安全分析报告 (增强多样性版本)',
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'user_info': user_info,
                    'rag_analysis': {
                        'status': 'active',
                        'knowledge_answer': knowledge_answer,
                        'knowledge_references': knowledge_references,
                        'sources_count': len(nodes),
                        'diversity_enhanced': True
                    }
                }
            }
            
            logger.info("✅ 增强版RAG查询处理完成")
            return result
            
        except Exception as e:
            logger.error(f"❌ 查询处理失败: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'data': {}
            }
    
    def build_knowledge_answer(self, nodes: list, query: str) -> str:
        """构建知识回答"""
        if not nodes:
            return "未找到相关知识内容。"
        
        # 按来源组织内容
        content_by_source = defaultdict(list)
        for node in nodes:
            source = self.identify_source(node.metadata.get('file_path', ''))
            content_by_source[source].append(node.text[:300])
        
        # 构建结构化回答
        answer_parts = []
        source_names = {
            'jordan_peterson': 'Jordan Peterson心理学观点',
            'sadia_khan': 'Sadia Khan关系分析',
            'red_pill': '红药丸理论观点', 
            'mystery_method': '谜男方法技巧',
            'abovelight': 'AboveLight观点',
            'other': '其他专业观点'
        }
        
        for source, contents in content_by_source.items():
            if contents:
                source_name = source_names.get(source, source)
                combined_content = ' '.join(contents[:2])  # 每个来源最多2段内容
                answer_parts.append(f"【{source_name}】\n{combined_content}")
        
        return '\n\n'.join(answer_parts)

def main():
    """主函数"""
    if len(sys.argv) != 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python rag_query_service_enhanced.py <json_data>'
        }))
        sys.exit(1)
    
    try:
        # 创建增强版RAG服务
        rag_service = EnhancedRAGService()
        
        # 处理查询
        query_data = sys.argv[1]
        result = rag_service.process_query(query_data)
        
        # 输出结果
        print(json.dumps(result, ensure_ascii=False, indent=2))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'data': {}
        }
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main() 