// 岗位数据加载器 - 自动生成
(function() {
  'use strict';

  window.JOBWEB_DATA_LOADER = {
    config: {
      totalChunks: 9,
      priorityChunkIndex: 0,
      loadedChunks: new Set(),
      isLoading: false,
      loadStartTime: Date.now()
    },

    state: {
      priorityLoaded: false,
      allLoaded: false,
      progress: 0,
      callbacks: []
    },

    init: function() {
      if (window.JOBWEB_PRIORITY_LOADED) {
        this.state.priorityLoaded = true;
        this.config.loadedChunks.add(0);
        this._notifyPriorityLoaded();
      }
    },

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

    preload: function() {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          this.loadRemaining();
        }, { timeout: 2000 });
      } else {
        setTimeout(() => this.loadRemaining(), 100);
      }
    },

    getJobs: function() {
      return (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.jobs) || [];
    },

    getMeta: function() {
      return (window.JOBWEB_META) || {};
    },

    isPriorityLoaded: function() {
      return this.state.priorityLoaded;
    },

    isAllLoaded: function() {
      return this.state.allLoaded;
    },

    waitForPriority: function() {
      return new Promise((resolve) => {
        if (this.state.priorityLoaded) {
          resolve();
        } else {
          this.state.callbacks.push({ type: 'priority', resolve });
        }
      });
    },

    waitForAll: function() {
      return new Promise((resolve) => {
        if (this.state.allLoaded) {
          resolve();
        } else {
          this.state.callbacks.push({ type: 'all', resolve });
        }
      });
    },

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

  window.JOBWEB_DATA_LOADER.init();
})();
