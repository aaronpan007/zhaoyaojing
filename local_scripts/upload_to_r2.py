#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上传本地storage索引文件到Cloudflare R2
自动将RAG系统所需的索引文件迁移到云存储
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import s3fs
from tqdm import tqdm

# 加载环境变量
load_dotenv()

def upload_storage_to_r2():
    """将本地storage目录上传到R2"""
    print("📤 开始上传本地storage文件到Cloudflare R2...")
    
    # 检查本地storage目录
    storage_path = Path("storage")
    if not storage_path.exists():
        print("❌ 本地storage目录不存在")
        return False
    
    # 获取R2配置
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("BUCKET_NAME")
    
    if not all([account_id, access_key, secret_key, bucket_name]):
        print("❌ R2配置不完整")
        return False
    
    # 创建S3FS连接
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    s3fs_client = s3fs.S3FileSystem(
        key=access_key,
        secret=secret_key,
        endpoint_url=endpoint_url,
        use_ssl=True
    )
    
    # 需要上传的文件列表
    required_files = [
        "index_store.json",
        "default__vector_store.json", 
        "docstore.json"
    ]
    
    optional_files = [
        "graph_store.json",
        "image__vector_store.json"
    ]
    
    all_files = required_files + optional_files
    uploaded_count = 0
    
    print(f"📁 从 {storage_path} 上传到 {bucket_name}")
    print("=" * 50)
    
    for filename in all_files:
        local_file = storage_path / filename
        
        if not local_file.exists():
            if filename in required_files:
                print(f"❌ 必需文件不存在: {filename}")
            else:
                print(f"⚪ 可选文件不存在: {filename}")
            continue
        
        # 检查文件是否已经存在且大小正确
        remote_path = f"{bucket_name}/{filename}"
        file_size = local_file.stat().st_size
        file_size_mb = round(file_size / (1024 * 1024), 2)
        
        if s3fs_client.exists(remote_path):
            try:
                remote_size = s3fs_client.info(remote_path).get('size', 0)
                if remote_size == file_size:
                    print(f"✅ 跳过已存在 - {filename} ({file_size_mb} MB)")
                    uploaded_count += 1
                    continue
                else:
                    print(f"🔄 重新上传 - {filename} (大小不匹配)")
            except:
                print(f"🔄 重新上传 - {filename} (验证失败)")
        
        print(f"📤 上传 {filename} ({file_size_mb} MB)...")
        
        try:
            # 直接上传，不使用进度条回调（避免兼容性问题）
            if file_size > 10 * 1024 * 1024:  # 大于10MB显示进度提示
                print(f"  🔄 正在上传大文件，请稍候...")
            
            s3fs_client.put_file(str(local_file), remote_path)
            
            # 验证上传
            if s3fs_client.exists(remote_path):
                remote_size = s3fs_client.info(remote_path).get('size', 0)
                if remote_size == file_size:
                    print(f"  ✅ 上传成功 - {filename}")
                    uploaded_count += 1
                else:
                    print(f"  ⚠️ 文件大小不匹配 - {filename} (本地:{file_size}, 远程:{remote_size})")
            else:
                print(f"  ❌ 上传验证失败 - {filename}")
                
        except Exception as e:
            print(f"  ❌ 上传失败 - {filename}: {str(e)}")
    
    print("=" * 50)
    print(f"📊 上传完成：成功 {uploaded_count}/{len(all_files)} 个文件")
    
    # 检查必需文件是否都上传成功
    missing_required = []
    for filename in required_files:
        remote_path = f"{bucket_name}/{filename}"
        if not s3fs_client.exists(remote_path):
            missing_required.append(filename)
    
    if missing_required:
        print(f"❌ 缺少必需文件: {', '.join(missing_required)}")
        return False
    else:
        print("✅ 所有必需的索引文件都已成功上传到R2！")
        return True

def verify_r2_files():
    """验证R2中的文件"""
    print("\n🔍 验证R2中的索引文件...")
    
    # 获取R2配置
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("BUCKET_NAME")
    
    # 创建S3FS连接
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    s3fs_client = s3fs.S3FileSystem(
        key=access_key,
        secret=secret_key,
        endpoint_url=endpoint_url,
        use_ssl=True
    )
    
    # 列出所有文件
    try:
        files = s3fs_client.ls(bucket_name)
        print(f"📁 R2存储桶 '{bucket_name}' 包含 {len(files)} 个文件:")
        
        for file_path in files:
            filename = file_path.split('/')[-1]
            try:
                file_info = s3fs_client.info(file_path)
                size = file_info.get('size', 0)
                size_mb = round(size / (1024 * 1024), 2)
                print(f"  📄 {filename} ({size_mb} MB)")
            except:
                print(f"  📄 {filename}")
        
        # 检查必需文件
        required_files = ["index_store.json", "default__vector_store.json", "docstore.json"]
        missing_files = []
        
        for filename in required_files:
            file_path = f"{bucket_name}/{filename}"
            if not s3fs_client.exists(file_path):
                missing_files.append(filename)
        
        if missing_files:
            print(f"\n❌ 缺少必需文件: {', '.join(missing_files)}")
            return False
        else:
            print(f"\n✅ 所有必需的RAG索引文件都在R2中！")
            return True
            
    except Exception as e:
        print(f"❌ 验证R2文件失败: {str(e)}")
        return False

def main():
    """主函数"""
    print("📤 Cloudflare R2 索引文件上传工具")
    print("=" * 50)
    
    # 检查环境
    if not Path("storage").exists():
        print("❌ 本地storage目录不存在，请确保在项目根目录运行")
        sys.exit(1)
    
    # 上传文件
    upload_success = upload_storage_to_r2()
    
    if upload_success:
        # 验证上传结果
        verify_success = verify_r2_files()
        
        if verify_success:
            print("\n🎉 RAG索引文件迁移完成！")
            print("\n🚀 下一步:")
            print("  1. 运行: python3 test_r2_connection.py")
            print("  2. 测试: python3 rag_query_service_r2.py")
            print("  3. 启动: node server_r2.js")
            sys.exit(0)
        else:
            print("\n⚠️ 上传验证失败，请检查并重试")
            sys.exit(1)
    else:
        print("\n❌ 上传失败，请检查错误信息并重试")
        sys.exit(1)

if __name__ == "__main__":
    main() 