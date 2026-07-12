# AI面镜 项目规则

- 产品：AI 模拟面试网站「AI面镜」。纯静态多页面：原生 HTML/CSS/JS，无框架、无构建工具，每个页面可独立打开，最终部署到 GitHub Pages。
- 样式：Tailwind CSS 走 CDN（`https://cdn.tailwindcss.com`）+ 每页内联 tailwind.config 扩展主题；其他第三方库（supabase-js、chart.js、pdf.js）也一律 CDN 引入。
- 设计规范：浅色暖调科技风。内页背景 #F9FAFB、正文 #111827；主色 indigo #6366F1，品牌渐变 linear-gradient(135deg,#6366F1 0%,#8B5CF6 100%)；成功绿 #10B981、警示橙 #F59E0B；字体 Inter, PingFang SC, Microsoft YaHei；卡片 rounded-2xl + 阴影 0 4px 20px rgba(99,102,241,0.08)；按钮/输入框 rounded-xl；主按钮用品牌渐变，hover 上浮 2px 加发光阴影；logo 是渐变圆角方块内放 🪞 emoji + 「AI面镜」。
- 后端只用 Supabase（Auth / Postgres / Edge Functions）。所有 AI 能力必须经 window.AIProxy（ai-client.js）调用统一代理，前端代码严禁出现任何模型 API Key。
- 页面间状态用 localStorage 传递，键名必须与需求里给定的完全一致，不得自行改名。
- 所有界面文案用中文；关键逻辑写中文注释（解释"为什么"）；所有失败场景要有中文友好提示和兜底，不允许白屏或流程卡死。
- 回答一律使用中文。
