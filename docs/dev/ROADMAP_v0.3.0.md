# Spoor v0.3.0 规划（竞品对标 + 功能取舍）

> **状态：A 线与 B 线已全部实现**（撤销重做 · 键盘快捷键 · 多选复制粘贴 · 画布内搜索 ·
> JSON Canvas 互通 · Markdown 包与 PNG 导出 · 备份恢复与自动快照）。
> 实现过程中有两处刻意偏离，理由写在对应提交里：
> 1. §3 B 线原计划导出 SVG 与 PDF，实际只做 PNG——可用的 SVG 方案产出的是 `foreignObject`
>    包着 HTML，Figma 与 Illustrator 打不开，给一个只有浏览器能看的「SVG」是个陷阱。
> 2. §3 主线 B 第 6 条原计划打包成 zip，实际是单个 JSON + 媒体路径清单——为了备份多引一个
>    压缩库不划算，而 `SpoorData/` 本来就可以整个复制走。UI 里明说了这一点。
>
> **主线 C、D、E 已在 v0.3.1 补齐**：PDF 节点（翻页 + 划选摘成便签）、网页卡片、跨画布
> 传送门与反链、沿边重算、区域框、Research Lab 落盘成 Frame、大画布视口裁剪、macOS 构建。
> 与原计划的两处偏离：
> 1. §3 E12 计划「Dexie 升到 v5 + content 索引」，实际没动版本号——新字段不需要索引，
>    Dexie 只在索引变化时才要迁移；而 Dexie 的索引做不了子串匹配，加一个 content 索引
>    对画布内搜索没有帮助。
> 2. §3 E12 计划用 `parentId` 存 Frame 成员，实际按几何判定。存成员表意味着移动、删除、
>    撤销、导入都要维护一致性，漏一处就变成「看着在框里、拖动却不跟着走」。
>
> 说明：`docs/dev/UPGRADE_PLAN.md` 里的「v0.3.0」指的是那份文档自己的第二批步骤（S16–S31），
> 已随 **实际发布的 0.2.0** 一起上线。本文的 v0.3.0 = `package.json` 里 0.2.0 之后的下一个版本。

---

## 1. 竞品盘：三条赛道，Spoor 站在交叉点

| 赛道 | 代表 | 他们把画布当成什么 | 看家本领 |
|------|------|------------------|---------|
| **通用白板 / 画布底盘** | Miro、FigJam、Excalidraw、tldraw | 空间化的工作面 | 撤销重做、Frame/分区、对齐分布、对象吸附、小地图、演示模式、图片导出、模板 |
| **知识 / 研究画布** | Heptabase、Kosmik、Scrintal、Obsidian Canvas、AFFiNE | 长期沉淀的知识面 | PDF 高亮摘卡、卡片双链与反链、标签、内置浏览器、跨画布跳转、开放格式（JSON Canvas）、本地优先 |
| **生成式 AI 节点画布** | Flora、Figma Weave（原 Weavy）、Freepik Spaces、Flowith | 可视化的生成流水线 | 节点即步骤、可重跑、分支比对、模板化工作流、40–50 个模型、图/视频/音频统一编排 |

**Spoor 目前的位置**：AI 侧（人格 Agent、Research Lab、生图节点、联网搜索、本地 GGUF）已经不比第三赛道的产品弱，
本地优先 + 无内置 Key 的立场比它们都硬；但**第一赛道的底盘几乎是空的**，第二赛道的内容型能力（PDF、网页、跨画布链接）也缺。

这不是"少几个功能"的问题，而是信任问题：一个没有撤销、误删就没了的画布，用户不敢往里放重要东西。
所以 v0.3.0 的主线应该是**把底盘补齐 + 把数据主权做实**，而不是继续堆 AI 花活。

## 2. 差距清单（对着代码核对，非推测）

| 能力 | 竞品普遍水位 | Spoor 现状 | 优先级 |
|------|------------|-----------|--------|
| 撤销 / 重做 | 全员标配 | **完全没有**（全库只有 `i18n/en.ts` 里一个 undo 字样） | **P0** |
| 键盘快捷键 | 全员标配 | 只有 Space 平移、Esc 取消连线（`useCanvasInteraction.ts:152`、`useCanvasLinkDrag.ts:79`）；Delete / Ctrl+A / 方向键微调 / Ctrl+C·V 全无 | **P0** |
| 多选复制粘贴 | 全员标配 | 只有单节点 `duplicateNode`（`CanvasContextMenu.tsx:193`）与便签级剪贴板（`noteClipboard.ts` 仅 note/text） | **P0** |
| 对齐 / 分布 / 对象吸附 | Miro、FigJam、tldraw | 只有 24px 网格吸附（`useCanvasGrid.ts`），无对象间吸附与对齐命令 | **P1** |
| 小地图 / 缩放控件 | 全员标配 | 只有 ⛶ zoom-to-fit（`utils/zoomToFit.ts`），无小地图、无缩放百分比 | **P1** |
| Frame / 分组 / 分区 | Miro、FigJam、Heptabase | 无（`canvasGroupDrag.ts` 只是多选整体拖动） | **P1** |
| 画布内搜索定位 | Heptabase、Miro、Obsidian | 无 | **P0** |
| 整画布导出图片 / PDF | 全员标配 | 无（只有单个媒体「另存为」） | **P0** |
| 开放格式导入导出 | Obsidian JSON Canvas、Excalidraw | 无任何导入导出，数据只在 IndexedDB 里 | **P0（差异化）** |
| 备份 / 恢复 | 本地优先阵营标配 | 无自动备份；`docs/guide/DATA_RECOVERY.md` 是事后抢救 | **P0** |
| PDF 节点（阅读 + 摘卡） | Heptabase、Kosmik 的核心 | 无，`fileImport.ts` 只认 docx/txt/md | **P1** |
| 网页 / URL 节点 | Kosmik 的核心 | 无（搜索结果只落成便签，`spawnWebSearchNoteCards.ts`） | **P1** |
| 跨画布链接 / 反链 | Heptabase、Obsidian | 多画布已有（`CanvasHistoryPopover`），但画布之间无法互相跳转 | **P1** |
| 节点标签 / 颜色分类 | 全员 | 只有 `Article.tags`，节点没有 tag；颜色只跟 layout 走 | **P2** |
| AI 流水线可重跑 | Flora、Figma Weave | 边只表示「上下文来源」，改上游后无法沿边重算下游 | **P1** |
| 分支比对 | Flowith、Flora | 生图有历史（`imageGenResults`），文本 AI 卡没有 | **P2** |
| 演示 / 讲述模式 | Miro、Heptabase | 无 | **P2** |
| 大画布性能 | tldraw 数千对象 | 全量渲染，无视口裁剪与虚拟化 | **P2** |
| macOS / Linux 构建 | — | 只出 Windows NSIS | **P2** |
| 实时协作 | Miro / Flora / Weave | 无 —— **建议明确不做**，与本地优先定位冲突 | 不做 |

## 3. v0.3.0 建议范围

主题定名：**「让人敢把东西放进来」——底盘、可逆、可带走。**

### 主线 A：可逆的画布（P0，本版核心）

1. **撤销 / 重做**
   - 在 `useNodeActions` 之上加一层命令栈：所有写库动作（建/删/移/连/断/改内容/批量删）产出 `{ do, undo }` 对，栈存内存，切画布清栈。
   - 关键边界：AI 流式写入 `content` 的中间态**不入栈**，一次生成完成后合成一条记录；生图结果同理。
   - 删除类操作 undo 必须能还原节点 id 与其所有边（否则连线断掉）。
   - `Ctrl+Z` / `Ctrl+Shift+Z`，文本编辑态内交给浏览器原生。
2. **键盘快捷键全集**：`Delete` 删选中、`Ctrl+A` 全选、`Ctrl+C/V/X` 多选复制粘贴（把 `noteClipboard` 从 note/text 扩到全类型 + 边）、方向键 1px / Shift+方向键 10px 微调、`Ctrl+D` 复制、`Ctrl+F` 搜索、`Ctrl+0/1` 缩放复位/适应、`?` 打开快捷键表。
   - 统一收进一个 `useCanvasKeyboard` hook，避免各处零散 `addEventListener`。
3. **画布内搜索（Ctrl+F）**：按节点正文 / 文件名 / Agent 名检索当前画布，回车逐个跳转并高亮定位；跨画布结果折叠在下方，点了直接切画布再定位。

### 主线 B：数据能带走（P0，最大差异化）

4. **JSON Canvas 导入 / 导出**（[jsoncanvas.org](https://jsoncanvas.org)，Obsidian 主导的开放格式，MIT）
   - 映射：`note/text/theme/ai` → `text` 节点；`image/video/document` → `file` 节点（写相对路径，正好对上现在的 `filePath` 设计）；`agent`/`imagegen` → `text` 节点 + 命名空间扩展字段；边的 `fromSide/toSide` 固定 `right/left`，与现在的出入口一致。
   - Spoor 专有字段（`layout`、`agentConfigId`、`imageGenMeta`…）放在 `spoor` 命名空间键下，保证「导出到 Obsidian 能看、导回 Spoor 不丢」。
   - 这一条的意义大于功能本身：对一个「本地优先、不内置 Key」的产品，能被 Obsidian 打开是最强的可信度背书。
5. **整画布 / 选区导出**：PNG（含 2x）、SVG、PDF；再加一个「导出为 Markdown 包」（每张卡一段，媒体附在旁边的 `assets/`）。
6. **备份与恢复**：设置 → 存储 增加「导出全部数据（画布 + 长文 + Agent + 设置，不含 Key）为 zip」与一键还原；再加**每日自动本地快照**（保留 7 份，落在 `SpoorData/backups/`）。

### 主线 C：研究型内容节点（P1）

7. **PDF 节点**：`fileImport` 增加 pdf 分支，节点内可翻页阅读；划选文字 →「摘成便签」并自动连一条边回 PDF 节点（Heptabase / Kosmik 的核心动作）。
8. **URL / 网页节点**：粘贴链接自动抓标题、封面、正文摘要（复用现有搜索服务通道走 Rust 侧请求），正文进 AI 上下文。让「搜索 → 落卡」从纯文本升级成带来源的可追溯卡片。
9. **跨画布链接节点**：一个指向另一张画布的传送门卡片，双击跳过去；被指向的画布侧显示反链列表。

### 主线 D：AI 从一次性到可重跑（P1，留一部分给 v0.4）

10. **沿边重算**：节点右键「重新生成」/「重算下游」——上游便签改了，下游 AI 卡与生图节点按边的拓扑序重跑。这是 Flora / Figma Weave 的核心心智，Spoor 已经有边，缺的只是执行器。
11. **Research Lab 落盘成 Frame**：研究报告不再只沉淀成长文，而是整块落到画布上的一个 Frame 里（计划、来源、结论各一组卡片，边已连好）。

> 建议**不进** v0.3.0：实时协作、手绘 / 形状工具、节点标签体系、演示模式、移动端。
> 前两个会把产品拽向 Miro / Excalidraw 的正面战场，而那不是 Spoor 的赢面。

### 主线 E：工程底账（贯穿）

12. Dexie 升到 v5：Frame 所需的 `parentId` / `frameId`、搜索所需的 `content` 索引、以及备份元数据。
13. 大画布性能：先加视口裁剪（画布外的节点不渲染），实测 500+ 节点的帧率再决定要不要虚拟化。
14. macOS 构建（`release-desktop.yml` 加 matrix）—— 若无 Mac 签名证书则先出未签名 dmg 并在文档里说明。

## 4. 推荐取舍

如果只能做一半，做 **A + B（第 1–6 条）**，把 C、D 放到 v0.4。

理由：A 和 B 都是「一次做完终身受益」的地基，且互相咬合（撤销栈的数据模型和备份/导出的序列化是同一套结构）。
C、D 是内容与 AI 的加法，晚一个版本不影响已有用户；而缺撤销、误删无法挽回、数据出不来，每天都在劝退用户。

## 5. 风险

| 风险 | 说明 | 对策 |
|------|------|------|
| 撤销栈与流式 AI 写入打架 | 流式期间每几十毫秒写一次 `content`，逐条入栈会把栈冲爆 | 流式区间整体作为一条记录，开始时记快照、结束时封条 |
| 撤销与 Dexie 的 `useLiveQuery` 时序 | undo 写库后 UI 靠 live query 回流，快速连按可能错序 | 命令栈串行化执行，undo/redo 期间加互斥 |
| JSON Canvas 有损往返 | 规范 1.0 刻意保守，装不下 Spoor 的语义 | 命名空间扩展字段 + 导入时对未知类型降级成 text 卡并提示 |
| PDF 渲染体积 | pdf.js 打进包会明显增大安装包 | 按需懒加载 chunk，不进主 bundle |
| i18n / tooltip 守卫 | 新增 UI 一多，`check-i18n` 与 `audit-tooltips` 会连环拦截 | 每个 PR 内同步补中英键与 tooltip，别攒到最后 |

## 6. 参考

- [The 12 Best Infinite Canvas Tools in 2026 — Storyflow](https://storyflow.so/blog/best-infinite-canvas-tools-2026)
- [Best Generative AI Canvas Apps（Weavy / Flora / Freepik）— Chase Jarvis](https://chasejarvis.com/blog/best-generative-ai-canvas-apps/)
- [Weavy vs Flora — Chase Jarvis](https://chasejarvis.com/blog/weavy-vs-flora/)
- [Announcing JSON Canvas — Obsidian](https://obsidian.md/blog/json-canvas/)
- [obsidianmd/jsoncanvas（MIT）](https://github.com/obsidianmd/jsoncanvas)
- [Kosmik vs Heptabase](https://www.kosmik.app/blog/kosmik-vs-heptabase)
- [Flowith review 2026 — eesel AI](https://www.eesel.ai/blog/flowith-review)
- [Best Open Source Whiteboard Tools in 2026](https://www.opensourcealternatives.to/blog/best-open-source-whiteboard-tools)
