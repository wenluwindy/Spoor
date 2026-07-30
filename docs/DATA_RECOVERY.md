# Tauri 桌面端数据恢复说明

## 原因（已确认）

项目曾用 Tauri 标识 **`com.spatialnodes.app`**（产品名 SpatialNotes），后改为 **`com.spoor.app`**（雪泥 / Spoor）。

Windows 上 WebView2 数据按标识分目录存放：

| 标识 | 数据目录 | 你的情况 |
|------|----------|----------|
| `com.spatialnodes.app` | `%LOCALAPPDATA%\com.spatialnodes.app\` | **旧数据在这里**（IndexedDB 最后更新约 5/21） |
| `com.spoor.app` | `%LOCALAPPDATA%\com.spoor.app\` | **当前 dev 用的是空库 + 演示种子**（约 5/22 新建） |

画布数据在 IndexedDB 库名 **`CortexLocalDB`**，路径示例：

```
%LOCALAPPDATA%\com.spatialnodes.app\EBWebView\Default\IndexedDB\http_localhost_3000.indexeddb.leveldb
```

数据没有被删，只是换了一个「应用身份证」，桌面端读不到旧文件夹。

---

## 方法一：复制旧库到新目录（推荐）

1. **完全退出** Tauri 窗口和 `npx tauri dev`（否则文件被占用无法覆盖）。
2. 在项目根目录 PowerShell 执行：

```powershell
.\scripts\restore-tauri-data-from-spatialnodes.ps1
```

3. 再运行 `npx tauri dev`，画布应恢复。

脚本会先把当前 `com.spoor.app` 的 `Default` 备份为 `Default.backup-时间戳`，再从旧目录复制 IndexedDB。

---

## 方法二：临时改回旧 identifier（最快验证）

编辑 `src-tauri/tauri.conf.json`：

```json
"identifier": "com.spatialnodes.app"
```

保存后 `npx tauri dev`，应直接看到旧数据。确认无误后再用**方法一**迁到 `com.spoor.app`，或长期保持旧 identifier（与安装包标识一致即可）。

---

## 手动在资源管理器中查看旧数据

1. `Win + R` → 输入 `%LOCALAPPDATA%\com.spatialnodes.app`
2. 进入 `EBWebView\Default\IndexedDB`
3. 看 `http_localhost_3000.indexeddb.leveldb` 文件夹大小与修改时间（有实质 `.ldb` / `.log` 即仍有数据）

---

## 以后避免再「丢」

- 改 `identifier` / 产品名前先 **导出** 或备份 `%LOCALAPPDATA%\com.xxx.app` 整目录。
- 或实现应用内「导出/导入画布 JSON」（尚未内置）。
