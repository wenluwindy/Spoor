# Spoor v0.4.0 规划（还账 + 把 AI 做深）

> **状态：已实现并随 0.4.0 发布**（Linux 构建与移动端按用户决定不做）。
> 与本规划的偏离及理由见 [RELEASE_v0.4.0.md](../release/RELEASE_v0.4.0.md) 的「与规划的偏离」一节，
> 要点：imageGenResults 未挪独立表（读放大的根源已在源头修掉）、AI 历史比对做成
> 「翻看 + 固定」（窄卡里并排长文不可读）、反链保留窄索引 live query、
> 键盘优先级栈与序列化注册表留给 0.5.0。
>
> 本文基于对 0.3.1 代码的全量核查（2026-08），所有「现状」与「问题」
> 均给出文件与行号证据，不是推测。体例沿用 [ROADMAP_v0.3.0.md](./ROADMAP_v0.3.0.md)。
>
> 0.3.0 的主题是「让人敢把东西放进来」——底盘、可逆、可带走。
> 0.4.0 的主题是：**「把已有的做对，把 AI 做深」**——先修掉真实存在的缺陷与
> 性能天花板，再把 AI 侧从「可重跑」推进到「可比较、可分步」。

---

## 1. 0.3.x 收尾盘点与旧路线图勘误

0.3.0 + 0.3.1 已完成：撤销重做、键盘全集、多选剪贴板、画布内搜索、JSON Canvas /
Markdown / PNG 导出、备份与快照、PDF 节点、网页卡片、跨画布传送门、沿边重算、
区域框、Research Lab 落画布、视口裁剪、macOS 构建。

对着代码核对，旧差距清单需要两处勘误：

- **缩放百分比已实现**（`src/components/CanvasToolbar.tsx:153`），旧表里「无缩放百分比」已过期，只剩小地图没做。
- **改色 UI 其实存在**（双击卡片出色板，`src/components/canvas/DraggableNode.tsx:233`），但它只写组件本地 `useState`（`:81`），**从不落库**——刷新、切画布、视口裁剪导致的重挂载都会丢。这不是「没做」，是「做了一半且会丢数据」，归入下面的缺陷清单。

真正还欠着的：对齐/分布/对象吸附、小地图、节点标签、文本 AI 卡历史与分支比对、
模板、演示模式、Linux 构建。

## 2. 不合理之处（0.4.0 之前必须正视的账）

先说正面：全库 0 个 `any`、0 个 TODO/FIXME、无空 catch，118 个测试文件
（约 1.8 万行测试对 2.3 万行源码），四个核心模块（撤销栈、导入导出、重算执行器、
区域框几何）都有测试。底子是好的，下面是底子上的洞。

### 2.1 实打实的缺陷（P0，先修再谈新功能）

| # | 缺陷 | 证据 | 后果 |
|---|------|------|------|
| D1 | **macOS 自动更新会下载 Windows 安装包**：`pick_installer_asset` 只认 `.exe`，全 Rust 侧无一处 `cfg(target_os)`；`install_update` 直接打开安装包并退出应用 | `src-tauri/src/updater.rs:75-93`、`:245` | Mac 用户点「检查更新」→ 下载 30MB 的 exe → 应用自杀，什么也装不上 |
| D2 | **节点改色不落库**：色板写的是 `styleOverrides` 组件状态 | `src/components/canvas/DraggableNode.tsx:81` | 用户以为给卡片分了类，重开画布全白改 |
| D3 | **5 个 HTTP 代理命令全部没有超时**（对话 / 搜索 / 生图），对面挂住则 Promise 永不 resolve，前端 `isAnyAiBusy` 会**永久锁死撤销、重做与输入栏** | `src-tauri/src/lib.rs:20,66,156,189,230`、`imagegen.rs:188`；对照组 `webpage.rs:47` 是对的（20s） | 一次网络故障 = 重启应用 |
| D4 | **`user_file_write_text` / `write_base64` 可写任意绝对路径**，「只应在 dialog 之后调用」只是注释约定，Rust 侧零校验 | `src-tauri/src/userfile.rs:8-9` vs `:31-48` | 与 D5 叠加时可被用来覆写任意文件；`media.rs:156` 的 canonicalize + 前缀校验模式应推广过来 |
| D5 | **`csp: null` + docx 的 HTML 未经清洗直接 `dangerouslySetInnerHTML`**，webview 可访问全部 30 个 Tauri 命令 | `src-tauri/tauri.conf.json:22`、`src/components/nodes/DocumentNode.tsx:28`、来源 `src/services/fileImport.ts:86` | 一个恶意 docx 就是一个攻击面 |
| D6 | **chat 代理接受前端任意 `url` 并附上 API Key，无 scheme/host 校验**（`open_external_url` 与 `fetch_webpage` 都做了校验，唯独带密钥的这条没做） | `src-tauri/src/lib.rs:19,155` | 密钥可能发往明文信道 |
| D7 | **`addNodesAndEdgesRecorded` / `deleteNodesRecorded` 不在事务里**：节点写完、边写失败会留孤儿数据，且撤销补丁已入栈 | `src/services/canvasMutations.ts:65-68`、`:84-89`；全库只有 `backup.ts:177` 用了 `db.transaction` | 撤销栈还原出错乱状态 |
| D8 | **死代码与依赖错位**：`scripts/remotion-server.mjs` 引用不存在的 `remotion-kit/` 目录，`express`、`dotenv` 因此是死依赖；`vite`、`@tauri-apps/cli`、`@vitejs/plugin-react` 混在 `dependencies` 里 | `package.json:21,23-45` | 安装体积与供应链面无谓变大 |

### 2.2 性能不合理（随画布变大线性恶化，是所有新功能的地基）

这些问题单看都能忍，但它们是**乘法关系**：AI 流式每秒写库 10 次（P3）× 每次写库
触发全表扫描（P1）× 每次扫描后全树无 memo 重渲（P4）——一张卡在生成，整个画布在陪跑。

| # | 问题 | 证据 |
|---|------|------|
| P1 | `useLiveQuery` 用 `db.nodes.filter(...)` **全表扫描**，而 `canvasId` 索引明明建了（`db.ts:209`）没有用；任意画布的任意写入都让当前画布重扫全表 | `src/App.tsx:132-137` |
| P2 | 跨画布搜索 `db.nodes.toArray()` 整库读入内存，再对每节点 7 个字段做 `includes`——每敲一个字符一次 | `src/App.tsx:652`、`src/utils/canvasSearch.ts:64-84` |
| P3 | AI 流式内容**直接落 Dexie**（100ms 节流），带动 P1/P4 连锁 | `src/utils/canvasStreamingAi.ts:4,15` |
| P4 | **全库零 `React.memo`**：App 每次重渲都重建全部节点树 | `grep React.memo src/components` → 0 |
| P5 | **永不停止的 rAF 循环**，每帧对每条边两端各调一次 `getBoundingClientRect()`（强制同步布局），且切到研究/长文页后画布已卸载它仍在跑 | `src/hooks/useCanvasInteraction.ts:191-265` |
| P6 | 平移时每个 pointermove 都 `setCanvasTransform` → App 全树重渲 + 裁剪集合全量重算 | `useCanvasInteraction.ts:114-120` → `App.tsx:235-250` |
| P7 | 视口裁剪只裁节点不裁边（`CanvasEdgeLines` 拿的是完整 `edges`），且 150 的启用阈值偏高 | `src/utils/viewportCulling.ts:19,75`、`App.tsx:1122-1128` |
| P8 | 反链集合常驻 live query 订阅全库 canvasLink 节点，被 P3 的流式写入每秒打 10 次 | `src/App.tsx:553` |
| P9 | 媒体资产管理器无虚拟化，而「生图历史永久保留」的决策会让它涨到数千项 | `src/components/settings/MediaAssetManager.tsx:135-165` |

### 2.3 结构性技术债（利息在涨，挑着还）

| # | 债务 | 证据 |
|---|------|------|
| T1 | **App.tsx 1288 行上帝组件**：63 处 hook、15 个 `useState`、5 个 `useLiveQuery`，剪贴板/搜索/导出/反链/吸附全在里面 | `src/App.tsx` |
| T2 | 「建 AI 卡 + 建边 + 开流 + 失败删边」**四处近乎逐行重复** | `src/hooks/useAiActions.ts:186,244,476,555` |
| T3 | **四套序列化格式各自映射节点字段**（JSON Canvas / 备份 / 剪贴板 / Markdown），新增一个 `CanvasNode` 字段要改四处 | `services/jsonCanvas.ts`、`backup.ts`、`utils/canvasClipboard.ts`、`canvasMarkdown.ts` |
| T4 | **`CanvasNode` 是 40+ 字段宽表**，七种节点类型平铺靠注释分段；节点级无 `createdAt/updatedAt`；AI 卡会话靠 `threadRootContextNodeId` + `followUpSent` 隐式表达，没有历史/分支的 schema 空间；`imageGenResults` 无上限地存在节点行里 | `src/db.ts:3-104` |
| T5 | 「这行属于哪张画布」判定复制了 6 遍；`utils/file.ts` 与 `services/fileImport.ts` 双实现（前者注释自称 v0.3.0 要删，0.3.1 还在） | `canvasMutations.ts:22` 等；`utils/file.ts:54` |
| T6 | Escape 键三个互不知情的处理者，靠隐式顺序约定协调 | `useCanvasKeyboard.ts:77`、`useCanvasContextMenu.ts:78`、`useCanvasLinkDrag.ts:94` |
| T7 | **`canvasMutations.ts` 无直接测试**——它是唯一「同时写库 + 入撤销栈」的枢纽，撤销正确性一半压在它身上 | 无 `tests/services/canvasMutations.test.ts` |
| T8 | i18n 单文件 700 行（上次拆分拆的是语言维度，不是模块维度，又长回来了）；日志 67 处 console、两套前缀混用 | `src/i18n/zh.ts:1-6`；`services/ai.ts` 22 处 |
| T9 | API Key 明文存 localStorage（备份已正确排除密钥，说明有此意识，但存储位置本身没动） | `App.tsx:298,320` |

## 3. v0.4.0 建议范围

### 主线 A：还账——缺陷与性能（P0，本版核心）

1. **修掉 2.1 的全部八条缺陷**。其中 D1（macOS updater 加 `cfg(target_os)` + dmg 分支或降级为「提示手动下载」）、D2（`styleOverrides` 落库，顺手完成 C 线颜色分类的一半）、D3（统一 `.timeout()`：对话 120s / 搜索 30s / 生图 300s，外加 `connect_timeout`）三条是用户天天撞的；D4/D5/D6 是安全面，一起收。
2. **性能五连修**，按依赖顺序：P1 改 `where('canvasId')`（配合 Dexie v5 迁移把历史数据的 `canvasId` 一次性补齐，删掉散在 6 处的运行时兜底）→ P3 流式内容改走内存 store、生成结束才写库一次 → P4 给 `DraggableNode`/`NodeRenderer` 加 `React.memo` → P5/P6 rAF 只在画布页且有变化时跑、平移期间只写 CSS transform、抬起才 commit → P7 边随节点一起裁剪。
3. **Dexie v5 一次迁移铺到位**（schema 动一次就把 0.4 全部需要的都带上）：
   - `upgrade()` 补齐历史 `canvasId`（第一次真正使用 Dexie 迁移，替代热路径兜底）；
   - nodes/edges 补 `createdAt/updatedAt` 并建索引——**这也是未来任何形式多设备同步的最低前提**，现在连「时间戳最后写入胜出」都做不了；
   - 新表 `aiTurns`（B 线用）；`imageGenResults` 挪独立表，节点行只留当前项；
   - `articles` 加 `*tags` multiEntry 索引（C 线用）。

### 主线 B：AI 从可重跑到可比较（P1，本版最大的新功能）

4. **AI 文本卡的生成历史与分支**：现在重跑是**原地覆盖**（`canvasStreamingAi.ts:15`），旧回答直接消失且撤销栈吃不到。对齐生图节点已有的心智（`imageGenResults` + 翻页）：每次生成存一条 `aiTurns`，卡上可左右翻历史、可两版并排比对、可把某一版「固定」为当前内容。旧路线图把「分支比对」标为 P2，但既然 0.3.1 已交付沿边重算，「重跑会毁掉旧结果」就从小缺点变成了主要矛盾。
5. **Research Lab 真分步执行**：现在「三步计划」是装饰性的——整份计划塞进一个 prompt，全流程只有一次搜索（query 就是原始问题）+ 一次 LLM 调用（`ResearchLab.tsx:428-467`）。改为：按步骤生成子查询 → 逐步检索与推理 → 汇总成报告；每步进度可见、可中断；历史会话可续跑（现在载入即 `completed`，只读）。
6. **搜索结果落成带来源的卡**：现在联网搜索落的是普通 text 卡，链接只是正文里一段 Markdown（`spawnWebSearchNoteCards.ts:21`），丢掉了结构化来源。改落 `web` 节点（url/标题/站点字段都是现成的），可重抓、可按来源追溯——与 0.3.1 的网页卡片能力合流。

### 主线 C：组织与导航——画布底盘收尾（P1）

7. **节点颜色与标签落库**：D2 修完颜色就持久了；再给 `CanvasNode` 加 `tags`，右键菜单加改色与打标，`Ctrl+F` 与多选支持按标签筛。旧表里的 P2 项，因为「改色 UI 已存在只差落库」而变得便宜。
8. **对齐 / 分布 / 对象间吸附**：多选右键加对齐（左/右/上/下/居中）与等间距分布；拖动时对齐辅助线吸附（阈值几像素，网格吸附关闭时也生效）。差距清单里挂了两个版本的 P1，是白板底盘最后一块明显的洞。
9. **小地图**：右下角可折叠小地图，视口矩形可拖。有了视口裁剪（0.3.1）之后大画布才是常态，小地图从「锦上添花」变成「刚需」。
10. **模板**：多选右键「存为模板」、画布右键「从模板插入」。剪贴板 payload（nodes + edges + 重建 id，`canvasClipboard.ts:141`）就是现成的序列化结构，主要工作是一张 `templates` 表和一个选择器 UI。

### 主线 D：平台（P2）

11. **Linux 构建**：`release-desktop.yml` matrix 加 ubuntu（AppImage + deb）。
12. **数据目录可迁移**：存储设置里允许把 `SpoorData/` 指到自选目录——这是「把数据放进网盘同步文件夹」这一民间方案的最低支持。**完整的多设备同步 0.4.0 不做**（画布数据在 IndexedDB 里，同步是一个大版本的题目），但 A3 的 `updatedAt` 已把地基打了；建议 0.5.0 立项时再决策方案（文件化存储 vs CRDT）。

### 主线 E：工程底账（贯穿，随对应功能顺手还）

13. **App.tsx 拆分**：抽 `useCanvasClipboard` / `useCanvasSearch` / `useCanvasExport`，App 只留布局与页签分发；B 线动 `useAiActions` 时顺手抽「建 AI 卡」工厂（T2）；键盘引入显式优先级栈（T6）。
14. **补关键测试**：`canvasMutations`（coalesce 合并、删节点连带边、空 patch 不入栈）+ 事务化（D7）一起做；`useImageGenActions` 与 `mediaStore` 次之。
15. **清理**：删 `remotion-server.mjs` 与死依赖、依赖归位到 devDependencies（D8）；删 `utils/file.ts` 双实现（T5）；i18n 按命名空间拆文件（T8）；统一 logger 前缀。
16. **序列化字段注册表**（T3）：B/C 线会给 `CanvasNode` 加字段（tags、turn 引用），正是「改四处」的痛点被放大的时刻——定一份字段 → 各格式处理器的注册表，四个序列化器读同一张表。

> 建议**不进** v0.4.0：演示模式（等小地图与模板站稳再说）、实时协作（维持 0.3.0 的
> 「明确不做」）、移动端（Web 版已停维护，触摸交互整套缺失，投入产出不成比例）、
> 手绘/形状工具（仍然是 Miro 的正面战场）。API Key 挪出 localStorage（T9）建议与
> 0.5.0 的同步方案一起定，避免存储位置改两次。

## 4. 推荐取舍

如果只能做一半，做 **A + B**，C 里只带走第 7 条（颜色标签，因为 D2 必修、边际成本极低），其余放 0.5。

理由：A 是信任问题的延续——0.3.0 解决了「敢放进来」，但 macOS 更新装错包、
网络一挂就锁死界面、改色会丢，每一条都在消耗那份信任；性能五连修则决定了
0.4 之后的所有功能是在结实的地基上盖，还是在每秒 10 次全表扫描上盖。
B 是产品定位的兑现——「研究实验室」目前是一次性生成，「可重跑」目前会毁掉旧结果，
这两条做实之后，Spoor 在第三赛道（生成式节点画布）才有真正的差异化叙事。
C 的三件套（对齐/小地图/模板）是标准白板功能，晚一个版本用户不会流失。

## 5. 风险

| 风险 | 说明 | 对策 |
|------|------|------|
| Dexie v5 迁移出错 | 第一次用 `upgrade()`，历史数据形态多样 | 迁移前强制自动快照（机制已有）；迁移逻辑单独出测试，用 fake-indexeddb 灌旧版数据回放 |
| 流式改内存 store 后 UI 断流 | 现在整条 UI 链路靠 live query 回流，改内存直供后要保证生成中的卡与库中数据最终一致 | 生成中的卡由 store 驱动、生成完成写库并交还 live query；崩溃恢复依赖「未完成生成不落库」的既有语义 |
| aiTurns 与撤销栈打架 | 「翻历史」「固定某版」算不算可撤销操作，边界要先定 | 翻看不入栈（同 PDF 翻页的先例）；「固定」入栈 |
| Research Lab 分步执行成本失控 | 每步一次搜索 + 一次 LLM，token 与配额消耗数倍 | 步数上限、每步可跳过搜索、全程可中断；执行前展示预计调用次数 |
| CSP 收紧误伤现有功能 | 内联样式、blob 图片、各家 API 域名都要放行 | 从 report-only 起步跑一轮全功能回归，再切强制 |
| 性能改动引入回归 | memo 化最容易造成「该更新的没更新」 | 先给拖拽/流式/裁剪写基准与行为测试，再动渲染层 |
| 对象吸附与网格吸附互相打架 | 两套吸附同时命中时结果抖动 | 明确优先级：对象辅助线 > 网格；同帧只允许一个吸附源生效 |

## 6. 参考

- [ROADMAP_v0.3.0.md](./ROADMAP_v0.3.0.md)（差距清单与竞品盘的底稿）
- [RELEASE_v0.3.1.md](../release/RELEASE_v0.3.1.md)（本版规划的起点状态）
- [Dexie schema 升级文档](https://dexie.org/docs/Tutorial/Design#database-versioning)
- [Tauri CSP 配置](https://v2.tauri.app/security/csp/)
