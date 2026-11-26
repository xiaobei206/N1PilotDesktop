# N1PilotDesktop 唯一主开发日志（Monaco 分支）

> 本日志从本次可核对的源码包内 CHANGELOG、实际 ZIP、SHA sidecar、当前会话中的用户 Windows 构建日志重建。原始项目长期主日志在当前文件库未找到；因此不声称覆盖所有历史对话。历史来源缺失时明确标注，不用猜测补齐。

## 当前状态

- 当前规范版本：`1.0.3`（Monaco 分支）。
- 当前可信 ZIP：`1.0.3/N1PilotDesktop-1.0.3.zip`。
- 当前源码包 SHA-256：`07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509`。
- ZIP 字节数：268354。
- 当前源码包文件数：42。
- 静态 `npm test`：本次容器执行通过。
- Windows portable 构建、GUI、SSH/SFTP 和 N1 实测：未执行/未确认。
- 唯一项目主说明：`PROJECT-OVERVIEW-CN.md`；唯一跨版本开发日志：本文件。

## 历史版本记录（基于包内变更记录）

### v0.6.x 既有功能阶段（Monaco 分支前序）

源码包保留了 `CHANGELOG-v0.6.1`、`v0.6.4` 至 `v0.6.13` 的独立历史记录，涉及语言修复、Bitvise/本地属性、属性本地化、SSH 标签、交互式 SSH 终端、终端高度/尺寸调整等。当前无法从缺少的统一主日志中恢复每轮对话完整背景；这些文件只作按原文留存的阶段说明。v1.0.0 的 `BASELINE-NOTE.txt` 声明 Monaco 分支沿用用户确认的 v0.6.13 功能基线。

### v1.0.0 — Monaco 远程编辑器初始版本

依据：`CHANGELOG-v1.0.0-monaco-remote-editor.txt`。添加基于 Monaco Editor 0.57.0 的独立远程编辑器窗口，采用本地 ESM/Worker bundle；支持多文件独立窗口、语法高亮和诊断、编码/BOM/换行处理、远程哈希冲突检测、临时文件+备份替换/回滚、加密恢复草稿和窗口几何状态。既有 SSH 终端和主界面保留。原始说明明确静态检查不能替代 Windows 便携 EXE 和真实 SFTP 测试。

### v1.0.1 — 编辑器窗口关闭崩溃修复

依据：`CHANGELOG-v1.0.1-browserwindow-destroyed-fix.txt`。修复 BrowserWindow `closed` 回调访问已销毁 `webContents.id` 可能抛出 Object-destroyed TypeError 的问题；提前缓存 WebContents ID，并在关闭时标记 context closed、取消几何状态计时器、阻止延迟回调访问已关闭 context。历史变更记录的验证边界为 Node 语法检查及两组静态 smoke tests；Windows Electron 运行验证仍需用户执行。

### v1.0.2 — 编辑器保存/关闭可靠性

依据同一变更记录。串行化保存请求，增加 operation ID 和诊断；保存并关闭时保持未保存提示框，保存失败/冲突/保存期间新增编辑时允许重试、丢弃或取消；增加主进程保存事务各阶段日志；退出菜单增加“取消退出/保存草稿并退出/不保存草稿直接退出”。该版本日志没有证明所有 SFTP 请求永不返回的情况都能安全取消。

### v1.0.2.1 hotfix 候选 — SFTP 目录响应和保存诊断

依据：`CHANGELOG-v1.0.2.1-sftp-performance-save-diagnostics.txt`。删除目录浏览冗余 stat；SFTP 通道、只读 stat、编辑器流加等待保护；目录请求和渲染分别计时；DOM 批量插入；选择行不再全量重建；忽略过期目录响应。写操作类 SFTP callback 未统一强制超时，因为超时不能证明服务器没有执行。

### 2026-11-05 — 用户侧 Windows 构建失败根因确认

依据：用户提交的 CMD 完整构建输出。原生属性 helper 编译成功；`npm.cmd install` 显示新增 300 packages，报告 2 vulnerabilities（1 low、1 critical），并提示 `esbuild`、`ssh2`、`electron-winstaller` 安装脚本待审批；两组静态 smoke tests 通过；Monaco bundle 生成（当时有 JSON API namespace 警告）；随后 electron-builder 报 `Invalid version: "1.0.2.1"` 并失败。直接根因是错误候选 `package.json.version` 使用四段式版本号。该日志不是修正后候选或当前 1.0.3 的构建结果。

### fixed hotfix 候选 — 1.0.2-hotfix.1

依据实际 ZIP `N1PilotDesktop-Monaco-v1.0.2.1-hotfix-fixed.zip`。改为合法 SemVer `1.0.2-hotfix.1`，清理 `build.bat` UTF-8 BOM，修正 Monaco JSON diagnostics 命名空间为 `monaco.languages.json.jsonDefaults`，并更新对应静态测试断言。虽然能够解决上述版本格式错误，但外部 ZIP/产物标签仍为 `v1.0.2.1`，内部版本是 `1.0.2-hotfix.1`，不满足项目统一的三段式版本管理。该包没有用户侧构建成功证据。

## 本次 1.0.3 规范化（2026-11-05）

### 目标

建立唯一、可核验的 Monaco 源码基线与交接体系，修复历史版本号混乱；不重构或重写功能。

### 基线证据

- 1.0.1 ZIP：263,777 bytes，SHA-256 `30a0d03592cb6bcdef7e4cb5e523f9435504e6515c71965491884564ca3c7ffd`，内部版本 1.0.1。
- 1.0.2 ZIP：266,844 bytes，SHA-256 `449a53d6454ea041b1485c4da509175c2363e08fc89a3d26f5572a7cdd2c74f8`，内部版本 1.0.2。
- 无效 hotfix ZIP：267,867 bytes，SHA-256 `ec8c61029b99b4d816bdca16d9c7915a47cfa40e184cb99055383a1343ff48ce`，内部版本 1.0.2.1。
- fixed hotfix ZIP：268,782 bytes，SHA-256 `56e85b99626e1c86b2d14e88499fb8721374394d1f4875d5bf7fa84f629f589e`，内部版本 1.0.2-hotfix.1。
- 四包 ZIP CRC 均通过；通过解包比对确认 fixed 候选从 1.0.2.1 hotfix 继续演进，只额外调整构建/JSON API/README/测试等文件，未混入 CodeMirror 分支。

### 修改文件和原因

- `package.json`：`version` 规范为 `1.0.3`；Windows portable artifactName 同步为 `N1PilotDesktop-Monaco-v1.0.3-${arch}.${ext}`。
- `build.bat`：构建完成提示统一为 1.0.3，并确保无 UTF-8 BOM。
- `tests/smoke.js`、`tests/editor-smoke.js`：版本断言统一为 1.0.3。
- `README.md`：增加当前基线/历史候选区分、依赖锁文件缺失和真实验收边界，保留早期功能说明。
- 新增 `CHANGELOG-v1.0.3-baseline-normalization.txt`。
- 新增项目级说明、唯一主日志、HANDOFF、BUILD-REPORT、Windows 验收命令和 SOURCE-MANIFEST。

### 方案与取舍

选择 1.0.3 而不是沿用 `1.0.2.1` 或 `1.0.2-hotfix.1`：该轮属于 v1.0.2 后的修订/性能修复，采用三段式 `1.0.3` 可同时满足 SemVer 和源码包/构建产物一致性。未新增 package-lock，因为候选 ZIP 中没有它，擅自生成 lockfile 会固定一套未经审查的新依赖解析结果；`repair-and-build.bat` 甚至会删除 lockfile。

### 测试结果

- 标准化前 fixed 候选：`npm test` 通过。
- 标准化后 1.0.3：`npm test` 通过（Node v22.16.0、npm 10.9.2，当前容器）。
- 最终 ZIP CRC、SHA256、MANIFEST 全量校验：通过。
- Windows EXE 构建、GUI 和 N1 实测：未执行。

### 当前未解决事项

1. 必须由用户在 Windows 解压 1.0.3 独立目录并运行 `build.bat`，验证 electron-builder 是否继续到真正的 portable artifact 生成。
2. 必须在局域网 N1 上测目录导航速度，收集 `requestElapsedMs` 与 `renderElapsedMs`。
3. 必须复测 `/root/setup_fail2ban.sh` 一类远程文件保存成功/失败/冲突/关闭流程，并提供最后一个 save stage 的完整日志。
4. 评估 npm 审计发现的 2 个 vulnerabilities 和 install-script 审批提示；禁止未经评估 `npm audit fix --force`。
5. 后续单独评估 package-lock 的可重复安装策略。

## 当前精确交付定位

- 源码：`1.0.3/N1PilotDesktop-1.0.3.zip`（268354 bytes）。
- ZIP SHA：`1.0.3/N1PilotDesktop-1.0.3-SHA256.txt`。
- 文件 MANIFEST：`1.0.3/N1PilotDesktop-1.0.3-SOURCE-MANIFEST.sha256`。
- Handoff：`1.0.3/N1PilotDesktop-1.0.3-HANDOFF-CN.md`。
- Build report：`1.0.3/N1PilotDesktop-1.0.3-BUILD-REPORT.md`。
- Windows 命令：`1.0.3/N1PilotDesktop-1.0.3-Windows-验收命令.txt`。
- 项目总览：`PROJECT-OVERVIEW-CN.md`。
- 本唯一主日志：`PROJECT-DEVELOPMENT-LOG-CN.md`。


### 2026-11-05 — 文件库归档同步尝试失败（本地成果保留）

- 已在 Files Library 创建目录骨架：`/N1PilotDesktop/`、`1.0.0/`、`1.0.1/`、`1.0.2/`、`1.0.3/`、`_archive/candidates/`。
- 尝试上传项目总览、主开发日志、1.0.3 源码 ZIP、HANDOFF、BUILD-REPORT、SOURCE-MANIFEST、SHA256 和 Windows 验收命令，共 8 项；每项均返回 `container_session_expired`。
- 单文件重试仍返回相同错误；随后重新列出 `/N1PilotDesktop/`，只看到空目录，没有项目文件。
- 进一步将完整本地整理目录打成 `N1PilotDesktop-Project-Archive-1.0.3.zip`，尝试用已导出的文件快照上传至 `/N1PilotDesktop/_archive/`，Files 服务返回 `throttled`，提示 6 小时后再试；该次没有上传成功。
- 结论：本地归档已生成；Library 文件同步未完成。未删除任何原历史文件，未把空目录标记为同步成功。
- 后续恢复同步时，以本地 `/mnt/data/N1PilotDesktop/` 为本次整理成果，逐项上传并重新列目录核对；不要复用旧 SHA 侧车替代本次文件。


### 2026-11-26 — GitHub 仓库初始化（N1PilotDesktop v1.0.3）

- 建立仓库根目录可直接查看的 Monaco v1.0.3 源码树，保留原始 42 文件源码清单以及中文交接、总览、构建报告、Windows 验收步骤。
- 新增根目录 README 导航、LICENSE、VERSION、GitHub Release 工作流和按 MANIFEST 校验/打包的脚本。
- 本轮本地验证：`npm test` 通过；公开源码密钥模式扫描没有发现匹配项；原始项目归档 ZIP CRC 通过；当前 v1.0.3 源码 ZIP 为 268354 bytes，SHA-256 `07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509`。
- 本轮没有执行 Windows EXE 构建、GUI 启动或 N1 实机 SSH/SFTP 验收。
