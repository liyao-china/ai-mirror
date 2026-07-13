/**
 * AI面镜 · 首次使用动态操作指引
 * 基于 driver.js（CDN 引入）+ 自定义图解 Modal
 */
(function() {
  'use strict';

  const LOG = '[Guide]';

  // ===== localStorage 键名 =====
  const KEYS = {
    HAS_SEEN: 'hasSeenGuide',
    ACTIVE: 'guideActive',
    STEP: 'guideStep',
  };

  // ===== 全局步骤总数 =====
  const TOTAL_STEPS = 15; // 0-14

  // ===== 当前状态 =====
  let driverObj = null;
  let currentStep = 0;
  let diagramModal = null;

  // ===== 页面步骤注册表 =====
  // 每页注册自己的 driver.js steps（只包含本页的 highlight 步骤）
  const pageSteps = {};

  // ===== 图解步骤内容 =====
  const diagramContents = [
    {
      id: 'interview-diagram',
      title: '面试中会发生什么？',
      emojis: ['🎤', '💬', '📝', '✅'],
      labels: ['面试官提问', '语音字幕同步', '你作答', '随时可结束'],
      desc: '面试官会逐题向你提问，字幕与语音同步播放。你可以打字回答，也可以开麦克风语音作答，甚至开摄像头视频面试。面试中可随时提前结束。',
    },
    {
      id: 'report-diagram',
      title: '面试结束后',
      emojis: ['📊', '📝', '📈', '👤'],
      labels: ['六维雷达评分', '逐题点评建议', '历史成长曲线', '个人中心回看'],
      desc: '每场面试结束后，系统会生成六维雷达评分报告，给出逐题点评与改进建议。你可以在「历史成长」页面追踪分数变化，在个人中心随时回看所有报告。',
    },
  ];

  // ===== 公共方法 =====
  const Guide = {
    /**
     * 注册本页的 driver.js 步骤
     * @param {string} pageName - 'index' | 'onboarding' | 'setup'
     * @param {Array} steps - driver.js steps 数组
     */
    registerPage(pageName, steps) {
      pageSteps[pageName] = steps;
    },

    /**
     * 页面初始化入口
     * @param {string} pageName - 当前页面名
     */
    init(pageName) {
      // 先渲染「❓使用指引」按钮
      this.renderHelpButton();

      const active = localStorage.getItem(KEYS.ACTIVE) === '1';
      const hasSeen = localStorage.getItem(KEYS.HAS_SEEN) === '1';

      if (active) {
        // 续播：从保存的 step 继续
        const savedStep = parseInt(localStorage.getItem(KEYS.STEP) || '0', 10);
        currentStep = savedStep;
        console.log(LOG, '续播，从步骤', currentStep);
        this.playStep(currentStep);
      } else if (!hasSeen && pageName === 'index') {
        // 首次访问 index，自动启动
        console.log(LOG, '首次访问，自动启动引导');
        this.start(false);
      }
    },

    /**
     * 启动引导
     * @param {boolean} manual - true=手动重开（无视 hasSeenGuide）
     */
    start(manual) {
      localStorage.setItem(KEYS.ACTIVE, '1');
      localStorage.setItem(KEYS.STEP, '0');
      currentStep = 0;
      this.playStep(0);
    },

    /**
     * 执行某一步
     */
    playStep(stepIdx) {
      currentStep = stepIdx;
      if (stepIdx <= 1) {
        this.playDriverStep(stepIdx, 'index');
      } else if (stepIdx >= 2 && stepIdx <= 4) {
        this.playDriverStep(stepIdx, 'onboarding');
      } else if (stepIdx >= 5 && stepIdx <= 11) {
        this.playDriverStep(stepIdx, 'setup');
      } else if (stepIdx === 12 || stepIdx === 13) {
        this.showDiagram(stepIdx - 12);
      } else if (stepIdx === 14) {
        this.showEndCard();
      }
    },

    /**
     * 用 driver.js 播放单步高亮
     */
    playDriverStep(stepIdx, pageName) {
      const steps = pageSteps[pageName];
      if (!steps) {
        console.warn(LOG, '页面未注册步骤:', pageName);
        this.skip();
        return;
      }

      // 找到当前 step 在该页 steps 数组中的索引
      const localIdx = this.getLocalIndex(stepIdx, pageName);
      if (localIdx < 0 || localIdx >= steps.length) {
        console.warn(LOG, '步骤越界:', stepIdx, pageName);
        this.next();
        return;
      }

      const stepDef = steps[localIdx];
      if (!stepDef) {
        this.next();
        return;
      }

      // 检查元素是否存在，不存在则 fallback 为 body 居中
      let element = stepDef.element;
      if (element && typeof element === 'string') {
        const el = document.querySelector(element);
        if (!el) {
          console.warn(LOG, '元素未找到，fallback 居中:', element);
          element = undefined; // driver.js 不传 element 时居中
        }
      }

      // 销毁之前的 driver 实例
      if (driverObj) {
        try { driverObj.destroy(); } catch(e) {}
        driverObj = null;
      }

      // 滚动到元素可视区域
      if (element) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      // 延迟启动 driver，等滚动完成
      setTimeout(() => {
        const driver = window.driver && window.driver.js && window.driver.js.driver;
        if (!driver) {
          console.error(LOG, 'driver.js 未加载');
          this.skip();
          return;
        }

        driverObj = driver({
          showProgress: true,
          progressText: '第 {{current}} 步，共 {{total}} 步',
          nextBtnText: '下一步',
          prevBtnText: '上一步',
          doneBtnText: '完成',
          allowClose: true,
          overlayClickNext: false,
          overlayColor: 'rgba(0,0,0,0.55)',
          steps: [{
            element: element,
            popover: {
              title: stepDef.popover.title,
              description: stepDef.popover.description,
              side: stepDef.popover.side || 'bottom',
              align: stepDef.popover.align || 'start',
            },
          }],
          onNextClick: () => {
            if (driverObj) { try { driverObj.destroy(); } catch(e) {} driverObj = null; }
            this.next();
          },
          onPrevClick: () => {
            if (driverObj) { try { driverObj.destroy(); } catch(e) {} driverObj = null; }
            this.prev();
          },
          onClose: () => {
            if (driverObj) { try { driverObj.destroy(); } catch(e) {} driverObj = null; }
            this.skip();
          },
        });
        driverObj.drive();
      }, element ? 300 : 0);
    },

    /**
     * 将全局 stepIdx 映射到某页内的 local index
     */
    getLocalIndex(stepIdx, pageName) {
      const map = { index: [0, 1], onboarding: [2, 3, 4], setup: [5, 6, 7, 8, 9, 10, 11] };
      const pageRange = map[pageName];
      if (!pageRange) return -1;
      const start = pageRange[0];
      return stepIdx - start;
    },

    /**
     * 下一步
     */
    next() {
      // 步骤 1 → 跳 onboarding
      if (currentStep === 1) {
        localStorage.setItem(KEYS.STEP, '2');
        window.location.href = 'onboarding.html';
        return;
      }
      // 步骤 4 → 跳 setup
      if (currentStep === 4) {
        localStorage.setItem(KEYS.STEP, '5');
        window.location.href = 'setup.html';
        return;
      }
      // 最后一步 → 结束
      if (currentStep >= TOTAL_STEPS - 1) {
        this.finish();
        return;
      }
      currentStep++;
      localStorage.setItem(KEYS.STEP, String(currentStep));
      this.playStep(currentStep);
    },

    /**
     * 上一步
     */
    prev() {
      if (currentStep <= 0) return;
      currentStep--;
      localStorage.setItem(KEYS.STEP, String(currentStep));
      this.playStep(currentStep);
    },

    /**
     * 跳过/结束引导
     */
    skip() {
      this.finish();
    },

    /**
     * 完成引导，清理状态
     */
    finish() {
      localStorage.setItem(KEYS.HAS_SEEN, '1');
      localStorage.removeItem(KEYS.ACTIVE);
      localStorage.removeItem(KEYS.STEP);
      if (driverObj) {
        try { driverObj.destroy(); } catch(e) {}
        driverObj = null;
      }
      this.hideDiagram();
    },

    /**
     * 显示图解 Modal（步骤 12-13）
     */
    showDiagram(diagramIdx) {
      this.hideDiagram();
      const data = diagramContents[diagramIdx];
      if (!data) { this.next(); return; }

      const modal = document.createElement('div');
      modal.id = 'guide-diagram-modal';
      modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
      modal.style.cssText = 'background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);';

      // emoji 流程图行
      const emojiRow = data.emojis.map((e, i) =>
        `<div class="flex flex-col items-center gap-1"><span class="text-3xl">${e}</span><span class="text-[10px] text-gray-400">${data.labels[i]}</span></div>`
      ).join('<span class="text-gray-300 text-lg">→</span>');

      modal.innerHTML = `
        <div class="bg-white rounded-2xl p-8 max-w-md w-full mx-4 relative" style="box-shadow:0 20px 60px rgba(0,0,0,0.15);">
          <div class="text-xs text-gray-400 mb-4 text-center">第 ${currentStep + 1} 步，共 ${TOTAL_STEPS} 步</div>
          <div class="flex items-center justify-center gap-2 mb-6">${emojiRow}</div>
          <h3 class="text-xl font-bold text-gray-900 mb-3 text-center">${data.title}</h3>
          <p class="text-sm text-gray-500 text-center mb-8 leading-relaxed">${data.desc}</p>
          <div class="flex justify-center gap-3">
            <button id="guide-diagram-prev" class="px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200 transition">上一步</button>
            <button id="guide-diagram-next" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition" style="background:linear-gradient(135deg,#6366F1 0%,#8B5CF6 100%);">下一步</button>
          </div>
          <button id="guide-diagram-skip" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
      `;

      document.body.appendChild(modal);
      diagramModal = modal;

      // 绑定事件
      modal.querySelector('#guide-diagram-next').onclick = () => { this.hideDiagram(); this.next(); };
      modal.querySelector('#guide-diagram-prev').onclick = () => { this.hideDiagram(); this.prev(); };
      modal.querySelector('#guide-diagram-skip').onclick = () => { this.skip(); };
      modal.onclick = (e) => { if (e.target === modal) this.skip(); };

      // ESC 关闭
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); this.skip(); }
        if (e.key === 'ArrowRight' || e.key === 'Enter') { document.removeEventListener('keydown', onKey); this.hideDiagram(); this.next(); }
        if (e.key === 'ArrowLeft') { document.removeEventListener('keydown', onKey); this.hideDiagram(); this.prev(); }
      };
      document.addEventListener('keydown', onKey);
    },

    /**
     * 显示结束卡（步骤 14）
     */
    showEndCard() {
      this.hideDiagram();
      const modal = document.createElement('div');
      modal.id = 'guide-end-modal';
      modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
      modal.style.cssText = 'background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);';

      modal.innerHTML = `
        <div class="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 text-center relative" style="box-shadow:0 20px 60px rgba(0,0,0,0.15);">
          <div class="text-4xl mb-4">🎉</div>
          <h3 class="text-xl font-bold text-gray-900 mb-2">准备好了吗？</h3>
          <p class="text-sm text-gray-500 mb-8">你已经了解了 AI面镜 的全部流程，现在可以开始你的第一场模拟面试了。</p>
          <div class="flex flex-col gap-3">
            <a href="setup.html" class="block w-full py-3 rounded-xl text-sm font-semibold text-white text-center transition" style="background:linear-gradient(135deg,#6366F1 0%,#8B5CF6 100%);">开始我的第一场面试</a>
            <button onclick="Guide.finish();" class="w-full py-3 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200 transition">我先逛逛</button>
          </div>
          <button onclick="Guide.skip();" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
      `;

      document.body.appendChild(modal);
      diagramModal = modal;

      modal.querySelector('a').onclick = () => { this.finish(); };
      modal.onclick = (e) => { if (e.target === modal) this.skip(); };

      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); this.skip(); }
      };
      document.addEventListener('keydown', onKey);
    },

    /**
     * 隐藏图解 Modal
     */
    hideDiagram() {
      if (diagramModal) {
        diagramModal.remove();
        diagramModal = null;
      }
    },

    /**
     * 渲染「❓使用指引」按钮到顶栏
     */
    renderHelpButton() {
      // 如果页面已手动放置按钮，不再自动插入
      if (document.getElementById('guide-help-btn')) return;

      // 查找顶栏右侧容器（多种可能的结构）
      const selectors = [
        'nav .hidden.md\\:flex.items-center',      // index.html 桌面导航
        'nav .flex.items-center.gap-4',             // setup/history/profile
        'nav .flex.items-center.gap-3',             // fallback
        'nav > div:last-child',                     // 任何 nav 的最后一个 div
        '#navbar .flex.items-center',               // onboarding
        'div.flex.items-center.gap-3',              // report.html 顶部按钮区
      ];
      let container = null;
      for (const sel of selectors) {
        container = document.querySelector(sel);
        if (container) {
          // 排除纯 logo 区（只含一个 a 链接且 href 含 index）
          const links = container.querySelectorAll('a');
          if (links.length > 1 || (links.length === 1 && !links[0].href.includes('index.html'))) break;
        }
      }
      if (!container) return;
      if (container.querySelector('#guide-help-btn')) return;

      const btn = document.createElement('a');
      btn.id = 'guide-help-btn';
      btn.href = 'javascript:void(0)';
      btn.className = 'text-sm text-gray-500 hover:text-primary transition-colors';
      btn.title = '使用指引';
      btn.textContent = '❓';
      btn.onclick = (e) => { e.preventDefault(); if (window.Guide) window.Guide.start(true); };

      // 插入到「会员」链接之前，或末尾
      const membershipLink = Array.from(container.querySelectorAll('a')).find(a => a.href && a.href.includes('membership'));
      if (membershipLink) {
        container.insertBefore(btn, membershipLink);
      } else {
        container.appendChild(btn);
      }
    },
  };

  // 暴露到全局
  window.Guide = Guide;
})();
