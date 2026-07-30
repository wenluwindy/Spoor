# 将 GitHub 仓库改名为 `spoor`

## 在 GitHub 上操作

1. 打开：https://github.com/iimorning/scribe-ai-canvas/settings  
   （若已改过名，用当前仓库的 Settings 即可）
2. **General** → **Repository name**
3. 填入：**`spoor`**
4. 点 **Rename**
5. 可选：**About** → Description：`雪泥 · Spoor — 本地优先空间便签画布`

旧地址 `github.com/iimorning/scribe-ai-canvas` 会自动跳转到 `github.com/iimorning/spoor`。

---

## 本机 Git 远程

```powershell
git remote set-url origin https://github.com/iimorning/spoor.git
git remote -v
```

---

## 说明

- 仓库 slug 用 **`spoor`**，简短好记；中文品牌名放在 Description / README 即可。
- **未改：** `scribe-ai-canvas.netlify.app`（Netlify 域名，与 GitHub 仓库名无关）。
