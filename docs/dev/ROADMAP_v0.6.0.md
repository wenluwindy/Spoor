# Spoor v0.6.0 规划（本地模型：从「能跑」到「即插即用」）

> **状态：已实现并随 0.6.0 发布。** 与规划的偏离与已知边界见
> [RELEASE_v0.6.0.md](../release/RELEASE_v0.6.0.md)；CI 升级引擎版本时的
> 发布前检查单见 §4 风险表与 release-desktop.yml 内注释。
>
> 本文基于对 0.5.0 代码的全量核查（2026-08），所有「现状」
> 均给出文件与行号证据。目标由用户给定：**在大模型界面选择本地 GGUF 文件即可直接运行，
> 不用配置、下载、部署；参数按 GPU 显存 / CPU / 内存自动设置，也可手动修改。**

---

## 1. 现状核查：本地模型今天离「即插即用」有多远

对着代码核对（`src-tauri/src/local_llama.rs`，629 行），现状是一台毛坯机器：

| # | 事实 | 证据 |
|---|------|------|
| 1 | **发行包不含推理引擎**：安装 Spoor 后本地模型开箱可用率为 0%。用户须自己去 llama.cpp Releases 下载两个 zip，把 12 个文件（exe + 11 个 dll）手工复制进安装目录 | `tauri.conf.json` 无 resources/externalBin；`docs/guide/LOCAL_LLM.md:65-81` |
| 2 | **每次对话重新加载模型**：一次性 spawn `llama-completion.exe` + 阻塞等全文，50 字回复 5–10 秒起步，**无流式、无多轮历史** | `local_llama.rs:250,290`（`wait_with_output`）；`LOCAL_LLM.md:127-131` |
| 3 | **没用 chat template**：prompt 是 `system + "\n\n" + user` 裸拼，无 `--jinja`——instruct 模型的回复质量低于应有水平，`clean_output` 还得手工剥 `<end_of_turn>` | `local_llama.rs:189-197`、`:368-383` |
| 4 | **唯一调优旋钮是系统环境变量**：改 GPU 层数要开 PowerShell 设 `LLAMA_N_GPU_LAYERS` 再重启；默认 24 是针对 4GB 卡手调的经验值 | `local_llama.rs:203-211`；`LOCAL_LLM.md:107-111` |
| 5 | **模型路径靠手打**：设置里是一个纯文本输入框，无文件选择器 | `ProviderEditor.tsx:185-193` |
| 6 | **无任何硬件探测**：仅 `available_parallelism()` 取逻辑核数；无显存、无内存、无厂商识别 | `local_llama.rs:199-201`；Cargo.toml 无 sysinfo/nvml |
| 7 | **无 GGUF 解析**：只 `is_file()` 校验，选错文件要等子进程失败后翻日志 | `local_llama.rs:169-176` |
| 8 | **macOS 无路可走**：二进制查找只认 `.exe`，无平台分支，UI 却不隐藏入口 | `local_llama.rs:129-140` |
| 9 | 死角一堆：`enable_thinking` 开关 UI 有、后端从不读（勾了没效果）；前端硬编码 `nCtx:1024/maxTokens:256` 与 Rust 默认 2048/512 不一致；300 秒超时线程正常请求也残留、PID 复用可能误杀；硬编码开发机路径 `D:\Tools\llama-cuda`；三个废弃构建脚本与过期 i18n 文案 | `local_llama.rs:33`、`ai.ts:444-446`、`local_llama.rs:279-296,138`、`scripts/patch-llama-sys-build.ps1` 等 |

文档里那张「显存 → 推荐 GPU 层数」表（`LOCAL_LLM.md:101-105`）就是 0.6.0 要变成代码的东西——
它今天只存在于文档里，要用户自己看、自己算、自己设环境变量。

## 2. 主题与总路线

主题：**「本地模型即插即用」——选一个文件，剩下的交给应用。**

四条主线。关键架构决策一个：**推理从「一次性子进程」升级为「llama-server 常驻子进程」**，
流式、多轮、chat template、模型常驻四个老大难随这一步全部消失（llama-server 暴露
OpenAI 兼容接口，而 Spoor 的 `openai_compatible_chat_stream` 通道现成，`127.0.0.1`
在密钥 URL 白名单里本来就放行——前端分派几乎可以复用既有代码）。

### 主线 A：引擎随包 + 常驻服务（架构升级，本版地基）

1. **CPU 版引擎随安装包分发**：CI 构建时从 llama.cpp Releases 拉取**钉死版本**（如 b8763，
   sha256 校验）的 CPU build，经 Tauri `resources` 打进安装包（Windows CPU zip ~30MB、
   macOS Metal zip ~15MB，安装包从 ~10MB 涨到 ~40MB，可接受）。**装完即可跑，零下载零部署**。
2. **NVIDIA 一键 GPU 加速，双入口**（按用户核对意见定稿）：
   - 入口一：**选择本地 GGUF 文件时**，探测到 NVIDIA 卡且未装加速包 → 当场提示
     「可启用 GPU 加速（下载约 500MB），跳过则先用 CPU 运行」——提示不阻塞，跳过即用 CPU；
   - 入口二：大模型设置里独立的「本地推理引擎」区块——引擎版本、后端（CPU/CUDA/Metal）、
     **安装状态检测**、下载/重新下载/校验按钮，随时后补。
   下载到 `SpoorData/llama/`（sha256 钉死、失败可重试、进度事件走既有
   `data-root-migrate-progress` 的模式）。用户手动放置二进制的旧路径保留兼容。
3. **macOS Metal 随包**：mac 的 llama.cpp build 自带 Metal 且体积小，直接进 .app bundle
   （运行时下载的二进制会被 Gatekeeper quarantine，mac 必须随包）。`find` 逻辑加平台分支。
4. **llama-server 生命周期管理**（新 `llama_server.rs`）。按用户核对意见定稿的策略——
   **按需启动 + 空闲整体退出，不是应用级常驻**，只用在线 API 的用户成本严格为零：
   - 只在「当前服务商是本地模型 && 真的发起对话」时 spawn
     `llama-server -m <gguf> --port <随机> -ngl <N> -c <N> --jinja`，应用启动从不预热；
   - 空闲计时到点后**整个进程退出**，内存/显存完全归还；「模型保留时长」可配：
     对话结束立即退出 / 5 分钟 / 15 分钟（默认）/ 30 分钟 / 会话期常驻；
   - 空闲期间本身消耗 ≈0（事件循环睡眠），成本只有内存占用，且权重 mmap 加载、
     内存压力下由 OS 自动回收干净页；
   - 切换回在线服务商立即卸载；设置区实时显示「本地引擎：运行中（占用 X GB）/未运行」
     + 手动卸载按钮；
   - 模型/参数变更时重启；应用退出杀进程 + 启动时清理孤儿（PID 文件）；
   - 对话走 `http://127.0.0.1:<port>/v1/chat/completions`——**流式与多轮历史直接继承
     openai 分支的全部现有能力**，`enable_thinking` 映射到 `chat_template_kwargs`（死开关复活）。
5. 旧的一次性 `local_llama_chat` 通道在 server 就绪后删除（连同 300 秒超时线程 bug、
   两套默认值不一致、裸拼 prompt——整批问题随架构一起退役）。

### 主线 B：选文件即用（目标的字面兑现）

6. **GGUF 文件选择器**：`userfile.rs` 补 `user_file_pick_open_path`（`*.gguf` filter，
   Rust 侧弹框、路径进白名单——与 0.4.0 建立的写入白名单同一范式）。设置 UI 的手打
   输入框换成「选择模型文件…」按钮 + 已选文件卡片。
7. **GGUF 元数据解析**（新 `gguf.rs`，纯 Rust 读 header，不引依赖）：magic/version/
   metadata KV——架构名、参数规模、量化类型、**block_count（层数）**、训练上下文长度、
   内嵌 chat template 有无。命令 `gguf_inspect(path)`。选错文件（非 GGUF/损坏）**当场报**，
   不再等子进程失败翻日志。合成 GGUF 二进制写单测。
8. **模型卡**：选完文件立即显示「Qwen3-8B · Q4_K_M · 4.7GB · 36 层 · 训练上下文 32K」。

### 主线 C：硬件感知的自动参数（本版核心新增）

9. **硬件探测**（新 `hardware.rs`）：
   - 内存与 CPU 物理核数：`sysinfo` crate（逻辑核开满在超线程下反而慢，取物理核）；
   - 显存（Windows）：DXGI（`windows` crate 加 `Win32_Graphics_Dxgi` feature）枚举适配器，
     取**专用显存最大**的独显，`QueryVideoMemoryInfo` 拿当前预算（桌面已占的 1GB+ 必须
     扣掉——文档 `LOCAL_LLM.md:113` 早就点名这个坑）；NVIDIA 时用 `nvidia-smi` 精化
     （装驱动必有，零依赖）；
   - macOS：统一内存架构，按物理内存 × 0.7 计可用「显存」；
   - 命令 `hardware_probe()`，结果缓存一次、设置页可手动刷新。
10. **自动参数算法**（纯函数，Rust + 单测穷举各档硬件 × 模型组合）：
    - `n_gpu_layers`：每层大小 ≈ 文件大小 / block_count；可放层数 =
      (可用显存 − KV cache 预算 − ~512MB 运行余量) / 每层大小；≥ 总层数 → 全量 offload；
      无独显 → 0。把文档里那张人肉表变成代码。
    - `n_ctx`：目标 4096 起，按剩余显存/内存与模型训练上下文取 min，KV cache 按元数据估算；
    - `n_threads`：物理核数；`max_tokens`：默认 1024。
    - 输出完整方案：各参数 + 预估显存/内存占用 + **「装得下 / 装不下，建议 Q4 量化或
      降低层数」的事前判定**。
11. **手动覆盖 UI**：自动方案下方「高级参数」折叠面板——GPU 层数 / 上下文 / 线程数 /
    最大生成长度，每项显示自动值、可改、「恢复自动」一键还原。配置字段进
    `AIProviderProfile`（`localNGpuLayers` 等，`auto` 哨兵值；`aiConfig` 的
    normalize/迁移同步）。环境变量 `LLAMA_N_GPU_LAYERS` 保留为最高优先级兼容旧用户。
12. **OOM 自愈**：server 启动失败且判定为显存不足时，自动降 25% 层数重试一次并提示
    「已按实际显存回退到 N 层」；连通性测试改为 server health 探活（不再真跑一轮 5–10 秒推理）。

### 主线 D：清理与文档（贯穿）

13. 删废弃脚本（`patch-llama-sys-build.ps1`、`sync-llama-cpp-sys-vendor.cmd`、
    `copy-binaries.ps1` 含个人硬编码路径）；`cargo-tauri-dev-build.cmd` 去掉
    LIBCLANG/CUDA 残留；硬编码 `D:\Tools\llama-cuda` 收进 `#[cfg(debug_assertions)]`。
14. 修过期文案：i18n `local_llama_hint` 还在讲 LLVM/bindgen（内嵌时代遗物）、
    `lib.rs:346` 注释与实现不符。
15. **LOCAL_LLM.md 重写**：正文变成「选文件 → 直接用」两步 + GPU 加速说明；
    12 个 DLL 手工复制、PowerShell 环境变量、命令行复现全部降级为排障附录。
16. macOS 无引擎/低配机器的降级路径明确化：引擎缺失时设置区给出一句人话 + 一键修复入口，
    而不是让用户撞一条 Windows 味的报错。

## 3. 推荐取舍

如果只能做一半，做 **A + B + C 的第 9/10/11 条**：
引擎随包 + server 常驻是「即插即用」的地基，没有它选文件再顺也是空谈；
选文件与自动参数是用户目标的字面内容。C12（OOM 自愈）与 D 线可顺延。

> 建议**不进** v0.6.0：模型下载市场（在应用里浏览/下载 Hugging Face 模型——
> 一整个产品面，且与「用户自备文件」的定位不冲突）、本地多模态（mtmd 图像输入）、
> LoRA 适配器、多模型同时常驻、Linux（沿用既定不做）。

## 4. 风险

| 风险 | 说明 | 对策 |
|------|------|------|
| llama.cpp 上游变动 | server 参数/接口随版本漂移 | 钉死 release 版本 + sha256；升级引擎版本走独立 PR 跑回归 |
| 显存探测的坑 | 多 GPU、核显+独显（笔记本 Optimus）、共享显存 | 取专用显存最大的适配器；UI 显示所选 GPU；提供「禁用 GPU」开关兜底 |
| 自动参数算错 → OOM | 估算模型每层大小有误差 | 预算保守（留 512MB 余量）+ OOM 识别后自动降层重试一次 + 手动覆盖永远在 |
| 安装包体积与杀软 | 随包 exe 子进程可能触发误报 | CPU 版仅 ~30MB；官方产物原样分发不改名；文档写明来源与校验值 |
| GPU 包下载失败 | 500MB、网络环境复杂 | 可重试 + 允许手动下载放置（保留旧查找路径）+ 失败不影响 CPU 路径 |
| server 进程泄漏 | 崩溃/强杀后孤儿进程占着模型内存 | PID 文件 + 启动时清理 + 退出钩子；端口随机避免冲突 |
| macOS 未签名 | 随包二进制随 .app 一起未签名，Gatekeeper 对 bundle 内文件放行随主程序 | 维持现有「右键打开」路径；不做运行时下载执行 |

## 5. 参考

- [ROADMAP_v0.5.0.md](./ROADMAP_v0.5.0.md) · [LOCAL_LLM.md（现行，将重写）](../guide/LOCAL_LLM.md)
- [llama.cpp Releases（预编译产物命名规律）](https://github.com/ggml-org/llama.cpp/releases)
- [llama-server（OpenAI 兼容接口）](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [GGUF 格式规范 v3](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)
