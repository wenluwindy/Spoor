# 桌面端本地大模型（llama.cpp / GGUF）

本文说明桌面版（Windows / macOS）如何使用本地 GGUF 模型。0.6.0 起推理引擎
（llama.cpp 的 `llama-server`）随安装包分发，**不需要任何手工部署**：选一个
`.gguf` 文件就能用，运行参数按你的硬件自动设定。

> **网页版（仅浏览器）**：不走 Tauri，无法调用本地推理；请使用在线 API 服务商。

---

## 1. 三步用起来

### ① 准备一个 .gguf 模型文件

任何 llama.cpp 兼容的 `.gguf` 都行（Qwen、Gemma、Llama 等）。下载渠道：

- [Hugging Face](https://huggingface.co/models?library=gguf)：搜「模型名 + GGUF」，
  常用的量化仓库有 bartowski、unsloth、lmstudio-community；
- 国内网络可用 [魔搭 ModelScope](https://modelscope.cn/models?libraries=GGUF)。

**推荐量化：Q4_K_M**——速度与质量的平衡点，也是各仓库的默认推荐。文件大小
可以按内存/显存粗估：模型能不能跑、跑多快，选完文件后应用会直接告诉你（见下）。

### ② 在应用里选择文件

**设置 → 模型服务**，服务商选 **「本地 GGUF（llama.cpp，仅桌面）」**，点
**「选择模型文件…」** 选中刚下载的 `.gguf`。不需要 API Key。

选完立即出模型卡（名称、量化、大小、层数、训练上下文），文件不对当场报错
（不是 GGUF / 版本不支持 / 文件不见了），不用等到对话失败再翻日志。

### ③（可选）NVIDIA 一键 GPU 加速

Windows 上探测到 NVIDIA 显卡时，选完模型会提示 **「启用 GPU 加速（约
500MB）」**——点一下自动下载 CUDA 版引擎（sha256 校验，装到数据目录
`SpoorData/llama/cuda/`），失败可重试，跳过则先用 CPU 运行，随时可以到
**设置 → 模型服务 → 本地推理引擎** 区块后补。

macOS 随包引擎自带 Metal 加速，无需任何操作。

---

## 2. 参数自动设定与手动覆盖

每次对话前，应用按 **GGUF 元数据 + 本机硬件**（显存、内存、物理核数）现算
一套运行参数：GPU 层数、上下文窗口、线程数、最大生成长度，并给出预估
显存/内存占用与「全 GPU / 部分 GPU / 纯 CPU / 装不下」的事前判定——装不下
会直接建议换更小的量化，而不是让你等加载失败。

要手调的话，展开 **「高级参数（逐项覆盖自动值）」**：每项显示自动值、可以
单独覆盖、随时「恢复自动」。显存不足导致启动失败时，应用会自动降 25% GPU
层数重试一次。

**模型保留时长**：引擎按需启动、空闲自动退出，只用在线 API 时本地推理的
开销严格为零。可选 用后即退 / 5 分钟 / 15 分钟（默认）/ 30 分钟 / 会话期
常驻；「本地推理引擎」区块实时显示驻留状态，也可手动卸载。模型驻留期间
对话不用重新加载，流式输出与多轮历史与在线服务商完全一致。

---

## 3. 排障附录

### 3.1 日志

llama-server 的启动命令行与完整输出追加写在：

```
%TEMP%\spoor_llama_server.log
```

（macOS 在 `$TMPDIR/spoor_llama_server.log`。）旧的一次性子进程通道写
`%TEMP%\spoor_llama.log`，该通道将在 server 架构稳定后移除。

### 3.2 引擎找不到 / 想用自己的引擎

设置区提示「本机没有找到可用的推理引擎」说明安装包不完整（或被杀毒软件
隔离了 `llama-server.exe`——官方预编译产物原样分发，可对 llama.cpp Releases
的 sha256 自行核验）。修复：重装应用，或手动下载引擎放到应用能找到的位置。

引擎查找顺序（第一个存在的生效）：

1. 环境变量 `LLAMA_SERVER_PATH`（指向任意位置的 `llama-server(.exe)`，排障
   与尝鲜新版引擎用）；
2. `SpoorData/llama/cuda/`（应用内 GPU 加速包的安装位置）；
3. 安装包自带的引擎（安装目录 `llama/` 下；macOS 在 .app 内按架构分目录）；
4. 旧版兼容位置（`spoor.exe` 同目录及其 `bin/`、`llama-binaries/` 子目录）。

手动放置时注意：`llama-server(.exe)` 必须和它的动态库（Windows 全部
`.dll`，macOS 全部 `.dylib`）放在同一目录。当前钉死的引擎版本：
[llama.cpp b8763](https://github.com/ggml-org/llama.cpp/releases/tag/b8763)，
Windows CPU 包 `llama-b8763-bin-win-cpu-x64.zip`、CUDA 包
`llama-b8763-bin-win-cuda-12.4-x64.zip` + `cudart-llama-bin-win-cuda-12.4-x64.zip`。

环境变量 `LLAMA_N_GPU_LAYERS` 仍被尊重为 GPU 层数的最高优先级（老用户
兼容），一般情况下用设置里的「高级参数」即可，不必再碰它。

### 3.3 命令行复现

怀疑是应用的问题时，用日志里 `[spawn]` 行的参数直接跑引擎：

```powershell
& "<引擎路径>\llama-server.exe" -m "D:\Models\xxx.gguf" `
  --port 8080 --host 127.0.0.1 -ngl 24 -c 4096 -t 8 --jinja --no-webui
```

起来后访问 `http://127.0.0.1:8080/health` 应返回 200，再用任意 OpenAI
兼容客户端发 `/v1/chat/completions` 请求。stderr 关键行：

| 看到 | 含义 |
|---|---|
| `found 1 CUDA devices` | GPU 检测成功 |
| `cudaMalloc failed: out of memory` | 显存不够——应用会自动降层重试；手动跑时调低 `-ngl` |
| `failed to load model` | 模型路径错误或文件损坏 |

### 3.4 常见错误

| 现象 | 说明 |
|---|---|
| `oom` | 显存不足。应用已自动降 25% 层数重试过；仍失败就在高级参数里降 GPU 层数或换小量化 |
| `health_timeout` | 引擎起来了但 120 秒内没就绪，多半是模型太大加载慢或磁盘慢；看 3.1 的日志 |
| `model_not_found` | 模型文件被移动/删除，重新选择 |
| `model_filename_nonascii` | Windows 限定：GGUF **文件名**含中文等非 ASCII 字符（所在目录是中文没关系），把文件重命名为英文/数字后重新选择 |
| `engine_not_found` | 见 3.2 |
| 杀毒软件报警 | 随包 `llama-server.exe` 是 llama.cpp 官方预编译产物，未做任何修改；可按 3.2 的资产名去官方 Releases 核对 sha256 |

---

## 4. 代码定位

| 文件 | 作用 |
|---|---|
| `src-tauri/src/engine.rs` | 引擎查找（上面那个顺序）、后端识别（cpu/cuda/metal）、CUDA 包下载安装 |
| `src-tauri/src/llama_server.rs` | llama-server 生命周期：按需启动、健康检查、空闲看门狗、孤儿清理、日志 |
| `src-tauri/src/gguf.rs` | 纯 Rust 读 GGUF header：架构、量化、层数、训练上下文 |
| `src-tauri/src/hardware.rs` | 硬件探测：显存（DXGI/nvidia-smi）、内存、物理核数 |
| `src/services/localModelPlanner.ts` | 自动参数规划（纯函数）：元数据 + 硬件 → GPU 层数/上下文/线程/预估占用 |
| `src/services/ai.ts` | `callLocalLlama`：ensure server → 走 OpenAI 兼容接口，OOM 降层重试 |
| `src/components/settings/LocalModelSection.tsx` | 设置 UI：文件选择、模型卡、自动参数、高级面板、引擎区块 |
| `scripts/fetch-llama-engine.ps1` | 开发机一键拉取 CPU 引擎到 `src-tauri/resources/llama/`（与 CI 同逻辑） |

CI 如何把引擎打进安装包见 `.github/workflows/release-desktop.yml` 的
「Bundle llama.cpp …」步骤；为什么用子进程而不是 Rust binding、为什么从
一次性子进程升级为常驻 server，见 `docs/dev/ROADMAP_v0.6.0.md`（历史踩坑
记录在 git 历史里的旧版本文档）。
