> GitHub 仓库版交接补充（2026-11-26）：仓库为 `https://github.com/xiaobei206/N1PilotDesktop`；源码文件在仓库根目录，历史交接和校验文档位于 `docs/`。后续跨对话仍应先读本文件、`docs/PROJECT-DEVELOPMENT-LOG-CN.md`、`docs/PROJECT-OVERVIEW-CN.md`，再阅读当前源码。`npm test` 在本次迁移环境通过，但 Windows EXE、GUI 和真实 N1 SSH/SFTP 尚未通过目标设备验收。GitHub Release 将以 `v1.0.3` tag 为版本标识。

# N1PilotDesktop 1.0.3（Monaco 分支）完整开发交接说明

## 0. 当前结论

- 项目：N1PilotDesktop。
- 分支：Monaco；禁止与 CodeMirror 分支混用。
- 当前规范源码版本：`1.0.3`。
- 当前状态：源码基线已核验并归档；静态 smoke tests 通过；Windows portable EXE、GUI、真实 SSH/SFTP 和 N1 远程保存尚未由本次任务验证。
- 本版性质：从已存在的 fixed hotfix 候选做版本号、构建产物名、构建提示和测试断言的统一规范化；未有意重写功能代码。原始候选 ZIP 保留在 `_archive/candidates/`。

## 1. 跨对话读取顺序（必须执行）

1. 先读取本文件：`N1PilotDesktop/1.0.3/N1PilotDesktop-1.0.3-HANDOFF-CN.md`。
2. 再完整读取唯一主日志：`N1PilotDesktop/PROJECT-DEVELOPMENT-LOG-CN.md`。
3. 再读取总体说明：`N1PilotDesktop/PROJECT-OVERVIEW-CN.md`。
4. 读取当前版本构建报告、Windows 验收命令和 SOURCE-MANIFEST。
5. 实际调取并下载当前源码 ZIP，核对 ZIP 整体 SHA-256、内部清单后解压；不要仅凭本文清单或先前聊天摘要开始修改。
6. 根据具体任务打开相关源码、测试和构建文件；不要把整个文件清单当成已自动载入上下文。

文件库目标路径（目录已建立，但本次文件上传未成功）：
- `/N1PilotDesktop/PROJECT-OVERVIEW-CN.md`
- `/N1PilotDesktop/PROJECT-DEVELOPMENT-LOG-CN.md`
- `/N1PilotDesktop/1.0.3/N1PilotDesktop-1.0.3-HANDOFF-CN.md`
- `/N1PilotDesktop/1.0.3/`（本版本其他交付物）

**同步状态：未同步文件。** 文件库目录结构已创建，但 8 项直接上传均返回 `container_session_expired`；随后尝试以已导出的归档文件快照上传，又返回 `throttled`（提示 6 小时后再试）。重新列出 `/N1PilotDesktop/` 只看到空目录，没有任何项目文件。不得把上述目标路径当作已存在文件。当前可用交付以本地项目归档包和各文件下载链接为准。

## 2. 可信源码基线与哈希

- ZIP：`N1PilotDesktop-1.0.3.zip`
- 本地项目路径：`N1PilotDesktop/1.0.3/N1PilotDesktop-1.0.3.zip`
- ZIP 字节数：`268354`
- ZIP SHA-256：`07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509`
- ZIP 顶层目录：`N1PilotDesktop-1.0.3/`
- ZIP 内普通文件数：`42`
- 外部逐文件清单：`N1PilotDesktop-1.0.3-SOURCE-MANIFEST.sha256`
- 外部 ZIP 哈希：`N1PilotDesktop-1.0.3-SHA256.txt`
- ZIP 完整性：`zipfile.testzip()` 通过。
- 逐文件核验：已重新读取 ZIP 内所有文件，逐一验证 42 项与 manifest 一致。
- ZIP 整体哈希：已重新计算并与 SHA256 文件一致。
- 包内没有 `package-lock.json`；不要臆造其存在，也不要把不同依赖安装时生成的 lockfile 混入本版。

## 3. 候选版本关系与排除项

| 候选 | ZIP bytes | 内部 package version | ZIP SHA-256 | 结论 |
|---|---:|---|---|---|
| v1.0.1-editor-close-crash-fix | 263777 | 1.0.1 | `30a0d03592cb6bcdef7e4cb5e523f9435504e6515c71965491884564ca3c7ffd` | 历史 Monaco 版本，保留。 |
| Monaco v1.0.2 | 266844 | 1.0.2 | `449a53d6454ea041b1485c4da509175c2363e08fc89a3d26f5572a7cdd2c74f8` | 上一阶段版本，保留。 |
| Monaco v1.0.2.1-hotfix | 267867 | 1.0.2.1 | `ec8c61029b99b4d816bdca16d9c7915a47cfa40e184cb99055383a1343ff48ce` | 内部版本无效，用户构建日志证明 electron-builder 在版本校验失败。只归档，不可作为基线。 |
| Monaco v1.0.2.1-hotfix-fixed | 268782 | 1.0.2-hotfix.1 | `56e85b99626e1c86b2d14e88499fb8721374394d1f4875d5bf7fa84f629f589e` | 最新候选；保留原包。本次把它规范化成 1.0.3。 |

选择 1.0.3 的理由：在 v1.0.2 之后只做兼容修复与 SFTP 性能/诊断改进，属于修订版本；把非法四段版号及不同步的 hotfix 后缀统一为规范三段 SemVer。

## 4. 项目用途和功能基线

- Windows Electron SSH/SFTP 客户端。
- SSH 多会话和交互式 PTY/xterm 终端。
- 双栏本地/远程 SFTP 文件浏览与常见文件操作。
- 独立可调整大小的 Monaco 远程文本编辑窗口，支持多文件并行窗口。
- 远程编辑保存包括基线哈希比较/冲突检查、临时文件写入、备份/替换/恢复和元数据保留尝试；详情见 `main.js` 与 `editor.js`。
- 诊断日志包括编辑器保存阶段、目录请求和列表渲染分别计时。

## 5. 技术栈/依赖/构建

- Electron `45.0.0`；electron-builder `^26.0.12`。
- Node.js（目标版本由用户环境/便携 Node 实际提供）。
- SSH/SFTP：`ssh2 ^1.17.0`。
- 终端：`@xterm/xterm 6.0.0`、`@xterm/addon-fit 0.11.0`。
- 编辑器：`monaco-editor 0.57.0`，`esbuild ^0.25.11`。
- 其他：`diff ^8.0.2`、`iconv-lite ^0.6.3`、`yaml ^2.8.1`。
- Windows 便携版构建：`build.bat` → helper 编译 → `npm.cmd install` → `npm.cmd test` → `npm.cmd run dist:win`。
- 手动开发命令在 Windows PowerShell 必须使用 `npm.cmd`，不要直接执行 `npm`。

## 6. 完整源码文件清单（与 ZIP 内相对路径一致）

- `N1PilotDesktop-1.0.3/.gitignore` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/BASELINE-NOTE.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.1-rebased-debug.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.10-ssh-terminal-resize-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.11-window-interactive-terminal-debug.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.12-xterm-height-cap-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.13-xterm-height-cap-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.4-language-v060-engine-debug.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.5-properties-localization-debug.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.6-ssh-tabs-debug.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.7-ssh-interactive-terminal.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.8-interactive-terminal-height-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v0.6.9-ssh-terminal-height-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v1.0.0-monaco-remote-editor.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v1.0.1-browserwindow-destroyed-fix.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v1.0.2.1-sftp-performance-save-diagnostics.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/CHANGELOG-v1.0.3-baseline-normalization.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/README.md` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/TERMS-NOTE.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/THIRD-PARTY-NOTICES.txt` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/assets/n1pilot.ico` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/assets/n1pilot.png` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/assets/n1pilot.svg` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/build.bat` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/editor-monaco-entry.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/editor-preload.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/editor.css` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/editor.html` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/editor.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/ensure-node.ps1` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/index.html` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/main.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/native/PropertiesLauncher.cs` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/native/build-properties-helper.ps1` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/package.json` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/preload.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/renderer.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/repair-and-build.bat` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/scripts/build-editor.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/styles.css` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/tests/editor-smoke.js` — 源码文件；以文件内容为准。
- `N1PilotDesktop-1.0.3/tests/smoke.js` — 源码文件；以文件内容为准。

## 7. 架构与修改约束

1. `main.js`：Electron 主进程与 IPC 核心。不要把远程文件事务从主进程迁到 Renderer。
2. `preload.js` / `editor-preload.js`：受控 API 桥接。新增功能需同时核对 renderer 调用和 ipcMain handler，不要暴露整个 `ipcRenderer`。
3. `renderer.js` 与 `styles.css` / `index.html`：主界面及 SFTP/终端 UI。保留现有布局和视觉习惯，不得顺手重做界面。
4. `editor.js` / `editor.html` / `editor.css`：独立 Monaco 编辑器。不要改回 CodeMirror。
5. `editor-monaco-entry.js` 与 `scripts/build-editor.js`：Monaco 入口和 worker 本地打包；运行时不能依赖 CDN。JSON diagnostics API 应使用 `monaco.languages.json.jsonDefaults`。
6. 远程保存是高风险路径：保留冲突检查和临时文件/备份替换流程；保存操作执行中不能并发叠加；超时和错误要记录阶段、operation ID、耗时。
7. 对 rename/chmod/unlink 等有副作用的远程请求，超时只说明响应未及时返回，不证明服务器端未执行；不得在无核对的情况下自动重复。
8. 退出时 dirty editor、草稿、活动保存任务和 SSH 会话之间的状态关系不可简化。
9. 不可移除现有 v0.6.x changelog；其为历史功能缘由记录，但当前行为仍以源码为准。
10. 没有 package-lock；不要将其他目录的 `node_modules` 或 `package-lock.json` 拷入本版本。

## 8. 当前已知问题与未完成事项

- 用户此前报告：访问局域网 N1 的远程目录反应异常慢；1.0.2.1 候选增加移除冗余 stat、减少列表 DOM 重建、忽略过期结果、分别记录网络/渲染耗时。**这些改进尚未在用户 N1 实测验证**。
- 用户此前报告：Monaco 远程文件保存仍会卡住/失败。候选增加 SFTP 通道/元数据/编辑器读写流超时及保存阶段日志，但变更型 SFTP 操作无法安全统一强制超时；**保存问题未被证明彻底解决**。
- v1.0.3 Windows portable 构建仍待用户验证。
- npm 安装日志记录过 2 个 audit vulnerabilities（1 low、1 critical），以及 3 个 install scripts 待审批；未执行强制升级。需在实际环境复核 `npm audit`，不要以 `npm audit fix --force` 盲目改依赖。
- 还没有正式 `package-lock.json`，依赖可重复性不足。

## 9. 用户侧验收重点

按 `N1PilotDesktop-1.0.3-Windows-验收命令.txt` 执行。重点收集：
- `directory.remote.open.complete` 的 `requestElapsedMs` 与 `renderElapsedMs`。
- 编辑器保存从 `file.save.begin` 到各个 `file.save.stage.*` 的完整关联日志。
- 实际远程内容、mtime/size/权限以及备份/临时文件状态。
- Windows `npm.cmd test`、Monaco bundle、electron-builder EXE 的独立结果。

## 10. 下一次开发的唯一入口

必须从 `N1PilotDesktop/1.0.3/N1PilotDesktop-1.0.3.zip` 开始。先核验 `N1PilotDesktop-1.0.3-SHA256.txt` 和 MANIFEST；不得从 1.0.2、1.0.2.1 或 CodeMirror 版本混搭。根据用户新的实测日志再确定修复点；本轮整理不代表 SFTP/保存功能已验收。
