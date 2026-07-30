<div align="center">

<img src="./LOGO.png" alt="Spoor" width="120" />

# Spoor

**A local-first spatial notes canvas with AI personas and a research lab.**

Place notes, screenshots, documents, research findings, and AI responses on one infinite canvas. Then use different AI personas to question, connect, rewrite, and research your ideas.

</div>

---

## 说明

Spoor 是一个带 AI 的无限便签画布。你可以把想法、资料、截图、网页搜索结果都放在画布上，再让不同性格的 AI 助手帮你提问、联想、改写和做研究。

它和普通聊天机器人的区别是：AI 的回答不会只停留在聊天记录里，而是会变成画布上的新便签，可以继续移动、连接、编辑和追问。

### 能做什么

- **无限画布便签** — 拖拽、缩放、连线，把想法铺在空间里，而不是塞进文件夹。
- **多个人格 Agent** — 真知镜负责反问，编织者负责联想，熨烫师负责文字实验，占星术负责情景推演。
- **上下文 AI 便签** — 选中便签后让 AI 分析，结果会作为新便签留在画布上。
- **Research Lab** — 把研究问题拆成计划，收集资料，生成报告，再沉淀回画布。
- **长文综合** — 把多张便签整理成文章草稿、项目说明或研究总结。
- **本地优先** — 画布数据保存在本机 IndexedDB，API Key 保存在本地设置中。
- **Windows 桌面应用** — 通过 Tauri 打包，本地文件存储与直连模型服务都依赖桌面端能力。

### 一个例子

如果你想写一篇关于“AI 如何改变独立创作者”的文章，可以先把零散想法放成便签：AI 写作、个人品牌、平台依赖、真实经验。然后让真知镜找逻辑漏洞，让编织者找隐藏联系，让熨烫师改写关键句，最后把这些便签合成为文章草稿。

### 快速开始

| 方式 | 适合谁 | 怎么做 |
|------|--------|--------|
| **Windows 桌面** | 所有使用者 | 从 **[Releases](https://github.com/iimorning/spoor/releases/latest)** 下载 `Spoor_*_x64-setup.exe` 并安装 |
| **本地开发** | 贡献者 / 二次开发 | `npm install` → `npm run tauri:dev` |

> 网页版已停止维护。浏览器打开构建产物只会看到桌面版引导页；`npm run dev` 仍可用于开发调试。

首次使用：打开应用，进入 **设置 → 模型服务**，添加一个服务商并填入 API Key。密钥只保存在本机。

