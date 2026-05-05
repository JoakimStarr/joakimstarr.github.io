#!/usr/bin/env python3
"""
将大的 jobs.data.js 分割成多个小文件，实现按需加载
- jobs.meta.js: 元数据（统计信息、配置等）
- jobs.chunk.0.js: 前20条数据（优先加载）
- jobs.chunk.1.js, jobs.chunk.2.js...: 剩余数据分块（后台加载）
"""

import json
import re
import os


def parse_jobs_data_js(filepath):
    """解析 jobs.data.js 文件，提取 JSON 数据"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 提取 window.JOBWEB_SNAPSHOT = {...} 中的 JSON 部分
    match = re.search(r'window\.JOBWEB_SNAPSHOT\s*=\s*(\{[\s\S]*\});?\s*$', content)
    if not match:
        raise ValueError("无法解析 jobs.data.js 文件格式")

    json_str = match.group(1)
    return json.loads(json_str)


def split_data(data, first_chunk_size=20, chunk_size=500):
    """
    将数据分割成多个块
    - 第一块：前20条（快速渲染）
    - 后续块：每500条一个文件
    """
    jobs = data.get('jobs', [])
    meta = data.get('meta', {})
    stats = data.get('stats', {})

    chunks = []

    # 第一块：前20条
    if jobs:
        first_chunk = jobs[:first_chunk_size]
        chunks.append({
            'index': 0,
            'jobs': first_chunk,
            'is_priority': True
        })

    # 剩余数据分块
    remaining = jobs[first_chunk_size:]
    for i in range(0, len(remaining), chunk_size):
        chunk = remaining[i:i + chunk_size]
        chunks.append({
            'index': len(chunks),
            'jobs': chunk,
            'is_priority': False
        })

    return meta, stats, chunks


def save_meta_js(meta, stats, output_dir):
    """保存元数据文件"""
    filepath = os.path.join(output_dir, 'jobs.meta.js')
    content = f"""// 岗位数据元数据 - 自动生成
window.JOBWEB_META = {json.dumps({
    'meta': meta,
    'stats': stats
}, ensure_ascii=False, indent=2)};
"""
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"已生成: {filepath}")


def save_chunk_js(chunk, output_dir, all_chunks):
    """保存数据块文件"""
    filepath = os.path.join(output_dir, f'jobs.chunk.{chunk["index"]}.js')

    if chunk['index'] == 0:
        # 第一块包含完整的窗口对象结构（前20条）
        content = f"""// 岗位数据块 {chunk['index']} - 优先加载（前{len(chunk['jobs'])}条）
window.JOBWEB_SNAPSHOT = window.JOBWEB_SNAPSHOT || {{}};
window.JOBWEB_SNAPSHOT.jobs = {json.dumps(chunk['jobs'], ensure_ascii=False, indent=2)};
window.JOBWEB_PRIORITY_LOADED = true;
"""
    else:
        # 后续块包含累积数据（从第1条到当前块的所有数据）
        # 计算累积的数据
        cumulative_jobs = []
        for i in range(chunk['index'] + 1):
            cumulative_jobs.extend(all_chunks[i]['jobs'])

        content = f"""// 岗位数据块 {chunk['index']} - 后台加载（累积前{len(cumulative_jobs)}条）
(function() {{
  window.JOBWEB_SNAPSHOT = window.JOBWEB_SNAPSHOT || {{}};
  // 替换为累积数据，避免与缓存数据叠加
  window.JOBWEB_SNAPSHOT.jobs = {json.dumps(cumulative_jobs, ensure_ascii=False, indent=2)};
  window.JOBWEB_CHUNK_{chunk['index']}_LOADED = true;
}})();
"""

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"已生成: {filepath} ({len(chunk['jobs'])} 条新数据, 累积{len(cumulative_jobs) if chunk['index'] > 0 else len(chunk['jobs'])}条)")
    return filepath


def save_loader_js(chunks, output_dir):
    """保存数据加载器脚本"""
    chunk_count = len(chunks)
    priority_chunk = chunks[0] if chunks else None

    filepath = os.path.join(output_dir, 'jobs.loader.js')
    content = f"""// 岗位数据加载器 - 实现渐进式加载
(function() {{
  'use strict';

  window.JOBWEB_DATA_LOADER = {{
    // 配置
    config: {{
      totalChunks: {chunk_count},
      priorityChunkIndex: 0,
      loadedChunks: new Set(),
      isLoading: false,
      loadStartTime: Date.now()
    }},

    // 状态
    state: {{
      priorityLoaded: false,
      allLoaded: false,
      progress: 0,
      callbacks: []
    }},

    // 初始化
    init: function() {{
      // 检查第一块是否已加载
      if (window.JOBWEB_PRIORITY_LOADED) {{
        this.state.priorityLoaded = true;
        this.config.loadedChunks.add(0);
        this._notifyPriorityLoaded();
      }}
    }},

    // 加载剩余数据块
    loadRemaining: async function(onProgress) {{
      if (this.config.isLoading || this.state.allLoaded) return;
      this.config.isLoading = true;

      const remainingChunks = [];
      for (let i = 1; i < this.config.totalChunks; i++) {{
        if (!this.config.loadedChunks.has(i)) {{
          remainingChunks.push(i);
        }}
      }}

      const total = remainingChunks.length;
      let loaded = 0;

      // 串行加载，避免阻塞
      for (const chunkIndex of remainingChunks) {{
        try {{
          await this._loadChunk(chunkIndex);
          loaded++;
          this.state.progress = Math.round((loaded / total) * 100);

          if (onProgress) {{
            onProgress({{
              loaded: loaded,
              total: total,
              progress: this.state.progress,
              chunkIndex: chunkIndex
            }});
          }}

          // 每加载一个块后暂停一下，让出主线程
          if (chunkIndex < remainingChunks[remainingChunks.length - 1]) {{
            await new Promise(resolve => setTimeout(resolve, 10));
          }}
        }} catch (err) {{
          console.warn('加载数据块失败:', chunkIndex, err);
        }}
      }}

      this.config.isLoading = false;
      this.state.allLoaded = true;
      this._notifyAllLoaded();
    }},

    // 预加载（后台静默加载）
    preload: function() {{
      // 使用 requestIdleCallback 在浏览器空闲时加载
      if ('requestIdleCallback' in window) {{
        requestIdleCallback(() => {{
          this.loadRemaining();
        }}, {{ timeout: 2000 }});
      }} else {{
        // 降级方案：使用 setTimeout
        setTimeout(() => this.loadRemaining(), 100);
      }}
    }},

    // 获取当前可用的数据
    getJobs: function() {{
      return (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.jobs) || [];
    }},

    // 获取元数据
    getMeta: function() {{
      return (window.JOBWEB_META) || {{}};
    }},

    // 检查是否已加载
    isPriorityLoaded: function() {{
      return this.state.priorityLoaded;
    }},

    isAllLoaded: function() {{
      return this.state.allLoaded;
    }},

    // 等待优先数据加载完成
    waitForPriority: function() {{
      return new Promise((resolve) => {{
        if (this.state.priorityLoaded) {{
          resolve();
        }} else {{
          this.state.callbacks.push({{ type: 'priority', resolve }});
        }}
      }});
    }},

    // 等待所有数据加载完成
    waitForAll: function() {{
      return new Promise((resolve) => {{
        if (this.state.allLoaded) {{
          resolve();
        }} else {{
          this.state.callbacks.push({{ type: 'all', resolve }});
        }}
      }});
    }},

    // 内部方法：加载单个数据块
    _loadChunk: function(index) {{
      return new Promise((resolve, reject) => {{
        if (this.config.loadedChunks.has(index)) {{
          resolve();
          return;
        }}

        const script = document.createElement('script');
        script.src = `./data/jobs.chunk.${{index}}.js`;
        script.async = true;

        script.onload = () => {{
          this.config.loadedChunks.add(index);
          resolve();
        }};

        script.onerror = () => {{
          reject(new Error('Failed to load chunk ' + index));
        }};

        document.head.appendChild(script);
      }});
    }},

    // 通知回调
    _notifyPriorityLoaded: function() {{
      this.state.callbacks
        .filter(cb => cb.type === 'priority')
        .forEach(cb => cb.resolve());
      this.state.callbacks = this.state.callbacks.filter(cb => cb.type !== 'priority');
    }},

    _notifyAllLoaded: function() {{
      this.state.callbacks.forEach(cb => cb.resolve());
      this.state.callbacks = [];
    }}
  }};

  // 自动初始化
  window.JOBWEB_DATA_LOADER.init();
}})();
"""

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"已生成: {filepath}")


def main():
    input_file = 'jobs.data.js'
    output_dir = '.'

    print(f"正在解析: {input_file}")
    data = parse_jobs_data_js(input_file)

    total_jobs = len(data.get('jobs', []))
    print(f"总岗位数: {total_jobs}")

    # 分割数据
    meta, stats, chunks = split_data(data, first_chunk_size=20, chunk_size=500)
    print(f"分割为 {len(chunks)} 个数据块")

    # 保存元数据
    save_meta_js(meta, stats, output_dir)

    # 保存数据块
    for chunk in chunks:
        save_chunk_js(chunk, output_dir, chunks)

    # 保存加载器
    save_loader_js(chunks, output_dir)

    print("\n数据分割完成!")
    print(f"- 优先加载: jobs.chunk.0.js (前20条)")
    print(f"- 后台加载: jobs.chunk.1.js ~ jobs.chunk.{len(chunks)-1}.js")
    print(f"- 加载器: jobs.loader.js")


if __name__ == '__main__':
    main()
