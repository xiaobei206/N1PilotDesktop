# N1PilotDesktop 项目总览

## 项目身份与当前基线

- 项目：N1PilotDesktop。
- 当前整理对象：**Monaco 分支**，当前规范源码版本 **1.0.3**。
- 当前源码 ZIP：`1.0.3/N1PilotDesktop-1.0.3.zip`。
- 当前工作状态：源码、文档、版本号和哈希已归档；Windows EXE 构建、GUI 验收和 N1 实机 SFTP/保存验收仍待用户侧完成。
- CodeMirror 分支不属于本目录的当前源码基线，不得混入 Monaco 工作树。

## 用途与功能概览

这是一个 Windows 桌面 SSH/SFTP 管理工具。现存源码包括 SSH 会话管理、SFTP 双栏文件管理、交互式 SSH 终端、远程文本文件编辑，以及本地 Monaco 资源构建。Monaco 编辑器以独立 Electron 窗口承载，支持多个远程文件编辑窗口。源码说明包含文本编码/BOM/换行保护、远程哈希冲突检测、同目录临时文件与备份替换、恢复草稿等设计。

SFTP 当前具备目录浏览、排序/过滤、远程文件/目录操作和属性等代码路径；当前版本还记录了目录加载/渲染分离计时、过期请求保护、SFTP 通道/只读元数据/编辑器流超时日志。具体功能仍以源码为准，不以 README 代替验收。

## 技术架构

- 桌面容器：Electron。
- 主进程：Node.js，入口 `main.js`。
- 主窗口渲染：`index.html` + `renderer.js` + `styles.css`。
- 预加载桥接：`preload.js`；编辑器窗口桥接：`editor-preload.js`。
- 远程编辑器：`editor.html` + `editor.js` + `editor.css`。
- 编辑器引擎：`monaco-editor@0.57.0`；使用 `esbuild` 在本地打包 ESM 与 Worker，见 `scripts/build-editor.js` 和 `editor-monaco-entry.js`。
- SSH/SFTP：`ssh2`。终端：`@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0。
- 其他运行依赖：`diff`、`iconv-lite`、`yaml`。
- 构建：`electron-builder` Windows portable x64；`native/PropertiesLauncher.cs` 由 PowerShell 构建脚本生成本地属性辅助程序。
- 自动检查：`npm test` 中的 Node 语法检查与两组静态 smoke tests。

## 运行环境与构建入口

- 目标平台：Windows x64。
- 首选构建入口：项目根目录 `build.bat`，它优先使用 `.tools\node` 中的便携 Node，缺失时使用 PATH 中的 Node/npm.cmd 或调用 `ensure-node.ps1`。
- PowerShell / CMD 手工调用 npm 时统一写 `npm.cmd`，不要依赖 `npm.ps1`，无需修改 ExecutionPolicy。
- `repair-and-build.bat` 是依赖安装异常时的恢复入口，会删除 `node_modules` 和 `package-lock.json` 后重装；不得把它当作普通构建入口。
- 当前源码包中没有 `package-lock.json`，依赖版本解析未被 lockfile 固定；后续若要引入锁文件，应作为单独、可审查的依赖管理变更。

## 重要架构约束

1. 只沿 Monaco 分支开发，不能从 CodeMirror 分支复制/拼接文件。
2. SSH 会话、PTY/xterm 终端、现有主界面和 SFTP 是既有基线；未经明确需求，不做 UI 重设计或终端重构。
3. Monaco 0.57.0 与本地 worker bundle 是编辑器构建基线；不能改成运行时 CDN。
4. 远程编辑必须保留文本内容完整性、编码/BOM/换行、冲突检查和临时文件/备份替换语义。
5. SFTP 修改操作（rename/chmod/unlink 等）发生超时不等于服务器端未执行；禁止一律超时后盲目重试破坏性操作。
6. 诊断日志不得输出密码、令牌或文件正文；路径日志可能包含设备目录信息，分享前检查敏感字段。
7. 新版本必须使用三段式版本号，并同步 `package.json`、构建产物名、构建脚本提示和测试断言。

## 目录导航

- `PROJECT-OVERVIEW-CN.md`：本文件。
- `PROJECT-DEVELOPMENT-LOG-CN.md`：唯一跨版本主开发日志。
- `1.0.3/`：当前规范源码版本及全部交接/校验材料。
- `1.0.0/`、`1.0.1/`、`1.0.2/`：历史 Monaco 版本归档。
- `_archive/candidates/`：无效或未规范化的历史 hotfix 候选，仅用于追溯，不作为开发基线。

## 文件库同步状态（2026-11-05）

已在文件库创建 `/N1PilotDesktop/`、`1.0.0/`、`1.0.1/`、`1.0.2/`、`1.0.3/` 和 `_archive/candidates/` 目录骨架。8 项文件上传全部因 Files 服务返回 `container_session_expired` 失败；随后尝试上传完整本地归档包，又因上传限额返回 `throttled`（提示 6 小时后再试）；复查目录仍为空。因此文件库尚未保存本项目文件。本地 `/mnt/data/N1PilotDesktop/` 整理结果可下载，不能将文件库目录骨架误认为已完成同步。

## 验收状态

本次整理执行了 ZIP CRC 完整性检查、源文件逐文件 SHA-256 校验和 `npm test` 静态测试。没有在当前环境执行 Windows Electron portable EXE 构建、GUI 运行、远程 SSH/SFTP 实测或 N1 上的文件保存验收；这些必须以用户实际运行结果为准。
