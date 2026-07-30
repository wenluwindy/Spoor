# 手动发布 GitHub Release（Actions 不可用时）

当 GitHub 提示 **account is locked due to a billing issue** 时，CI 无法跑。请先在  
https://github.com/settings/billing  解决账单，再改用 Actions；或按下面步骤**手动上传**本机已打好的安装包。

## 1. 确认本机安装包存在

```
release\Spoor_0.1.0_x64-setup.exe
```

若没有，在项目根目录执行：

```bat
npm run tauri:build
copy src-tauri\target\release\bundle\nsis\Spoor_0.1.0_x64-setup.exe release\
```

## 2. 在 GitHub 网页创建 Release

1. 打开：https://github.com/iimorning/spoor/releases/new  
2. **Choose a tag:** `v0.1.0`（已存在）  
3. **Release title:** `Spoor 雪泥 v0.1.0`  
4. **Description:** 复制 [`docs/RELEASE_v0.1.0.md`](../docs/RELEASE_v0.1.0.md) 正文  
5. **Attach binaries:** 拖入 `release\Spoor_0.1.0_x64-setup.exe`  
6. 点击 **Publish release**

## 3. 用户下载链接

https://github.com/iimorning/spoor/releases/latest

## 4. 恢复自动构建（可选）

账单恢复后，重新打标签即可触发 workflow：

```powershell
git push origin :refs/tags/v0.1.0
git tag -d v0.1.0
git tag -a v0.1.0 -m "Spoor 雪泥 v0.1.0"
git push origin v0.1.0
```
