/**
 * AI面镜 · 首次使用动态操作指引
 * 基于 driver.js（CDN 引入）+ 自定义图解 Modal
 *
 * 全局步骤表（共 9 步）：
 *   0-1  index      欢迎 / 开始入口
 *   2-3  onboarding 简历 / JD
 *   4-6  setup      岗位职级 / 面试官轮次 / 开始面试
 *   7    图解 Modal（面试中 + 面试后，合并一张卡）
 *   8    结束卡
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
  const TOTAL_STEPS = 9; // 0-8

  // 各页面对应的全局步骤区间 [start, end]
  const PAGE_RANGES = {
    index: [0, 1],
    onboarding: [2, 3],
    setup: [4, 6],
  };
  // 页面段的起始步骤（prev 不允许跨页往回跳）
  const PAGE_STARTS = [0, 2, 4];

  // ===== 当前状态 =====
  let driverObj = null;
  let currentStep = 0;
  let diagramModal = null;

  // ===== 页面步骤注册表 =====
  const pageSteps = {};

  // ===== 图解内容（合并为一张卡的两段） =====
  const diagramSections = [
    {
      title: '面试中会发生什么？',
      emojis: ['🎤', '💬', '📝', '✅'],
      labels: ['面试官提问', '语音字幕同步', '你作答', '随时可结束'],
      desc: '面试官逐题提问，字幕与语音同步。你可以打字回答，也可以开麦语音作答，甚至开摄像头视频面试，中途可随时提前结束。',
    },
    {
      title: '面试结束后',
      emojis: ['📊', '📝', '📈', '👤'],
      labels: ['六维评分', '逐题点评', '成长曲线', '随时回看'],
      desc: '系统生成六维雷达评分报告与逐题改进建议，可在「历史成长」和个人中心随时回看、追踪进步。',
    },
  ];

  /** 拼当前步的中文进度文案（driver 每次只挂 1 个 step，模板变量不可用） */
  function progressLabel(stepIdx) {
    return '第 ' + (stepIdx + 1) + ' 步，共 ' + TOTAL_STEPS + ' 步';
  }

  const Guide = {
    /**
     * 注册本页的 driver.js 步骤
     * @param {string} pageName - 'index' | 'onboarding' | 'setup'
     * @param {Array} steps - driver.js steps 数组（数量需与 PAGE_RANGES 区间一致）
     */
    registerPage(pageName, steps) {
      pageSteps[pageName] = steps;
    },

    /**
     * 页面初始化入口
     */
    init(pageName) {
      this.renderHelpButton();

      const active = localStorage.getItem(KEYS.ACTIVE) === '1';
      const hasSeen = localStorage.getItem(KEYS.HAS_SEEN) === '1';

      if (active) {
        // 跨页续播
        const savedStep = parseInt(localStorage.getItem(KEYS.STEP) || '0', 10);
        currentStep = isNaN(savedStep) ? 0 : savedStep;
        console.log(LOG, '续播，从步骤', currentStep);
        this.playStep(currentStep);
      } else if (!hasSeen && pageName === 'index') {
        // 首次访问：延迟启动，等首屏动画结束，不要一进来就糊脸
        console.log(LOG, '首次访问，1.5s 后自动启动引导');
        setTimeout(() => {
          // 用户可能已手动点开或关闭
          if (localStorage.getItem(KEYS.HAS_SEEN) === '1') return;
          this.start(false);
        }, 1500);
      }
    },

    /**
     * 启动引导
     */
    start(manual) {
      localStorage.setItem(KEYS.ACTIVE, '1');
      localStorage.setItem(KEYS.STEP, '0');
      currentStep = 0;
      // 手动重开时如果不在首页，直接回首页从头开始
      const onIndex = !!pageSteps.index;
      if (manual && !onIndex) {
        window.location.href = 'index.html';
        return;
      }
      this.playStep(0);
    },

    /**
     * 执行某一步
     */
    playStep(stepIdx) {
      currentStep = stepIdx;
      if (stepIdx <= 1) {
        this.playDriverStep(stepIdx, 'index');
      } else if (stepIdx >= 2 && stepIdx <= 3) {
        this.playDriverStep(stepIdx, 'onboarding');
      } else if (stepIdx >= 4 && stepIdx <= 6) {
        this.playDriverStep(stepIdx, 'setup');
      } else if (stepIdx === 7) {
        this.showDiagram();
      } else if (stepIdx === 8) {
        this.showEndCard();
      } else {
        this.finish();
      }
    },

    /**
     * 用 driver.js 播放单步高亮
     */
    playDriverStep(stepIdx, pageName) {
      const steps = pageSteps[pageName];
      if (!steps) {
        // 本页未注册步骤（比如用户中途手动换页）：跳过本步而不是终止整个引导
        console.warn(LOG, '页面未注册步骤，跳过:', pageName);
        this.next();
        return;
      }

      const localIdx = this.getLocalIndex(stepIdx, pageName);
      if (localIdx < 0 || localIdx >= steps.length) {
        console.warn(LOG, '步骤越界，跳过:', stepIdx, pageName);
        this.next();
        return;
      }

      const stepDef = steps[localIdx];
      if (!stepDef) { this.next(); return; }

      // 元素不存在时退化为居中气泡
      let element = stepDef.element;
      if (element && typeof element === 'string') {
        const el = document.querySelector(element);
        if (!el) {
          console.warn(LOG, '元素未找到，fallback 居中:', element);
          element = undefined;
        }
      }

      if (driverObj) {
        try { driverObj.destroy(); } catch(e) {}
        driverObj = null;
      }

      // 滚动到元素可视区域
      if (element) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      setTimeout(() => {
        const driver = window.driver && window.driver.js && window.driver.js.driver;
        if (!driver) {
          console.error(LOG, 'driver.js 未加载');
          this.finish();
          return;
        }

        driverObj = driver({
          showProgress: true,
          // driver 实例每次只有 1 个 step，模板变量会显示成 1/1，这里直接给拼好的字面串
          progressText: progressLabel(stepIdx),
          nextBtnText: stepIdx >= TOTAL_STEPS - 1 ? '完成' : '下一步',
          prevBtnText: '上一步',
          doneBtnText: '下一步',
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
     * 全局 stepIdx → 页内 local index
     */
    getLocalIndex(stepIdx, pageName) {
      const range = PAGE_RANGES[pageName];
      if (!range) return -1;
      return stepIdx - range[0];
    },

    /**
     * 下一步
     */
    next() {
      // index 最后一步 → 跳 onboarding
      if (currentStep === 1) {
        localStorage.setItem(KEYS.STEP, '2');
        window.location.href = 'onboarding.html';
        return;
      }
      // onboarding 最后一步 → 跳 setup
      if (currentStep === 3) {
        localStorage.setItem(KEYS.STEP, '4');
        window.location.href = 'setup.html';
        return;
      }
      if (currentStep >= TOTAL_STEPS - 1) {
        this.finish();
        return;
      }
      currentStep++;
      localStorage.setItem(KEYS.STEP, String(currentStep));
      this.playStep(currentStep);
    },

    /**
     * 上一步（不允许跨页往回跳，避免回到上一页元素不存在）
     */
    prev() {
      if (currentStep <= 0) return;
      if (PAGE_STARTS.indexOf(currentStep) !== -1) return;
      currentStep--;
      localStorage.setItem(KEYS.STEP, String(currentStep));
      this.playStep(currentStep);
    },

    /**
     * 跳过引导
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
     * 图解 Modal（步骤 7：面试中 + 面试后合并一张卡）
     */
    showDiagram() {
      this.hideDiagram();

      const modal = document.createElement('div');
      modal.id = 'guide-diagram-modal';
      modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
      modal.style.cssText = 'background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);';

      const sectionHtml = diagramSections.map((data, i) => {
        const emojiRow = data.emojis.map((e, j) =>
          `<div class="flex flex-col items-center gap-1"><span class="text-2xl">${e}</span><span class="text-[10px] text-gray-400">${data.labels[j]}</span></div>`
        ).join('<span class="text-gray-300 text-base">→</span>');
        return `
          <div class="${i > 0 ? 'mt-6 pt-6 border-t border-gray-100' : ''}">
            <h4 class="text-base font-bold text-gray-900 mb-3 text-center">${data.title}</h4>
            <div class="flex items-center justify-center gap-2 mb-3">${emojiRow}</div>
            <p class="text-[13px] text-gray-500 text-center leading-relaxed">${data.desc}</p>
          </div>`;
      }).join('');

      modal.innerHTML = `
        <div class="bg-white rounded-2xl p-8 max-w-md w-full mx-4 relative" style="box-shadow:0 20px 60px rgba(0,0,0,0.15);">
          <div class="text-xs text-gray-400 mb-4 text-center">${progressLabel(currentStep)}</div>
          ${sectionHtml}
          <div class="flex justify-center gap-3 mt-8">
            <button id="guide-diagram-prev" class="px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200 transition">上一步</button>
            <button id="guide-diagram-next" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition" style="background:linear-gradient(135deg,#6366F1 0%,#8B5CF6 100%);">下一步</button>
          </div>
          <button id="guide-diagram-skip" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
      `;

      document.body.appendChild(modal);
      diagramModal = modal;

      modal.querySelector('#guide-diagram-next').onclick = () => { this.hideDiagram(); this.next(); };
      modal.querySelector('#guide-diagram-prev').onclick = () => { this.hideDiagram(); this.prev(); };
      modal.querySelector('#guide-diagram-skip').onclick = () => { this.skip(); };
      modal.onclick = (e) => { if (e.target === modal) this.skip(); };

      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); this.skip(); }
        if (e.key === 'ArrowRight' || e.key === 'Enter') { document.removeEventListener('keydown', onKey); this.hideDiagram(); this.next(); }
        if (e.key === 'ArrowLeft') { document.removeEventListener('keydown', onKey); this.hideDiagram(); this.prev(); }
      };
      document.addEventListener('keydown', onKey);
    },

    /**
     * 结束卡（步骤 8）
     */
    showEndCard() {
      this.hideDiagram();
      const modal = document.createElement('div');
      modal.id = 'guide-end-modal';
      modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
      modal.style.cssText = 'background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);';

      modal.innerHTML = `
        <div class="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 text-center relative" style="box-shadow:0 20px 60px rgba(0,0,0,0.15);">
          <div class="text-xs text-gray-400 mb-3">${progressLabel(currentStep)}</div>
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
      if (document.getElementById('guide-help-btn')) return;

      const selectors = [
        'nav .hidden.md\\:flex.items-center',
        'nav .flex.items-center.gap-4',
        'nav .flex.items-center.gap-3',
        'nav > div:last-child',
        '#navbar .flex.items-center',
        'div.flex.items-center.gap-3',
      ];
      let container = null;
      for (const sel of selectors) {
        container = document.querySelector(sel);
        if (container) {
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

      const membershipLink = Array.from(container.querySelectorAll('a')).find(a => a.href && a.href.includes('membership'));
      if (membershipLink) {
        container.insertBefore(btn, membershipLink);
      } else {
        container.appendChild(btn);
      }
    },
  };

  window.Guide = Guide;
})();
