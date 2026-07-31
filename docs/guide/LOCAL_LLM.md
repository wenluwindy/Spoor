# 桌面端本地大模型（llama.cpp / GGUF）参考手册

本文档说明 **Windows + Tauri 桌面版** 下如何启用本地 GGUF 推理（适用于 Gemma、Qwen、Llama 等所有 llama.cpp 兼容权重）。

> **网页版（仅浏览器）**：不走 Tauri，无法调用本地推理；请使用在线 API 服务商。

---

## 目录

- [桌面端本地大模型（llama.cpp / GGUF）参考手册](#桌面端本地大模型llamacpp--gguf参考手册)
  - [目录](#目录)
  - [1. 当前架构（重要）](#1-当前架构重要)
  - [2. 部署：用户使用前的准备](#2-部署用户使用前的准备)
    - [2.1 准备 GGUF 模型](#21-准备-gguf-模型)
    - [2.2 准备 llama.cpp 预编译二进制](#22-准备-llamacpp-预编译二进制)
    - [2.3 在应用里启用](#23-在应用里启用)
  - [3. 性能调优](#3-性能调优)
    - [3.1 GPU 层数（最关键）](#31-gpu-层数最关键)
    - [3.2 上下文 / 生成长度](#32-上下文--生成长度)
    - [3.3 实测速度参考（i5-9300H + GTX 1650 4G + Gemma 4 E4B Q4\_K\_M）](#33-实测速度参考i5-9300h--gtx-1650-4g--gemma-4-e4b-q4_k_m)
  - [4. 日志（出问题先看这里）](#4-日志出问题先看这里)
  - [5. 命令行手动复现](#5-命令行手动复现)
  - [6. 踩坑总结（按时间顺序）](#6-踩坑总结按时间顺序)
    - [6.1 构建期：MSVC / libclang / CMake / CUDA](#61-构建期msvc--libclang--cmake--cuda)
    - [6.2 运行期：Tauri ↔ Rust ↔ 子进程](#62-运行期tauri--rust--子进程)
    - [6.3 性能 / GPU](#63-性能--gpu)
  - [7. 编译应用本身](#7-编译应用本身)
  - [8. 代码定位](#8-代码定位)
  - [9. 附录：历史方案（已弃用）](#9-附录历史方案已弃用)

---

## 1. 当前架构（重要）

| 组件 | 角色 |
|---|---|
| **`llama-completion.exe`**（预编译）+ CUDA DLL | 实际推理引擎，每次对话由 Rust 端 spawn 子进程 |
| `src-tauri/src/local_llama.rs` | 组装命令行参数、管理临时 prompt 文件、捕获输出、写日志、超时保护 |
| `src-tauri/src/lib.rs` | Tauri 命令 `local_llama_chat`、`get_local_llama_log_path` |
| `src/services/ai.ts` | 前端 `provider === 'local_llama'` 分支，invoke 上面的命令 |

**为什么是 subprocess 而不是 Rust binding？** 我们一开始用 `llama-cpp-2` crate 直接链入，但在 Windows + CUDA 上踩了一连串坑（见 [§6](#6-踩坑总结按时间顺序)、[§9](#9-附录历史方案已弃用)）。最终改用官方预编译二进制，**应用本身完全不需要 LLVM、CMake、CUDA Toolkit、libclang**，只要 Rust + MSVC 就能编译。

---

## 2. 部署：用户使用前的准备

### 2.1 准备 GGUF 模型

任意 llama.cpp 兼容的 `.gguf` 即可。例：

- Gemma 4 E4B Q4_K_M：`D:\Models\google_gemma-4-E4B-it-Q4_K_M.gguf`
- 推荐量化：**Q4_K_M**（速度/质量平衡）

### 2.2 准备 llama.cpp 预编译二进制

到 [llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) 下载（注意匹配你的 CUDA 主版本）：

| 包名 | 内容 |
|---|---|
| `llama-bxxxx-bin-win-cuda-12.4-x64.zip` | `llama-completion.exe` `llama-cli.exe` `ggml*.dll` `llama.dll` 等 |
| `cudart-llama-bin-win-cuda-12.4-x64.zip` | `cudart64_12.dll` `cublas64_12.dll` `cublasLt64_12.dll` |

**把以下文件全部复制到 `<exe_dir>`**（与 `spoor.exe` 同目录，或 dev 模式下 `src-tauri/target/release/`）：

```
llama-completion.exe   ← 主程序，新版必备
llama-cli.exe          ← 兼容回退
llama.dll
ggml.dll
ggml-base.dll
ggml-cpu-haswell.dll
ggml-cuda.dll          ← GPU 加速核心
ggml-rpc.dll
mtmd.dll
libomp140.x86_64.dll
cudart64_12.dll        ← 来自 cudart 包
cublas64_12.dll
cublasLt64_12.dll
```

> 应用内置的搜索顺序：`LLAMA_CLI_PATH` 环境变量 → `<exe_dir>` → `<exe_dir>/bin` → `<exe_dir>/llama-binaries` → `D:\Tools\llama-cuda\`（仅 dev fallback）。可以通过 `LLAMA_CLI_PATH` 指向任意位置的 `llama-completion.exe`。

### 2.3 在应用里启用

1. 打开桌面应用。
2. **设置** → AI 服务商 → **「本地 GGUF（llama.cpp，仅桌面）」**。
3. **GGUF 模型文件路径**：填绝对路径，例如 `D:\Models\google_gemma-4-E4B-it-Q4_K_M.gguf`。
4. 不需要 API Key。
5. 直接对话即可。

---

## 3. 性能调优

### 3.1 GPU 层数（最关键）

环境变量 **`LLAMA_N_GPU_LAYERS`** 控制卸载到 GPU 的层数：

| 显存 | 推荐值 | 说明 |
|---|---|---|
| 8GB+ | `999` | 全部卸载，最快 |
| 4GB（GTX 1650/1660） | **`24`（默认）** 或 16-20 | Gemma 4B 共 ~34 层，24 层 ≈ 70% 卸载 |
| 仅 CPU / 无独显 | `0` | 完全 CPU 推理 |

设置（PowerShell，重启应用生效）：

```powershell
[Environment]::SetEnvironmentVariable("LLAMA_N_GPU_LAYERS", "24", "User")
```

> **为什么默认不是 999？** 把 4B Q4_K_M 全部加载到 4GB 卡需要约 2.9GB 显存，再加上 Windows 桌面 + 浏览器/IDE 已占的 1GB+，**直接 OOM 加载失败**。24 层是经过实测的稳妥值。

### 3.2 上下文 / 生成长度

在 `src/services/ai.ts` 的 `invoke('local_llama_chat', { payload })` 里：

| 参数 | 默认 | 说明 |
|---|---|---|
| `nCtx` | `1024` | 上下文窗口，越大越占显存/内存 |
| `maxTokens` | `256` | 单次最多生成 token，越大回复越长但越慢 |
| `temperature` | `0.7` | 随机性 |

### 3.3 实测速度参考（i5-9300H + GTX 1650 4G + Gemma 4 E4B Q4_K_M）

- **GPU 24 层 + 8 线程**：prompt eval ≈ 84 t/s，generation ≈ 11 t/s
- 50 字短回复 ≈ 5–10 秒（含模型加载）
- 200 字长回复 ≈ 15–25 秒

> 注意：subprocess 模式 **每次对话都会重新加载模型**（无法常驻内存）。这是简化架构的代价。如果想要常驻，请改用 `llama-server` HTTP 模式（未来可加）。

---

## 4. 日志（出问题先看这里）

每次推理都会把**完整命令行、stdout、stderr、退出码、耗时**写入：

```
%TEMP%\spoor_llama.log
```

打开方式：

```powershell
notepad $env:TEMP\spoor_llama.log
# 或在文件资源管理器地址栏输入 %TEMP% 找到 spoor_llama.log
```

日志格式（每次一段）：

```
========== [2026-05-08 14:23:11Z] REQUEST ==========
user_message_len=12 system_len=87 model_path=D:\Models\xxx.gguf

========== [2026-05-08 14:23:11Z] COMMAND ==========
exe   : ...\llama-completion.exe
model : D:\Models\xxx.gguf
ctx   : 1024
predict: 256
gpu_layers: 24
threads: 8
prompt_file: %TEMP%\spoor_llama_prompt_xxx.txt
prompt_preview: 你是谁

========== [2026-05-08 14:23:19Z] RESULT ==========
exit_status: exit code: 0
elapsed_ms: 8120
stdout_len: 245
stderr_len: 1822
--- stdout (head 4000) ---
我是 Gemma，由 Google DeepMind 训练的开源大语言模型...[end of text]
--- stderr (tail 4000) ---
ggml_cuda_init: found 1 CUDA devices ...
[ Prompt: 84.4 t/s | Generation: 10.9 t/s ]
```

文件超过 2 MB 会自动重置（保留最新一次）。错误时前端弹窗也会附带日志路径。

---

## 5. 命令行手动复现

如果应用里不工作，先用命令行直接跑：

```powershell
& "C:\Users\<你>\Desktop\scribe-ai-canvas\src-tauri\target\release\llama-completion.exe" `
  --model D:\Models\google_gemma-4-E4B-it-Q4_K_M.gguf `
  --ctx-size 1024 --threads 8 --n-gpu-layers 24 `
  --temp 0.7 --top-p 0.9 --predict 60 `
  --no-display-prompt --simple-io -no-cnv -st `
  -p "你是谁"
```

观察 stderr 关键信息：

| 看到 | 含义 |
|---|---|
| `found 1 CUDA devices` | GPU 检测成功 |
| `cudaMalloc failed: out of memory` | 显存不够，**调低 `--n-gpu-layers`** |
| `[ Prompt: X t/s \| Generation: Y t/s ]` | 实际推理速度 |
| `failed to load model` | 模型文件路径错误或文件损坏 |

---

## 6. 踩坑总结（按时间顺序）

### 6.1 构建期：MSVC / libclang / CMake / CUDA

| 现象 | 根因 | 解决 |
|---|---|---|
| `Unable to find libclang` | bindgen 找不到 LLVM | 装 LLVM，设 `LIBCLANG_PATH=...\.llvm-min\bin`（已弃用，subprocess 方案不需要） |
| `cl.exe wrapper_oai.cpp 退出码 2` | `llama-cpp-sys-2` 的 `wrapper_oai.cpp` `#include "llama.cpp/common/chat.h"` 需要 crate 根加入 `/I` | vendor 该 crate 并 patch `build.rs`（已弃用） |
| `cmake not found` | 终端未加载 VS 环境 | 必须 `call vcvars64.bat` 后再 cargo build |
| `No CUDA toolset found` | CMake 找不到 CUDA Visual Studio integration | 装 CUDA Toolkit 并勾选 "Visual Studio Integration"（已弃用） |
| `MSB8020: 无法找到 cuda 的生成工具` | MSBuild 与 CUDA 集成断裂，常见且难修 | **放弃源码编译 CUDA**，改用预编译二进制 ⭐ |
| `磁盘空间不足 (os error 112)` | C 盘剩余 < 3GB | 删 `src-tauri\target\debug` 释放空间 |
| `error: failed to remove file 拒绝访问` | 旧 `spoor.exe` 仍在跑 | `taskkill /f /im spoor.exe` 后重编 |
| `bundle.targets = "all"` 时 `tauri build` 卡 timeout | WiX/MSI 工具链下载慢 | `tauri.conf.json` 设 `"bundle.targets": ["nsis"]`，只打 NSIS |

### 6.2 运行期：Tauri ↔ Rust ↔ 子进程

| 现象 | 根因 | 解决 |
|---|---|---|
| `invalid args 'payload' for command 'local_llama_chat': command local_llama_chat missing required key payload` | Tauri v2 默认要求把参数包在 `payload` key 里 | 前端 invoke 改成 `{ payload: { ... } }` |
| 启动 llama-cli 时**弹出黑色控制台窗口**，stdout 没被捕获 | Windows 下 GUI 进程 spawn 控制台子进程默认创建新 console | `Command::creation_flags(0x08000000 /* CREATE_NO_WINDOW */)` |
| llama-cli 进程**永不退出，前端永远转圈** | 新版 llama.cpp 默认进入 conversation/interactive 模式，处理完 prompt 后等用户输入 | 加 `-no-cnv -st` 短形式参数（`--no-conversation` 已被弃用，新版会报错） |
| `error while handling argument "--color": unknown value 'never'` | llama-cli `--color` 只接受 `on/off/auto` | 用 `--color off` 或干脆去掉（`--simple-io` 自带禁色） |
| GUI 把 logo / `>` 提示符 / `[Start thinking]` 思考块当作 AI 回复显示 | 用 `llama-cli` 时 chat-template 输出夹杂了交互界面元素 | 改用 **`llama-completion.exe`**（官方推荐的"单次补全"工具） + `--simple-io` |
| 回复尾部带 `[end of text]` / `<end_of_turn>` | 这些是模型的 EOS 标记，llama-completion 会原样打印 | Rust 端 `clean_output()` 去掉这些标记 |
| Prompt 里有换行/引号/`<>` 时命令行解析出错 | shell argv 转义复杂 | 把 prompt 写到临时文件，用 `-f file.txt` 读 |
| 设置里写的模型路径含中文 | OK，但 `canonicalize` 失败时报错路径乱码 | Rust 端先 `canonicalize`，错误时显示完整路径让用户对照 |

### 6.3 性能 / GPU

| 现象 | 根因 | 解决 |
|---|---|---|
| **3 分钟无响应**（GPU 已开） | 实际是 llama-cli 卡在交互模式（见 §6.2），不是性能问题 | 加 `-no-cnv -st`，问题立即消失 |
| `cudaMalloc failed: out of memory` | 4GB 卡 + 全量卸载（`-ngl 999`）+ 桌面已占用 | 默认改成 `LLAMA_N_GPU_LAYERS=24` |
| GPU 推理速度仍只有 10 t/s 左右 | GTX 1650/1660 是 Turing **无 Tensor Core** 架构 | 这是硬件上限；新增 `CMAKE_CUDA_ARCHITECTURES=...` 重编可略好 |
| 每次对话都要重新加载模型（5-10s 起步） | subprocess 模式无法常驻 | 待办：可改 `llama-server` 长连接 |

---

## 7. 编译应用本身

> **当前方案不需要 LLVM / CMake / CUDA Toolkit。** 只要 Rust 工具链 + MSVC Build Tools。

### 7.1 必装

- **Rust** stable，target = `x86_64-pc-windows-msvc`
- **Visual Studio 2022 Build Tools**，工作负载 **「使用 C++ 的桌面开发」**

### 7.2 构建命令

```bat
scripts\tauri-build-release.cmd
```

脚本只做两件事：

```cmd
call "<VS>\VC\Auxiliary\Build\vcvars64.bat"
call npm run tauri -- build
```

产物：

- `src-tauri\target\release\spoor.exe` — 应用主程序
- `src-tauri\target\release\bundle\nsis\Spoor_x.x.x_x64-setup.exe` — NSIS 安装包

记得**把 §2.2 的 llama.cpp 二进制和 DLL 放到 `target\release\` 下**，否则跑不起来。

---

## 8. 代码定位

| 文件 | 作用 |
|---|---|
| `src-tauri/src/local_llama.rs` | 组装 llama-completion 命令行、运行子进程、写日志 `%TEMP%\spoor_llama.log`、5 分钟硬超时 |
| `src-tauri/src/lib.rs` | Tauri 命令 `local_llama_chat`、`get_local_llama_log_path` |
| `src/services/ai.ts` | 前端 `provider === 'local_llama'` 分支，含调用前后 `console.info` 日志 |
| `src/components/AISettingsModal.tsx` | 设置 UI：本地 GGUF 路径、思考模式开关 |
| `src-tauri/tauri.conf.json` | `bundle.targets: ["nsis"]`（避免 MSI/WiX 麻烦） |

关键参数（`local_llama.rs`）：

```rust
// 默认值
n_ctx        = payload.n_ctx       .unwrap_or(2048);
max_tokens   = payload.max_tokens  .unwrap_or(512);
temperature  = payload.temperature .unwrap_or(0.7);
top_p        = payload.top_p       .unwrap_or(0.9);
n_gpu_layers = env(LLAMA_N_GPU_LAYERS).unwrap_or(24);

// llama-completion 参数
--model … --ctx-size … --threads … --n-gpu-layers …
--temp … --top-p … --predict …
--no-display-prompt --simple-io -no-cnv -st -f <prompt-file>
```

---

## 9. 附录：历史方案（已弃用）

> 这部分仅供存档；当前不再使用。

### 9.1 旧方案：`llama-cpp-2` + 源码 CUDA 编译

- 通过 `[patch.crates-io]` vendor `llama-cpp-sys-2` 到 `src-tauri/third_party/llama-cpp-sys-2`，并 patch 它的 `build.rs`：
  - `.include(Path::new(&manifest_dir))`（解决 `wrapper_oai.cpp` 找不到 `llama.cpp/common/chat.h`）
  - MSVC 下加 `/utf-8`
  - 尝试 `config.define("GGML_CUDA", "ON")`、`config.generator_toolset("cuda")` 等
- 需要 LLVM/libclang（`LIBCLANG_PATH`）+ CMake + CUDA Toolkit + VS-CUDA Integration

**为什么放弃**：

1. CUDA 在 MSBuild + Visual Studio 生成器下经常失败（`MSB8020 无法找到 cuda 的生成工具`），不同 VS/CUDA 版本表现不同，**极难稳定复现成功**。
2. 即便编通，模型常驻内存的优势在前端"每次新对话都重建上下文"的场景里效果有限。
3. 切换 subprocess 后，整个构建链条简化到只需 Rust + MSVC。

如果未来要回到这条路，文件遗留：

- `src-tauri/third_party/llama-cpp-sys-2/`（被 `.gitignore`，需要 `scripts\sync-llama-cpp-sys-vendor.cmd` 重新生成）
- `scripts/cargo-tauri-dev-build.cmd`（含 `LIBCLANG_PATH` / `CUDA_PATH` 的旧版）

### 9.2 旧坑参考

| 旧问题 | 备注 |
|---|---|
| `no variant or associated item named 'False' found for AddBos` | `llama-cpp-2` API：用 `AddBos::Never` |
| `with_flash_attn / with_causal_attn 不存在` | 该版本 binding 没暴露这些 ctx 参数 |

---

*文档对应代码版本：subprocess + llama-completion 方案（2026-05）。*
