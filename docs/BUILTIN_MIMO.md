# 内置 MiMo API Key（托管给所有用户）

当前托管 Key 计划于 **2026-06-01** 到期；设置页会对用户显示该提醒。

## 原理

构建时通过环境变量 `VITE_BUILTIN_MIMO_API_KEY` 写入前端包。用户**未在设置里填写** MiMo 密钥时，`callUniversalAI` 自动使用该 Key 调用小米 Token 套餐 API。

- 用户自填 Key **优先**（可覆盖内置 Key）
- 网页仍走 `/api/mimo` 代理（仅解决跨域，不隐藏 Key）
- **密钥会出现在 `dist` JS 里**，任何人可在浏览器开发者工具或下载的桌面安装包中提取 — 仅适合你愿意承担额度被盗用的场景

## 配置步骤

### 本地 / 桌面打包

在项目根目录创建 `.env.local`（已在 `.gitignore`，勿提交）：

```env
VITE_BUILTIN_MIMO_API_KEY=tp-你的密钥
```

然后：

```bash
npm run build          # 网页
npm run tauri:build    # Windows 安装包
```

### Netlify（网页）

1. **Site configuration → Environment variables**
2. 新增 `VITE_BUILTIN_MIMO_API_KEY` = `tp-...`
3. **必须重新构建**（Drop 上传需在本机 `npm run build` 后再拖 `dist`）

### 不设内置 Key

不配置该变量即可，行为与之前相同：用户必须在设置中粘贴自己的 tp- 密钥。

## 安全提示

- 不要将真实 Key 提交到 Git
- Key 泄露后请在小米控制台轮换
- 无用量限制 = 被盗用后账单风险由你承担；若以后要限流需改为服务端代理（非本方案）
