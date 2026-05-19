#!/usr/bin/env python3
import json
import re

# 读取原始数据
with open('jobs.data.js', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'window\.JOBWEB_SNAPSHOT\s*=\s*(\{[\s\S]*\});?\s*$', content)
if match:
    data = json.loads(match.group(1))
    original_count = len(data.get('jobs', []))
    print(f'原始数据总量: {original_count} 条')
else:
    print('无法解析原始数据')
    original_count = 0

# 检查分割后的数据块
total_in_chunks = 0
for i in range(8):
    try:
        with open(f'jobs.chunk.{i}.js', 'r', encoding='utf-8') as f:
            chunk_content = f.read()

        # 提取数组部分
        match = re.search(r'window\.JOBWEB_SNAPSHOT\.jobs\s*=\s*(\[[\s\S]*\]);', chunk_content)
        if match:
            jobs = json.loads(match.group(1))
            print(f'jobs.chunk.{i}.js: {len(jobs)} 条')
            if i == 7:  # 最后一块应该是完整的
                total_in_chunks = len(jobs)
        else:
            # 尝试其他格式
            match = re.search(r'jobs\s*=\s*(\[[\s\S]*\]);', chunk_content)
            if match:
                jobs = json.loads(match.group(1))
                print(f'jobs.chunk.{i}.js: {len(jobs)} 条')
                if i == 7:
                    total_in_chunks = len(jobs)
    except Exception as e:
        print(f'jobs.chunk.{i}.js: 错误 - {e}')

print(f'\n最后一块数据量: {total_in_chunks}')
print(f'原始数据量: {original_count}')
if original_count > 0:
    print(f'数据完整性: {"✓ 完整" if total_in_chunks == original_count else "✗ 丢失"}')
