# Spoor 升级实施文档 v1.0（定稿）

> **状态：v0.2.0 与 v0.3.0 全部 32 步已实现完毕**（S0–S31）。
> 下列内容保留为设计与决策依据；实现过程中有三处刻意偏离，均在对应提交信息里写明理由：
> 1. §4.2 计划新增 `MetaLabel` 组件（39 处调用点），实际改为语言级 CSS 修正——覆盖面更全、diff 风险更低。
> 2. §7.6 计划把 v1 `AIConfig` 直接丢弃重建，实际做了迁移——开发机上存着配好的 v1，丢弃等于让人重填 Key。
> 3. §13 S31 计划删掉 `vite.config.ts` 的 dev 代理，实际保留并加注释——`npm run dev` 仍是浏览器调 UI 的手段，那里没有 Tauri 后端可绕 CORS；代理只存在于开发服务器配置，不进构建产物。
>
> 仍未完成的只有**真机手测**：安装后需人工验证右键落点、中键平移、原生拖放落点、卸载弹窗、四家生图各出图一次。


> 状态：**已确认，可执行**
> 执行者：Claude Code
> 覆盖两个版本：**v0.2.0**（画布交互与本地化）+ **v0.3.0**（存储与生图）
> 历史评审：v0.2 → v0.3 → v0.4 共 17 条决策，全部并入本文

## 已确认的全部决策

| # | 决策 |
|---|------|
| 1 | 生图适配 **火山方舟 / OpenAI / Nano Banana(Gemini) / 自定义地址** 四种 |
| 2 | **网页版废弃**，只做桌面版；网络请求统一走 Rust |
| 3 | 生图配置**与对话配置合并**（同一 Key + Base URL 下挂对话模型与生图模型） |
| 4 | **所有上传文件走文件存储**，DB 只存相对路径 |
| 5 | 生图节点输出**可作为下游生图节点的参考图** |
| 6 | 装饰文案**改中文**；画布按钮**悬停必须有提示** |
| 7 | 右键菜单**覆盖多选**：批量删除 / 批量连线 / 合成长文 |
| 8 | **移除内置 API Key**，保留用户自定义生图地址 + Key |
| 9 | 卸载时**自定义弹窗**询问是否保留数据，明确提示会删除既往生图 |
| 10 | Tooltip **一次做全** |
| 11 | 生图历史**永久保留**，用户自行删除/导出/管理 |
| 12 | 批量连线**只做"全部连到一个"** |
| 13 | txt/md/docx：**原件归档到文件 + 正文仍入 DB** |
| 14 | 文件导入与拖放**改用 Tauri 原生路径** |
| 15 | **无存量用户** → 不做升级提示，迁移逻辑最小化 |
| 16 | **拆两个版本**发布 |
| 17 | 生成图**不压缩**，按云端原始字节落盘 |

---

## ⚠️ 0. 前置：本项目当前没有版本控制

`d:\VSProjects\spoor-master` 下**不存在 `.git` 目录**（`git rev-parse` 报 not a git repository）。根目录的 `git-log.txt` 只是一份从旧仓库导出的文本，不是仓库本身。

本次要改动 40+ 文件、重写拖放与文件层、重构 AI 配置结构。**没有回滚点的情况下不应开工**。

**开工前第一步**：

```bash
git init
git add -A
git commit -m "chore: baseline before v0.2 upgrade"
git checkout -b feat/v0.2-canvas-upgrade
```

现有 [.gitignore](../.gitignore) 需先确认已排除 `node_modules/`、`src-tauri/target/`、`dist/`（后两者体积巨大）。此后**每个实施步骤单独提交**，便于逐步回退。

---

## 1. 现状盘点（基于当前代码核对，非推测）

| 项目 | 现状 | 位置 |
|------|------|------|
| 版本控制 | **无 `.git`** | 根目录 |
| 节点类型 | `theme` `note` `text` `ai` `image` `video` `document` `agent` | [NodeRenderer.tsx](../src/components/nodes/NodeRenderer.tsx) |
| 新建节点入口 | 仅底部工具栏 `+` / `Bot` / 上传按钮，外加拖放 | [CanvasToolbar.tsx:78-135](../src/components/CanvasToolbar.tsx#L78-L135) |
| 右键菜单 | **不存在**，全局无 `onContextMenu` | — |
| 新节点落点 | 一律视口中心 + 随机抖动 | [utils/canvas.ts](../src/utils/canvas.ts) |
| 媒体存储 | 图片/视频**一律 base64 存 IndexedDB**；docx 转 HTML 存 DB；txt/md 存纯文本 | [utils/file.ts](../src/utils/file.ts) |
| AI 配置 | 单个扁平对象，`localStorage['ai_config']`，仅文本对话 | [AISettingsModal.tsx:19-29](../src/components/AISettingsModal.tsx#L19-L29) |
| 生图能力 | **无** | — |
| 内置 Key | `VITE_BUILTIN_DOUBAO_API_KEY` / `VITE_BUILTIN_MIMO_API_KEY` / `process.env.GEMINI_API_KEY` 三套 | [doubao.ts](../src/constants/doubao.ts) [mimo.ts](../src/constants/mimo.ts) [vite.config.ts:28](../vite.config.ts#L28) |
| 豆包默认模型 | `ep-20260218175314-xrnrn` —— **账号专属推理接入点 ID** | [doubao.ts:8](../src/constants/doubao.ts#L8) |
| Tauri 安装模式 | `installMode` 未指定 → 默认 `currentUser`，装到 `%LOCALAPPDATA%\Spoor`（可写） | [tauri.conf.json](../src-tauri/tauri.conf.json) |
| Tauri 资源协议 | `assetProtocol` 未启用；`csp: null` | 同上 |
| Tauri 拖放 | `dragDropEnabled: false` → 走 HTML5 drop（拿 `File` 对象，非路径） | 同上 |
| Tauri 权限 | capability 仅 `core:*`，**无 fs / dialog** | [capabilities/default.json](../src-tauri/capabilities/default.json) |
| Rust 依赖 | `reqwest`(rustls) `serde_json` `tokio` `futures-util` `open`，**无任何 Tauri 插件** | [Cargo.toml](../src-tauri/Cargo.toml) |
| Tauri 命令 | 6 个（chat / chat_stream / metaso / open_url / llama / llama_log） | [lib.rs](../src-tauri/src/lib.rs) |
| Tooltip 覆盖 | 81 个可交互元素中 **50 个缺 `title`/`aria-label`** | [scripts/audit-tooltips.mjs](../scripts/audit-tooltips.mjs) |
| 测试 | `vitest` 已配置，现有 1 个测试文件（`llmJson.test.ts`） | [vitest.config.ts](../vitest.config.ts) |

**设计语言基线**（新 UI 严格沿用）
底色 `#FAF9F6`（纸纹）· 卡片白底 · 边框 `#E6E4DF` · 次级文字 `#8c8a84`/`#5a5a54` · 正文 `#1a1a1a` · 强调 `#C2410C`（hover `#a0350a`/`#9A3412`）· 圆角 `rounded-lg`/`xl`/`2xl` · 阴影 `shadow-md`/`xl` · 图标 `lucide-react`（菜单 `w-3.5`，工具栏 `w-4`）· 字体：标题 `font-serif`、UI `font-sans`、标签 `font-mono text-[10px]`

---

# 第一部分：v0.2.0 — 画布交互与本地化

> 不触碰存储层与生图，风险低，可独立发布。

## 2. 画布右键菜单

### 2.1 四类上下文

| 右键目标 | 菜单内容 |
|---------|---------|
| **空白处** | 新建便签<sup>②</sup> / 新建主题卡 / 新建 AI 生图节点<sup>①</sup> ／—／ 插入图片… / 插入视频… / 插入文档… ／—／ 添加助手 ▸（二级，列出全部人设）／—／ 粘贴便签（剪贴板有内容时）/ 重置视图 |
| **节点上（未多选）** | 编辑内容 / 创建副本 / 开始连线 / 以此节点生成图片<sup>①</sup> / 切换版式（仅 `theme` `note` `text`）/ 选中 ／—／ 删除节点 |
| **节点上（已多选 ≥2）** | **全部连到此节点**（{{n-1}} 条）/ **合成长文**（{{n}} 张）/ 全部取消选中 ／—／ **批量删除**（{{n}} 张） |
| **连线上** | 删除连线 |

<sup>①</sup> 生图相关项在 v0.2.0 中**先不出现**（无对应节点类型），v0.3.0 再加入 `canvasMenuItems.ts`。

<sup>②</sup> 实施时发现：`node.type` 的 `'note'` 与 `'text'` 在 `NodeRenderer`、`nodeCapabilities`、剪贴板逻辑中**完全同构**，`'note'` 只存在于早期种子数据，工具栏「新建便签」实际建的是 `'text'`。因此原计划的「新建文本」与「新建便签」会是同一件事，已合并为一项。该映射记录在 `CanvasCreateItemDef.nodeType` 上。

**批量连线（决策 12）**：只做星型 —— **右键点击的那个节点即中心**，其余选中节点全部连向它。已存在的边跳过，不重复创建。

### 2.2 交互规则

- 落点：新建节点出现在**右键点击的画布坐标**（`screenToCanvasPosition`），不再是视口中心
- 关闭：`Esc` / 左键点击任意处 / 滚轮缩放平移 / 窗口失焦
- 边界：贴近视口右下边缘时自动翻转（flip），不出现滚动条
- 二级菜单：hover 展开向右弹出，空间不足向左
- 阻止原生菜单：**仅**画布区域 `preventDefault()`；`input`/`textarea`/`contentEditable` 内保留原生菜单。复用 [noteClipboard.ts](../src/utils/noteClipboard.ts) 的 `isTextEditingTarget`
- 多选判定：右键目标 ∈ `selectedNodes` 且 `size >= 2` → 多选菜单；否则单节点菜单（不清空已有选中）

### 2.3 视觉规格

```
┌──────────────────────────────┐  bg-white  border border-[#E6E4DF]
│  ＋  新建便签                 │  rounded-xl  shadow-xl  p-1
│  ✦  新建主题卡                │  min-w-[200px]
│  T  新建文本                  │
├──────────────────────────────┤  项: px-3 py-2 text-sm rounded-lg
│  🖼  插入图片…                │       hover:bg-[#F4F1ED]
│  🎬  插入视频…                │  图标: w-3.5 h-3.5 text-[#5a5a54]
│  📄  插入文档…                │  强调项图标: text-[#C2410C]
├──────────────────────────────┤  分隔: h-px bg-[#F4F1ED] my-1
│  🤖  添加助手              ▸ │  禁用: opacity-40 pointer-events-none
└──────────────────────────────┘  危险项: text-red-700 hover:bg-red-50
```

与现有工具栏 `+` 悬浮菜单（[CanvasToolbar.tsx:88-105](../src/components/CanvasToolbar.tsx#L88-L105)）完全同款。

### 2.4 ⚠️ 必须先修的现存隐患

[DraggableNode.tsx:93](../src/components/canvas/DraggableNode.tsx#L93) 的 `onPointerDown` **不判断鼠标键**，当前右键按住即可拖动节点：

```ts
onPointerDown={(e) => {
  if (e.button !== 0) return;   // ← 新增：仅左键触发拖拽/连线
  ...
}}
```

[useCanvasInteraction.ts:104](../src/hooks/useCanvasInteraction.ts#L104) 的 `handlePanStart` 条件已排除右键 ✓。

### 2.5 文件改动

**新增**
| 文件 | 职责 |
|------|------|
| `src/components/canvas/CanvasContextMenu.tsx` | 展示组件：菜单项数组 + 屏幕坐标 → 渲染、翻转、键盘导航、二级菜单 |
| `src/hooks/useCanvasContextMenu.ts` | 状态机 `{ open, screenX, screenY, canvasX, canvasY, target }`，`target = {kind:'canvas'} \| {kind:'node',nodeId} \| {kind:'nodes',nodeIds,anchorId} \| {kind:'edge',edgeId}` |
| `src/constants/canvasMenuItems.ts` | **单一数据源**：菜单项 id / i18nKey / 图标 / handler 名，工具栏 `+` 与右键菜单共用 |

**修改**
| 文件 | 改动 |
|------|------|
| `src/utils/canvas.ts` | `+screenToCanvasPosition(clientX, clientY, mainRect, transform)` |
| `src/hooks/useNodeActions.ts` | 三个 `addXxx` 加可选 `at?: {x,y}`；`+addNodeAt` `+duplicateNode` `+deleteNodes(ids)` `+linkNodesToHub(ids, hubId)` |
| `src/App.tsx` | `<main>` 挂 `onContextMenu`；渲染 `<CanvasContextMenu>`；透传 `handlePublish` 与 `selectedNodes` |
| `src/components/canvas/DraggableNode.tsx` | `+onContextMenu` 透传；修复 §2.4 隐患 |
| `src/components/canvas/CanvasEdgeLines.tsx` | 连线命中区加 `onContextMenu` |
| `src/components/CanvasToolbar.tsx` | `+` 菜单改读 `canvasMenuItems.ts` |

## 3. 桌面版化 + 内置 Key 移除

### 3.1 启动守卫

`main.tsx` 检测非 Tauri 环境 → 渲染全屏引导页（Logo + "Spoor 现已是桌面应用" + 下载按钮，复用 `DESKTOP_RELEASE_URL`），不挂载 `<App/>`。
**例外**：`import.meta.env.DEV` 放行，保证 `npm run dev` 浏览器调试可用。

> ⚠️ `npm run tauri:dev` 依赖 `beforeDevCommand: npm run dev`，**Vite 不能删**。

### 3.2 内置 Key 移除清单

| 文件 | 处理 |
|------|------|
| [constants/doubao.ts](../src/constants/doubao.ts) | 删 `getBuiltinDoubaoApiKey` `hasBuiltinDoubaoApiKey` `resolveDoubaoApiKey` `formatDoubaoKeyMissingError`；**`DOUBAO_DEFAULT_MODEL` 置空** |
| [constants/mimo.ts](../src/constants/mimo.ts) | 删 `getBuiltinMimoApiKey` `hasBuiltinMimoApiKey` `resolveMimoApiKey` `BUILTIN_MIMO_API_EXPIRES_AT` |
| [services/ai.ts](../src/services/ai.ts) | 删上述调用；删 `process.env.GEMINI_API_KEY` 回退（437 行）；无 Key 一律抛 `no_api_key` |
| [vite.config.ts](../vite.config.ts) | 删 `define: {'process.env.GEMINI_API_KEY'}` 与构建期 `hostedDoubaoKey` 警告 |
| [App.tsx:51-85](../src/App.tsx#L51) | `migrateStoredAiConfig` 中"空 Key 自动切豆包"逻辑删除 |
| [AISettingsModal.tsx](../src/components/AISettingsModal.tsx) | 删 `hostedMimo` / `hostedDoubao` 分支 |
| `src/i18n.ts` | 删 `settings.builtin_mimo_expiry` `builtin_mimo_hint` `builtin_doubao_hint` `api_key_optional_mimo` `api_key_optional_doubao` |
| `scripts/setup-builtin-{mimo,doubao}.mjs`、`setup-builtin-mimo.ps1` | 删除；`package.json` 移除 `setup:mimo-key` `setup:doubao-key` |
| `.env.example` | 删三条 `VITE_BUILTIN_*` / `GEMINI_API_KEY` |
| `docs/BUILTIN_MIMO.md`、`docs/BUILTIN_DOUBAO.md` | 删除 |

> ⚠️ **`DOUBAO_DEFAULT_MODEL = 'ep-20260218175314-xrnrn'` 是账号专属推理接入点 ID**，对其他用户无效。置空后需在设置里给出说明：「火山方舟需填写控制台『推理接入点』的 ep- 开头 ID，而非模型名」。

### 3.3 首启引导

内置 Key 是唯一的"零配置可用"路径，移除后必须补引导。首次启动且 `providers` 为空 → 画布中央显示引导卡（沿用主题卡样式）：「先去设置里添加一个模型服务 →」，点击直达设置的「模型服务」Tab。

## 4. 汉化补全

### 4.1 硬编码清单（逐文件扫描确认）

| # | 位置 | 现状 | 处理 |
|---|------|------|------|
| 1 | [CanvasToolbar.tsx:132](../src/components/CanvasToolbar.tsx#L132) | `title="Upload File"` | → `t('canvas.upload_file')` |
| 2 | [ImageNode.tsx:11](../src/components/nodes/ImageNode.tsx#L11) | `alt="Atmospheric Library"` | → `t('nodes.image_alt')` |
| 3 | [Sidebar.tsx:75](../src/components/Sidebar.tsx#L75) | `alt="Curator Profile"` | → `t('sidebar.avatar_alt')` |
| 4 | [DocumentNode.tsx:15](../src/components/nodes/DocumentNode.tsx#L15) | 字面量 `DOCUMENT` | →「文档」 |
| 5 | [DocumentNode.tsx:26](../src/components/nodes/DocumentNode.tsx#L26) | `'<em>(空文档)</em>'` | → `t('nodes.empty_document')` |
| 6 | [utils/file.ts:51](../src/utils/file.ts#L51) | `'<p>(空文档)</p>'` | → `i18n.t('nodes.empty_document')` |
| 7 | [ThemeNode.tsx:54](../src/components/nodes/ThemeNode.tsx#L54) | `'LATENT_SPACE'` / `'Spatial Encoding'` | →「潜空间」/「空间编码」（排版见 4.2） |
| 8 | [ThemeNode.tsx:57](../src/components/nodes/ThemeNode.tsx#L57) | `'Central research objective…'` | → `t('nodes.theme_default_desc')` |
| 9 | [AgentsStudio.tsx:106](../src/components/AgentsStudio.tsx#L106) | `role: 'Assistant'` | → `t('agents.default_role')` |
| 10 | [AgentsStudio.tsx:261](../src/components/AgentsStudio.tsx#L261) | `` `Error: ${msg}（详见 Console…）` `` | → `t('agents.sandbox_error', { msg })` |
| 11 | [AgentsStudio.tsx:434](../src/components/AgentsStudio.tsx#L434) | `placeholder="You are a specialized agent…"` | → `t('agents.prompt_placeholder')` |
| 12 | [Reference.tsx:152,156](../src/components/Reference.tsx#L152) | `'Saving...'` / `'Saved'` | → `t('reference.note_saving')` / `note_saved` |
| 13 | [ResearchLab.tsx:37-39](../src/components/ResearchLab.tsx#L37-L39) | `RESEARCH_PLAN_FALLBACK` 三条全英文 | → `i18n.t('lab.plan_fallback.*')` |
| 14 | [ResearchLab.tsx:120-130](../src/components/ResearchLab.tsx#L120-L130) | 英文 fallback 报告 | → 收进 i18n |
| 15 | [AISettingsModal.tsx:160](../src/components/AISettingsModal.tsx#L160) | `<option>Custom Endpoint</option>` | → `t('settings.provider_custom')`（品牌名保留） |
| 16 | [useSeedData.ts:29,62-77](../src/hooks/useSeedData.ts#L29) | 首启种子数据全英文 | → 按语言走 `t('seed.*')` |
| 17 | [services/ai.ts](../src/services/ai.ts) | 错误文案中英混杂（149/292 中文；183/314/438/478/564/575/581 英文） | → 抛 `AiError{code}`，UI 层 `t('errors.ai.*')` |
| 18 | [services/search.ts:55,99](../src/services/search.ts#L55) | 英文错误 | 同上 |
| 19 | [utils/file.ts:76](../src/utils/file.ts#L76) | `Unsupported file type: …` | → `t('errors.file.unsupported', { name })` |
| 20 | [constants/doubao.ts:36-46](../src/constants/doubao.ts#L36) | `formatDoubaoKeyMissingError` | 随内置 Key 一并删除 |
| 21 | [main.tsx:12](../src/main.tsx#L12) | `document.title = 'Spoor'` | 保留（产品名） |
| 22 | [AISettingsModal.tsx:274](../src/components/AISettingsModal.tsx#L274) | `placeholder="sk-metaso-..."` | 保留（密钥格式示例） |

### 4.2 ⚠️ 装饰字改中文的排版副作用

这些标签当前是 `font-mono text-[10px] uppercase tracking-wider`，专为英文小型大写设计。**直接换中文会很难看**：`uppercase` 对中文无效；`tracking-wider` 会把两个字**拉散**；`font-mono` 渲染中文回退到系统字体，字重不一致。

**必须同步调整**：中文标签改 `font-sans text-[10px] tracking-normal font-bold text-[#8c8a84]`，移除 `uppercase`。抽 `<MetaLabel>` 组件统一承载，避免 20 多处类名各自演化。

保留原文的例外：`REF-042`（编号）、`Aa`（字体预览）、品牌名。

### 4.3 新增 i18n 命名空间

`canvas.menu.*` · `settings.providers.*` · `errors.ai.*` / `errors.file.*` · `seed.*` · `onboarding.*` · `tooltip.*`
（`imagegen.*` `media.*` `settings.storage.*` 留到 v0.3.0）

### 4.4 防退化机制

1. **key 一致性校验**：新增 `scripts/check-i18n.mjs`，对比 en/zh 完整 key 集合，缺失即非零退出，挂进 `npm run lint`
2. **裸字符串扫描**：同脚本扫 `title=` `placeholder=` `alt=` `aria-label=` 的英文字面量与 JSX 裸串，白名单显式登记
3. **服务层零文案原则**：`src/services/**` 与 Rust 侧不出现人读文案，只抛错误码。写进 `AGENT.md`
4. **i18n 拆分**：`src/i18n.ts` 已 665 行，先拆为 `src/i18n/en.ts` + `zh.ts`（纯搬运，零行为变更），再往里加新命名空间

## 5. Tooltip 全量补齐

### 5.1 组件方案

新建 `src/components/ui/Tooltip.tsx`：
- 触发：`onPointerEnter` 后 **400ms** 延迟显示；`onPointerLeave`/`onPointerDown` 立即隐藏
- 样式：`bg-white border border-[#E6E4DF] shadow-lg rounded-md px-2 py-1 text-[11px] text-[#1a1a1a] font-sans`，带小箭头
- 定位：默认上方，空间不足自动翻转；`position: fixed` 渲染到 body（避免被画布 transform 缩放）
- 无障碍：同时输出 `aria-label`
- **迁移现有 31 处 `title=`**，避免两种提示样式混搭

### 5.2 覆盖清单（实测：81 个元素，50 个缺失）

| 文件 | 缺失 | 行号 | 处理 |
|------|------|------|------|
| `AISettingsModal.tsx` | 12 | 79,81,87,111,126,165,190,198,211,246,270,294 | `<label>` 表单标签**豁免**，按钮补齐 |
| `ResearchLab.tsx` | 8 | 521,556,663,768,781,887,973,981 | 补齐 |
| `AgentsStudio.tsx` | 7 | 389,396,416,419,457,499,621 | 补齐 |
| `CanvasToolbar.tsx` | 6 | 89,97,115,146,158,163 | 补齐 |
| `Reference.tsx` | 6 | 345,359,378,423,450,583 | 补齐 |
| `IntentClarificationModal.tsx` | 4 | 108,140,170,178 | 补齐 |
| `AppDialogProvider.tsx` | 3 | 124,136,145 | 按钮有可见文字，**豁免** |
| `CanvasHistoryPopover.tsx` | 2 | 75,105 | 补齐 |
| `canvas/CanvasEdgeLines.tsx` | 1 | 55 | 补齐 |
| `Sidebar.tsx` | 1 | 126 | 补齐 |

**豁免规则**（写进审计脚本白名单）：表单 `<label for>`、按钮内已有完整可见中文文案且无歧义者。预计实际补齐约 **40 处**。
新增的右键菜单所有按钮**从一开始就带 Tooltip**。

---

# 第二部分：v0.3.0 — 存储与生图

## 6. 架构总览

```
前端                          Rust (Tauri)                      云端
────────────────────────────────────────────────────────────────────
ImageGenNode
  └ generateImages(req) ──IPC──►  image_generate(kind, cfg, req)
                                    ├─ 组装请求体（4 种适配器）
                                    ├─ reqwest POST ─────────────►  火山方舟/OpenAI/Gemini/自定义
                                    ├─ 解析响应（url / b64 / inlineData）
                                    ├─ url 型：再 GET 下载原始字节
                                    ├─ 写入 <数据根>/media/generated/…
                                    └─ 返回 相对路径[] ◄──────
  ◄──── ['media/generated/2026/07/ab12.png', …]
  └ db.nodes.update({ imageGenResults: [...] })
  └ <img src="http://spoor-media.localhost/media/generated/2026/07/ab12.png">
                                  ▲
                                  └ 自定义 URI 协议，流式读本地文件（支持 Range）
```

**核心决策：生图与文件导入全链路在 Rust 内闭环**，前端只拿相对路径。收益：大二进制不穿过 IPC · 不受 CORS 约束 · 原始字节零损耗落盘 · 错误处理集中一处。

## 7. 本地文件存储层

### 7.1 目录结构

```
<Spoor.exe 所在目录>/            默认 %LOCALAPPDATA%\Spoor\
├── Spoor.exe
└── SpoorData/                   ← 数据根
    ├── .spoor-data-root         标记文件（可写性探测 + 卸载识别）
    └── media/
        ├── generated/2026/07/<uuid>.png   生图结果
        ├── uploaded/2026/07/<uuid>.jpg    上传的图片/视频/音频
        └── documents/2026/07/<uuid>.docx  上传的文档原件
```

- **根目录解析**：`std::env::current_exe()` 父目录 + `SpoorData/`
- **可写性探测**：启动时试写 `.spoor-data-root`；失败（用户改用 perMachine 装进 `Program Files`）自动**回退**到 `app_local_data_dir()`，设置里显示实际路径
- **DB 只存相对路径**（`media/generated/2026/07/ab12cd34.png`），**绝不存绝对路径**

### 7.2 卸载数据保护

自定义 NSIS 卸载钩子（`bundle.windows.nsis.installerHooks`），删除文件前弹窗：

```
┌────────────────────────────────────────────┐
│  卸载 Spoor                                 │
├────────────────────────────────────────────┤
│  是否保留您的本地数据？                       │
│                                             │
│  数据目录：                                  │
│    %LOCALAPPDATA%\Spoor\SpoorData           │
│                                             │
│  ⚠ 选择「全部删除」将永久移除所有 AI 生成的   │
│    图片、上传的图片/视频/文档，且无法恢复。   │
│    画布笔记数据不在此目录内，不受影响。       │
│                                             │
│           [ 保留数据 ]    [ 全部删除 ]        │
└────────────────────────────────────────────┘
```

配套：`tauri.conf.json` 显式写死 `"installMode": "currentUser"`。

> 画布笔记在 IndexedDB（WebView2 用户数据目录），不在 `SpoorData` 内，弹窗文案已注明以免误导。

### 7.3 画布内显示：自定义 URI 协议

`assetProtocol` 需要静态 scope，而数据根运行时解析，对不上。改用自定义协议：

```rust
.register_asynchronous_uri_scheme_protocol("spoor-media", move |_app, request, responder| {
    // path = "/media/generated/2026/07/ab12.png"
    // 1) URL decode  2) 拒绝 `..`、绝对路径、盘符
    // 3) join 数据根  4) canonicalize 后校验仍在数据根内
    // 5) 解析 Range 头 → 206 Partial Content（视频必需）
    // 6) 流式读文件 → responder.respond(Content-Type / Content-Length / Accept-Ranges)
})
```

前端纯函数（不用 `convertFileSrc`，那是 asset 协议专用）：

```ts
// src/utils/mediaUrl.ts
export function mediaUrl(relPath: string): string {
  const p = relPath.split('/').map(encodeURIComponent).join('/');
  return `http://spoor-media.localhost/${p}`;   // Windows WebView2 形式
}
```

- **视频必须支持 Range 请求**，否则 `<video>` 进度条拖不动
- CSP 当前 `null` 不限制。将来启用需把 `http://spoor-media.localhost` 加入 `img-src` / `media-src`
- **路径穿越防护必需**，单测覆盖 `..`、URL 编码绕过、符号链接

### 7.4 文件导入：走原生路径（决策 14）

| 入口 | 方案 |
|------|------|
| 菜单/工具栏「插入图片…」 | 引入 **`tauri-plugin-dialog`**，`open()` 返回**绝对路径** → `media_import(srcPath)` Rust 直接 `fs::copy`，**零 IPC 传输** |
| 拖放文件到画布 | `dragDropEnabled: true` + Tauri `onDragDropEvent` 拿**原生路径** |
| 剪贴板粘贴图片 | 仍走字节流（剪贴板本就无路径），`media_import_bytes` |

**拖放改造要退役的代码**：[App.tsx:239-270](../src/App.tsx#L239) 捕获阶段放行逻辑、[App.tsx:394-432](../src/App.tsx#L394) 的 `onDrop`、[utils/dnd.ts](../src/utils/dnd.ts)、`DEBUG_DND` 调试开关。这些是为 HTML5 drop 踩坑修的，切原生事件后不再需要——但**拖放位置换算仍要保留**（`onDragDropEvent` 提供 `position`，需转画布坐标）。

### 7.5 各文件类型落地策略（决策 13）

| 类型 | 文件存储 | DB 存什么 |
|------|---------|----------|
| 图片 / 视频 / 音频 | ✅ 原件 | `filePath` |
| `.docx` | ✅ 原件归档 | `filePath` + `content`（mammoth 转出的 HTML）。HTML > 256KB 时外置为 `contentPath` |
| `.txt` / `.md` | ✅ 原件归档 | `filePath` + `content`（纯文本） |
| 其他类型 | ✅ 原件 | `filePath` + `fileType`，落为新的通用 `file` 节点（文件名 + 图标 + 打开/定位） |

### 7.6 存量数据处理（决策 15：无用户，最小化）

无存量用户，但**开发过程中本机会有测试数据**。因此：
- **保留渲染兜底**：`filePath` > `content`(data URL)，成本极低，旧数据永远能显示
- **静默 best-effort 迁移**：启动时扫描 `content` 以 `data:` 开头的行，逐条转文件。**不做**备份 / 进度条 / 断点续跑 / 失败重试
- `AIConfig` v1 旧结构：**直接丢弃重建**为空 `providers`，不做迁移

### 7.7 Rust 命令清单

| 命令 | 签名 | 用途 |
|------|------|------|
| `media_store_info` | `() -> { root, bytes, count }` | 设置显示路径与占用 |
| `media_list` | `(kind?) -> [{ rel, bytes, mtime, ext }]` | 资产管理器列表 |
| `media_import` | `(srcPath, category) -> { rel, bytes, ext }` | 从原生路径复制入库 |
| `media_import_bytes` | `(bytes, ext, category) -> { rel, … }` | 剪贴板/迁移用 |
| `media_export` | `(rel, destPath) -> ()` | 另存为 |
| `media_delete` | `(rels) -> ()` | 删除 |
| `media_reveal` | `(rel) -> ()` | 在资源管理器中定位 |
| `media_gc` | `(referenced) -> { removed, bytes }` | 清理未引用文件 |
| `image_generate` | `(kind, provider, model, req) -> Vec<String>` | 生图全链路 |
| `image_generate_cancel` | `(taskId) -> ()` | 取消 |

**新增依赖**
Rust：`uuid` `mime_guess` `chrono` `tauri-plugin-dialog`
npm：`@tauri-apps/plugin-dialog`
capability：`dialog:allow-open`

### 7.8 图片资产管理器（决策 11）

历史永久保留 → 必须给管理入口。**设置 → 存储**：

```
┌───────────────────────────────────────────────┐
│  数据目录  %LOCALAPPDATA%\Spoor\SpoorData      │
│            [ 打开文件夹 ]                       │
│  占用      2.4 GB · 386 个文件                  │
├───────────────────────────────────────────────┤
│  [全部] [生成图] [上传] [未被引用]    ⌕ 搜索    │
├───────────────────────────────────────────────┤
│  ☐┌────┐ ☑┌────┐ ☐┌────┐ ☐┌────┐             │
│   │缩略│  │缩略│  │缩略│  │缩略│               │
│   └────┘  └────┘  └────┘  └────┘              │
│   2.1MB   1.8MB   未引用   3.4MB               │
├───────────────────────────────────────────────┤
│  已选 1 项   [ 导出 ] [ 定位 ] [ 删除 ]         │
└───────────────────────────────────────────────┘
```

- **「未被引用」筛选**替代自动 GC：不自动删任何东西，只标记出来让用户决定
- 删除前二次确认，提示"若该图仍在某生图节点历史里，节点会显示为缺失"
- **缺失文件兜底**：节点渲染显示占位图 +「文件已删除」，不报错不白屏

## 8. 节点数据模型

```ts
export interface CanvasNode {
  // …现有字段

  /** 媒体/文档：数据根内的相对路径。渲染优先级 filePath > content(data URL, 旧) */
  filePath?: string;
  /** 原始文件名，用于导出与显示 */
  fileName?: string;
  /** 超大文本正文外置（docx HTML > 256KB） */
  contentPath?: string;

  // ── type === 'imagegen' ──
  imageGenProviderId?: string;
  imageGenModelId?: string;
  imageGenPrompt?: string;
  imageGenIgnoreUpstreamText?: boolean;
  imageGenParams?: { size?: string; n?: number; seed?: number; quality?: string; negativePrompt?: string };
  /** 结果图相对路径，最新在前，**不设上限** */
  imageGenResults?: string[];
  imageGenActiveIndex?: number;
  imageGenExcludedRefIds?: string[];
  imageGenErrorCode?: string;
}
```

- `imageGenStatus` **不入库**，放内存 `Set<string>`，避免刷新后卡在"生成中"
- **Dexie `version(5)`**，schema 不变（新字段非索引）

## 9. 生图输入解析（连线语义，含链式）

新增 `src/utils/imageGenInputs.ts`，对齐现有 [canvasContextImages.ts](../src/utils/canvasContextImages.ts)：

| 规则 | 说明 |
|------|------|
| **边方向** | 现有 `Edge` 有 `from`/`to`，但 UI 连线无向（`handleLink` 不区分方向，Agent 分析亦无向）。生图**同样按无向邻接** |
| **参考图来源** | 邻接的 `image` 节点；**以及邻接的 `imagegen` 节点**（取 `imageGenResults[imageGenActiveIndex]`）← 决策 5 |
| **环安全** | 只取**直接邻居**不递归，A↔B 互连不死循环；UI 提示「存在循环引用，仅使用当前结果」 |
| **参考图上限** | `min(4, model.capabilities.maxRefImages)`；超出取前 N 并标注「已忽略 X 张」 |
| **文本来源** | 邻接的 `note` `text` `theme` `ai` `document` 节点，取 `content`（document 复用 [canvasNodeContextText.ts](../src/utils/canvasNodeContextText.ts)），按 node id 排序后 `\n\n` 拼接 |
| **合并策略** | `最终 prompt = 上游文本 + '\n' + imageGenPrompt`；`imageGenIgnoreUpstreamText` 为真时只用后者 |
| **空态** | 两者皆空 → 生成按钮禁用，显示 `t('imagegen.need_prompt')` |

## 10. 配置合并

### 10.1 新结构

```ts
export interface AIModelEntry { id: string; modelName: string; label: string }

export interface ImageModelEntry extends AIModelEntry {
  capabilities: { textToImage: boolean; imageToImage: boolean; maxRefImages: number };
  sizeOptions?: string[];
  defaultParams?: { size?: string; n?: number; quality?: string };
}

export type ProviderKind =
  | 'doubao' | 'openai' | 'gemini' | 'anthropic'
  | 'deepseek' | 'mimo' | 'custom' | 'local_llama';

export interface AIProviderProfile {
  id: string;
  name: string;              // '火山方舟'
  kind: ProviderKind;
  apiKey: string;            // 用户自填，无内置回退
  baseUrl: string;           // 用户可改（含自定义生图地址）
  chatModels: AIModelEntry[];
  imageModels: ImageModelEntry[];
  /** 生图协议：默认由 kind 推导，custom 时必填 */
  imageApiKind?: 'doubao_seedream' | 'openai_images' | 'gemini_image' | 'custom_openai_images' | 'rightapi_draw';
  localGgufPath?: string;
  localEnableThinking?: boolean;
}

export interface AIConfig {
  version: 2;
  providers: AIProviderProfile[];
  activeChat: { providerId: string; modelId: string };
  defaultImage?: { providerId: string; modelId: string };
  metasoApiKey?: string;
}
```

### 10.2 兼容垫片（控制爆炸半径）

`AIConfig` 被 `App.tsx` `ResearchLab` `AgentsStudio` `services/ai.ts` 广泛使用。**不改这些调用方**：
- `resolveActiveChatConfig(config)` 返回**旧扁平形状**喂给 `callUniversalAI`，对话链路零改动
- `resolveImageModel(config, providerId, modelId)` 供生图使用
- v1 旧配置直接丢弃重建（决策 15）

### 10.3 设置面板

```
┌───────────────────────────────────────────┐
│  ⚙  设置                               ✕ │
├───────────────────────────────────────────┤
│  [ 通用 ]   [ 模型服务 ]   [ 存储 ]        │
├───────────────────────────────────────────┤
│  ▾ 火山方舟                    [编辑][×]  │
│    Base URL  https://ark…/api/v3   ← 可改 │
│    API Key   ••••••••••          [测试]   │
│    ├ 对话模型                              │
│    │   · ep-2026…（推理接入点）[默认][×]  │
│    │   ＋ 添加对话模型                      │
│    └ 生图模型                              │
│        · Seedream 4.0       [默认] [×]    │
│        ＋ 添加生图模型                      │
│                                            │
│  ＋ 添加服务   预设：[火山方舟▾/自定义…]    │
└───────────────────────────────────────────┘
```

- `通用`= 语言 / Metaso Key / 关于；`模型服务`= Provider CRUD；`存储`= §7.8 资产管理器
- **预设模板**一键填充四种，用户只需补 Key
- **测试**：对话发 `ping`；生图发最小尺寸 `a red circle`，成功显示缩略图
- 火山方舟对话模型输入框需专门提示（推理接入点 ID）

## 11. 生图适配器

> 模型 ID 为**预设默认值**，均可在设置里修改；实现时对照各家最新文档核对。

| kind | 端点 / 协议 | 文生图请求 | 图生图（参考图） | 取图 |
|------|-----------|-----------|----------------|------|
| **`doubao_seedream`**<br>火山方舟 | `POST {base}/images/generations`<br>`base=https://ark.cn-beijing.volces.com/api/v3` | `{ model, prompt, size, response_format:'url', watermark:false }`<br>预设 `doubao-seedream-4-0-250828` | body 加 `image`：单张 URL/base64；Seedream 4.0 支持**数组**多参考图 | `data[].url` → Rust 二次 GET 下载原始字节落盘 |
| **`openai_images`**<br>OpenAI | `POST {base}/images/generations`<br>图生图 `POST {base}/images/edits` | `{ model:'gpt-image-1', prompt, size, n, quality }` | `/images/edits` **multipart**：`image[]` 多文件 + `prompt` + `model` | `data[].b64_json` → 解码落盘 |
| **`gemini_image`**<br>Nano Banana | `POST {base}/models/{model}:generateContent`<br>`base=https://generativelanguage.googleapis.com/v1beta` | `{ contents:[{parts:[{text}]}], generationConfig:{ responseModalities:['IMAGE'] } }`<br>预设 `gemini-2.5-flash-image` / `gemini-3-pro-image-preview` | 同一 `parts` 追加 `{ inlineData:{ mimeType, data } }` | `candidates[0].content.parts[].inlineData.data` → 解码落盘 |
| **`custom_openai_images`**<br>自定义 | `POST {用户填写的 base}/images/generations` | 同 `openai_images`，base URL / model / 鉴权前缀全由用户填 | 同 `openai_images` | 自动嗅探 `data[].b64_json` → `data[].url` → `images[]` |
| **`rightapi_draw`**<br>RightAPI（**异步**） | 提交 `POST {base}/images/generations`<br>`base=https://www.rightapi.ai/draw/v1`<br>轮询 `GET {base 去掉 /draw}/tasks/{task_id}` | `{ model, prompt, async:true, size, n, imageSize }`<br>`size` 是**宽高比**（`1:1`/`16:9`/`9:16`/`4:3`）不是像素；`imageSize` 取 `1K`/`2K`/`4K`，映射自配置里的 `quality`<br>预设 `nano-banana-fast` / `nano-banana` | body 加 `image`：data URL **数组**，不走 multipart | 提交只回 `task_id`；每 2s 轮询、5 分钟封顶，完成态按提交协议回 Images 形状（`data[].url`）或 Gemini 形状（`parts[].inlineData` 或 `parts[].text` 里的**纯 URL**） |

- Gemini 走 **REST 而非 `@google/genai` SDK**（请求在 Rust 侧发）。SDK 依赖保留给现有对话链路
- **鉴权头差异**：火山方舟/OpenAI 用 `Authorization: Bearer`；Gemini 用 `x-goog-api-key`；自定义可选（默认 Bearer）
- **错误归一**：Rust 抛 `{ code, httpStatus?, detail? }`，`code` ∈ `no_api_key` `network` `http_error` `bad_response` `no_image` `content_filtered` `aborted` `unsupported_i2i` `disk_write_failed` `quota_exceeded` `timeout`。前端 `t('imagegen.errors.'+code)`，`detail` 折叠显示
- **协议选择**：`custom` 服务商在设置里可切生图协议（`SELECTABLE_IMAGE_API_KINDS`），其余由 `ProviderKind` 唯一推导。切到 `rightapi_draw` 且 Base URL 还空着时自动填绘图基址——域名是 `rightapi.ai` 而不是 `right.ai`，后者是另一家的站点，`/draw/*` 上会直接断开 TLS 连接
- **并发**：`IMAGE_GEN_MAX_CONCURRENCY = 2`，超出排队。生图**不阻塞** `isAnyAiBusy`
- **取消**：Rust 侧 `CancellationToken` + `image_generate_cancel(taskId)`

## 12. 生图节点 UI

```
┌──────────────────────────────────────┐
│ ✧ AI 生图        [Seedream 4.0  ▾]  │ 模型下拉（跨服务扁平列出，按服务分组）
├──────────────────────────────────────┤
│         ┌────────────────┐           │ 预览区 flex-1，四态：
│         │                │           │  · 空态  虚线框 +「连接文本或图片后生成」
│         │   [ 结果图 ]    │           │  · 生成中 骨架 + Loader2 + 已用时 + [取消]
│         │                │           │  · 完成  object-contain
│         └────────────────┘           │  · 错误  AlertTriangle + 中文错误 + [详情▾] + [重试]
│         ‹ 3/17 ›   [🗑 删除此张]      │ 历史无上限，逐张可删
├──────────────────────────────────────┤
│ 参考图 [🖼][🖼]  来自 2 个连接节点     │ 缩略图 28×28，点击禁用（→ imageGenExcludedRefIds）
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ 提示词（已接入上游 1 段文本）      │ │ textarea 自动高度，上限 160px
│ └──────────────────────────────────┘ │
│ [1024×1024 ▾] [×1 ▾] [⚙]  [ 生成 ] │ 参数条 + 主按钮 #C2410C
└──────────────────────────────────────┘
```

**悬浮操作**（与现有节点同款圆形小按钮，**全部带 Tooltip**）：
另存为… · **输出为图片节点**（右侧建 `image` 节点 + 自动连线，复用同一 `filePath`，不复制文件）· 复制提示词 · 在文件夹中显示

**新增文件**
`components/nodes/ImageGenNode.tsx` · `imagegen/ImageGenModelPicker.tsx` · `imagegen/ImageGenParamsBar.tsx` · `imagegen/ImageGenPreview.tsx` · `components/settings/MediaAssetManager.tsx` · `hooks/useImageGenActions.ts` · `services/imageGen.ts` · `services/mediaStore.ts` · `utils/imageGenInputs.ts` · `utils/mediaUrl.ts` · `constants/imageGenPresets.ts`

**修改**
`NodeRenderer.tsx` 加 `case 'imagegen'` 与 `case 'file'` · `nodeCapabilities.ts` 补注释 · `App.tsx` rotation 表加新类型 · `ImageNode/VideoNode/DocumentNode` 支持 `filePath` · `utils/file.ts` 重写走 Rust 导入 · `canvasMenuItems.ts` 加生图项

---

## 13. 执行批次

每个步骤 = 一次提交。带 ⛔ 的是阻塞后续的关键路径。

### 前置

| 步 | 内容 | 完成判据 |
|----|------|---------|
| ⛔ **S0** | `git init` + 校验 `.gitignore` 排除 `node_modules/` `src-tauri/target/` `dist/` + 基线提交 + 建分支 | `git log` 有基线提交；`git status` 干净 |
| **S1** | 跑通基线：`npm install` → `npm run lint` → `npm test` → `npm run tauri:dev` | 四条命令均成功，记录当前告警数 |

### v0.2.0

| 步 | 内容 | 完成判据 |
|----|------|---------|
| ⛔ **S2** | 修 `DraggableNode` 右键拖拽隐患；`screenToCanvasPosition`；`canvasMenuItems` 数据源抽取 | 右键按住拖不动节点；工具栏 `+` 行为不变 |
| ⛔ **S3** | `Tooltip` 组件 | 单点验证：悬停 400ms 出提示，翻转正常，不被画布缩放影响 |
| **S4** | 右键菜单：空白处 + 节点 + 连线 | §14 右键菜单验收前 8 条 |
| **S5** | 右键菜单：多选分支（批量删除 / 全部连到此节点 / 合成长文） | §14 多选相关 3 条 |
| **S6** | 工具栏 `+` 改用 `canvasMenuItems` 数据源 | 两处菜单项完全一致，改一处两处都变 |
| **S7** | 桌面版启动守卫 + README/APP.md 徽章清理 | 浏览器打开 `dist` 显示引导页；`npm run dev` 仍可调试 |
| ⛔ **S8** | 内置 Key 移除（10 处文件）+ `DOUBAO_DEFAULT_MODEL` 置空 | `grep -ri "BUILTIN.*API_KEY" src/ vite.config.ts` 无结果；构建产物搜不到硬编码 Key |
| **S9** | 首启引导卡 | 清空 localStorage 后启动，画布中央出现引导卡，点击直达设置 |
| ⛔ **S10** | `src/i18n.ts` 拆为 `src/i18n/en.ts` + `zh.ts`（纯搬运） | `npm test` 通过；界面文案无变化 |
| **S11** | i18n 补全 22 处 + `MetaLabel` 组件 + 新命名空间 | §14 汉化验收；装饰标签字距正常 |
| **S12** | `scripts/check-i18n.mjs` + 挂进 `npm run lint` | 故意删一个 zh key，`npm run lint` 报错 |
| **S13** | Tooltip 全量：补齐 ~40 处 + 迁移现有 31 处 `title=` | `node scripts/audit-tooltips.mjs` 剩余项全在白名单内 |
| **S14** | v0.2.0 回归 + 打包验证 | `npm run tauri:build` 成功；安装后手测 §14 全部 v0.2.0 条目 |

### v0.3.0

| 步 | 内容 | 完成判据 |
|----|------|---------|
| ⛔ **S15** | Rust：数据根解析 + 可写性探测 + 回退；`media_store_info` | 命令返回正确路径与占用；模拟只读目录能回退 |
| ⛔ **S16** | Rust：`spoor-media` 协议（含 Range）+ 路径穿越防护 + **单测** | 单测覆盖 `..`/编码绕过/符号链接；手放一张图能在 webview 显示 |
| **S17** | Rust：`media_*` 命令组（import / import_bytes / list / export / delete / reveal / gc） | 各命令单独调通 |
| **S18** | `tauri.conf.json`：`installMode` / `dragDropEnabled` / NSIS `installerHooks` 卸载弹窗 | 打包安装再卸载，弹窗出现且「保留数据」有效 |
| ⛔ **S19** | 前端：`mediaUrl` + `ImageNode`/`VideoNode`/`DocumentNode` 支持 `filePath` + 缺失文件兜底 | 手写一条 `filePath` 的 node，画布正常显示；删文件后显示占位 |
| **S20** | 文件导入改 `tauri-plugin-dialog`（菜单/工具栏入口） | 插入 500MB 视频不卡 UI |
| ⛔ **S21** | 拖放改 Tauri 原生事件；退役 `utils/dnd.ts` / `DEBUG_DND` / HTML5 drop | 拖入文件落点正确；空白区/连线附近/节点上 三种位置均可 |
| **S22** | `utils/file.ts` 重写（原件归档 + 正文入库）+ 新增 `file` 节点类型 | 图片/视频/docx/txt/md/其他 六类各测一遍 |
| **S23** | 静默 best-effort 迁移旧 base64 | 造几条 data URL 节点，重启后变成 `filePath` 且显示正常 |
| ⛔ **S24** | `AIConfig` 重构 + `resolveActiveChatConfig` 垫片 + **单测** | 对话/研究/人设三个模块功能不变；单测覆盖垫片 |
| **S25** | 设置面板 Tab 化 + Provider/模型 CRUD + 四种预设 + 连通性测试 | 加两个服务各挂两个模型，重启后保留；测试按钮出图 |
| ⛔ **S26** | Rust：四种生图适配器 + 错误归一 + 取消 + **单测** | 四家各成功出图一次；错误码映射正确 |
| **S27** | 前端 `services/imageGen` + 并发队列 | 两个并行第三个排队 |
| **S28** | `ImageGenNode` UI（四态 + 历史翻页 + 逐张删除 + 参考图条） | §14 生图验收 |
| **S29** | `imageGenInputs` 连线解析（含链式）+「输出为图片节点」+ 右键菜单加生图项 | §14 链式与输出条目 |
| **S30** | 资产管理器（存储 Tab） | §14 资产管理条目 |
| **S31** | 收尾：`services/ai.ts` 删 `isTauriRuntime` 分支、`vite.config.ts` 删 proxy、删 `netlify.toml` | `npm run tauri:build` 成功；全量回归 |

---

## 14. 验收标准

### 右键菜单
- [ ] 空白处右键弹菜单，"新建便签"落在**右键处**而非视口中心
- [ ] "插入图片…"唤起原生文件对话框，图片节点落在右键处
- [ ] 节点右键可编辑/复制/连线/删除，删除同时清理相关连线
- [ ] 选中 3 个节点后在其中一个上右键 → **"全部连到此节点"生成 2 条边**，重复执行不产生重复边
- [ ] 多选右键"批量删除"，3 个节点及其连线全部消失
- [ ] 多选右键"合成长文"等价于右上角合成按钮
- [ ] 连线右键可删除该连线
- [ ] 输入框内右键仍是原生菜单（可复制粘贴）
- [ ] 视口右下角右键时菜单自动翻转不溢出
- [ ] **右键按住拖动不会移动节点或画布**

### 汉化与 Tooltip
- [ ] 中文界面下六个模块无残留英文（品牌名、`REF-042`、`Aa` 除外）
- [ ] 装饰标签显示中文且**字距正常**（未被 `tracking-wider` 拉散）
- [ ] 首启种子数据按当前语言生成
- [ ] AI / 搜索 / 文件类错误提示为中文
- [ ] `npm run lint` 通过 i18n key 一致性校验
- [ ] **全应用每个按钮悬停 400ms 后出现样式统一的中文提示**，无原生 `title` 与自定义 Tooltip 混用

### 桌面版化
- [ ] 浏览器打开构建产物 → 显示"请使用桌面版"引导页（DEV 除外）
- [ ] 构建产物中**搜不到任何硬编码 API Key**
- [ ] 全新安装且未配置 Key 时，画布显示首启引导卡，点击直达设置

### 文件存储
- [ ] 生成图落在 `<安装目录>/SpoorData/media/generated/年/月/`
- [ ] 上传的图片/视频/文档落在 `media/uploaded`、`media/documents`
- [ ] **DB 中不再出现 `data:` 前缀的 content**（新建内容）
- [ ] DB 存相对路径，不含盘符与绝对路径
- [ ] 画布上图片/视频正常显示；**重启后仍正常**
- [ ] **视频可拖动进度条**（Range 生效）
- [ ] **文件字节与云端原图/原上传文件完全一致**（hash 比对，无压缩无重编码）
- [ ] 把整个安装目录移到另一路径后，所有媒体仍正常显示
- [ ] 路径穿越防护：构造 `../../` 路径无法读到数据根之外的文件
- [ ] 拖放 500MB 视频不卡死 UI
- [ ] docx 上传后：原件在 `media/documents`，正文 HTML 在 DB，节点可正常显示与被 AI 读取
- [ ] txt/md 上传后落为可内联编辑的文本节点，原件同时归档
- [ ] 手动删除文件后节点显示占位图 +「文件已删除」，不白屏不报错

### 生图
- [ ] 设置中可添加 ≥2 个服务，每个下可添加多个对话模型与生图模型；重启后保留
- [ ] 火山方舟 / OpenAI / Nano Banana / **自定义地址** 四种均可成功出图
- [ ] 只连一个便签 → 用便签文字生成
- [ ] 连一张图片 + 一个便签 → 图片作参考图、便签作提示词
- [ ] 生图节点 A 连到 B → B 把 A 的当前结果作为参考图
- [ ] 切换模型 / 改尺寸 / 改提示词后重新生成，结果更新
- [ ] **生成 20 张后历史全部保留可翻页**，可单张删除
- [ ] 生成中可取消；失败显示中文错误 + 可展开详情
- [ ] "输出为图片节点"生成 `image` 节点并自动连线
- [ ] 两个节点可同时生成，第三个排队

### 资产管理与卸载
- [ ] 设置→存储 显示正确路径、占用、文件数
- [ ] 可按「生成图/上传/未被引用」筛选，可搜索
- [ ] 可多选导出、定位、删除，删除有二次确认
- [ ] **卸载时弹出自定义对话框**，选「保留数据」后 `SpoorData` 完整存留；选「全部删除」则清空

---

## 15. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| **无版本控制** | 改坏无法回退 | ⛔ S0 先 `git init`；每步单独提交 |
| **拖放重写引入回归** | 文件拖入失效 | 原生事件与 HTML5 行为差异大；S21 单独提交，三种落点位置逐一手测 |
| **自定义协议路径穿越** | 可读任意本地文件 | 拒绝 `..`/绝对路径 + canonicalize 后校验在根内；S16 强制写单测 |
| **安装目录不可写** | 存储直接失败 | 启动可写性探测 + 自动回退 `app_local_data_dir()` + 设置显示实际路径 |
| **卸载误删数据** | 生图全丢 | §7.2 自定义弹窗；文案明确 |
| **豆包默认模型是账号专属 ep- ID** | 用户填了自己的 Key 仍报错 | S8 置空默认值 + 设置里专门文案 |
| `AIConfig` 重构 | 波及 4 个模块 | `resolveActiveChatConfig` 垫片保持旧形状；S24 强制写单测 |
| 四家 API 响应差异 | 适配器维护成本 | Rust 侧归一 + 每适配器单测（`#[cfg(test)]`） |
| 不压缩 + 历史不限 | 磁盘无限增长 | 资产管理器 +「未被引用」筛选 + 占用常驻显示；不自动删 |
| 中文装饰字破坏排版 | 视觉退化 | §4.2 抽 `MetaLabel` |
| Rust 侧改动多 | 编译耗时长，反馈慢 | S15–S18、S26 集中在 Rust，尽量批量验证；`cargo check` 先于 `tauri:dev` |
| API Key 明文存 localStorage | 安全 | 与现状一致；后续可迁 Tauri Stronghold（本次不做） |
