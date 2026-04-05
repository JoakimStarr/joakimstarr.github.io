// 岗位数据加载器 - 实现渐进式加载
(function() {
  'use strict';

  window.JOBWEB_DATA_LOADER = {
    // 配置
    config: {
      totalChunks: 8,
      priorityChunkIndex: 0,
      loadedChunks: new Set(),
      isLoading: false,
      loadStartTime: Date.now()
    },

    // 状态
    state: {
      priorityLoaded: false,
      allLoaded: false,
      progress: 0,
      callbacks: []
    },

    // 初始化
    init: function() {
      // 检查第一块是否已加载
      if (window.JOBWEB_PRIORITY_LOADED) {
        this.state.priorityLoaded = true;
        this.config.loadedChunks.add(0);
        this._notifyPriorityLoaded();
      }
    },

    // 加载剩余数据块
    loadRemaining: async function(onProgress) {
      if (this.config.isLoading || this.state.allLoaded) return;
      this.config.isLoading = true;

      const remainingChunks = [];
      for (let i = 1; i < this.config.totalChunks; i++) {
        if (!this.config.loadedChunks.has(i)) {
          remainingChunks.push(i);
        }
      }

      const total = remainingChunks.length;
      let loaded = 0;

      // 串行加载，避免阻塞
      for (const chunkIndex of remainingChunks) {
        try {
          await this._loadChunk(chunkIndex);
          loaded++;
          this.state.progress = Math.round((loaded / total) * 100);

          if (onProgress) {
            onProgress({
              loaded: loaded,
              total: total,
              progress: this.state.progress,
              chunkIndex: chunkIndex
            });
          }

          // 每加载一个块后暂停一下，让出主线程
          if (chunkIndex < remainingChunks[remainingChunks.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } catch (err) {
          console.warn('加载数据块失败:', chunkIndex, err);
        }
      }

      this.config.isLoading = false;
      this.state.allLoaded = true;
      this._notifyAllLoaded();
    },

    // 预加载（后台静默加载）
    preload: function() {
      // 使用 requestIdleCallback 在浏览器空闲时加载
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          this.loadRemaining();
        }, { timeout: 2000 });
      } else {
        // 降级方案：使用 setTimeout
        setTimeout(() => this.loadRemaining(), 100);
      }
    },

    // 获取当前可用的数据
    getJobs: function() {
      return (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.jobs) || [];
    },

    // 获取元数据
    getMeta: function() {
      return (window.JOBWEB_META) || {};
    },

    // 检查是否已加载
    isPriorityLoaded: function() {
      return this.state.priorityLoaded;
    },

    isAllLoaded: function() {
      return this.state.allLoaded;
    },

    // 等待优先数据加载完成
    waitForPriority: function() {
      return new Promise((resolve) => {
        if (this.state.priorityLoaded) {
          resolve();
        } else {
          this.state.callbacks.push({ type: 'priority', resolve });
        }
      });
    },

    // 等待所有数据加载完成
    waitForAll: function() {
      return new Promise((resolve) => {
        if (this.state.allLoaded) {
          resolve();
        } else {
          this.state.callbacks.push({ type: 'all', resolve });
        }
      });
    },

    // 内部方法：加载单个数据块
    _loadChunk: function(index) {
      return new Promise((resolve, reject) => {
        if (this.config.loadedChunks.has(index)) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = `./data/jobs.chunk.${index}.js`;
        script.async = true;

        script.onload = () => {
          this.config.loadedChunks.add(index);
          resolve();
        };

        script.onerror = () => {
          reject(new Error('Failed to load chunk ' + index));
        };

        document.head.appendChild(script);
      });
    },

    // 通知回调
    _notifyPriorityLoaded: function() {
      this.state.callbacks
        .filter(cb => cb.type === 'priority')
        .forEach(cb => cb.resolve());
      this.state.callbacks = this.state.callbacks.filter(cb => cb.type !== 'priority');
    },

    _notifyAllLoaded: function() {
      this.state.callbacks.forEach(cb => cb.resolve());
      this.state.callbacks = [];
    }
  };

  // 自动初始化
  window.JOBWEB_DATA_LOADER.init();
})();
