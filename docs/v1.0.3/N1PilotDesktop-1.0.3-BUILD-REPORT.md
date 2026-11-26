# N1PilotDesktop 1.0.3 构建与验证报告

## 版本/源码身份

- 版本：`1.0.3`。
- 源码 ZIP：`N1PilotDesktop-1.0.3.zip`。
- ZIP 大小：`268354` bytes。
- ZIP SHA-256：`07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509`。
- 源码文件数：`42`。
- ZIP 顶层目录：`N1PilotDesktop-1.0.3/`。

## 本次执行记录

| 验证项目 | 是否执行 | 环境/命令 | 结果 |
|---|---|---|---|
| 候选 ZIP CRC 完整性 | 是 | Python `zipfile.testzip()` | 通过；固定候选 ZIP 无 CRC 错误。 |
| 标准化 ZIP CRC 完整性 | 是 | Python `zipfile.testzip()` | 通过；最终 ZIP 无损坏条目。 |
| 源码逐文件 SHA-256 | 是 | 解包最终 ZIP 后逐文件重新计算 | 通过；42 个条目全部匹配 MANIFEST。 |
| ZIP 整体 SHA-256 | 是 | 对最终 ZIP 字节计算 SHA-256 | 通过；与 SHA256.txt 一致。 |
| JavaScript 语法检查及静态 smoke tests | 是 | `npm test`；Node.js v22.16.0 / npm 10.9.2（当前构建容器） | 通过；`tests/smoke.js` 和 `tests/editor-smoke.js` 均通过。 |
| 旧候选 Windows `build.bat` 的用户侧结果 | 是（仅历史候选） | 用户提交的 `1.0.2.1` 构建日志 | 原生 helper 编译成功；`npm install` 完成；静态测试通过；Monaco bundle 生成；随后 electron-builder 因 `Invalid version: "1.0.2.1"` 失败。该日志不是 1.0.3 构建结果。 |
| 1.0.3 Windows `build.bat` / portable EXE | **未执行** | 需要用户 Windows 环境 | 未验证。 |
| Windows 安装/启动与 GUI 验收 | **未执行** | 目标 Windows 设备 | 未验证。 |
| N1 SSH/SFTP 目录浏览和远程保存 | **未执行** | 用户局域网 N1 实机 | 未验证。 |

## 历史正式版本归档核验

本地归档中的 1.0.0、1.0.1、1.0.2 三份 ZIP 均保留原 ZIP 字节内容，没有重新压缩覆盖；逐包执行 `zipfile.testzip()` 均无损坏条目。三份 ZIP 的实际 SHA-256 均与各自 SHA256.txt 一致；每份 MANIFEST 所列普通文件均存在且逐文件哈希匹配。ZIP 内的显式目录项不列入源码 MANIFEST，因此历史 ZIP 的 ZIP 条目总数会高于普通源码文件条目数。

## 用户历史构建日志中确认的问题

1. 错误候选 `package.json.version` 是四段式 `1.0.2.1`，Electron Builder 报 `Invalid version`。这是该次打包失败的直接原因。
2. `build.bat` 开头有 UTF-8 BOM，CMD 把开头显示成乱码。修正版已去掉 BOM。
3. esbuild 曾提示 `monaco.json.jsonDefaults` 没有匹配导出。固定候选已改为 `monaco.languages.json.jsonDefaults`。
4. npm 安装日志提示 2 个 audit vulnerabilities（1 low、1 critical）以及 `esbuild`、`ssh2`、`electron-winstaller` 安装脚本待审批。没有执行 `npm audit fix --force`，也没有擅自升级依赖。

## 结果边界

本报告只证明本次静态检查和归档完整性验证通过。不能据此宣称 1.0.3 的 Windows portable EXE 已经构建成功，也不能宣称 SFTP 变慢或远程保存问题已经在 N1 实机修复。下一步必须由用户在 Windows 上按验收命令运行完整构建，并在 N1 上实测目录切换、编辑器保存成功/失败/冲突及关闭退出流程。

## 交付位置与文件库状态

- 本地项目根目录：`/mnt/data/N1PilotDesktop/`。
- 当前源码 ZIP：`/mnt/data/N1PilotDesktop/1.0.3/N1PilotDesktop-1.0.3.zip`。
- 文件库目标目录已经创建，但全部上传因 `container_session_expired` 失败；重新列目录确认为空。故本报告不能声称已完成 Library 同步。


## GitHub 迁移补充（2026-11-26）

- 在仓库迁移工作目录中重新执行 `npm test`：通过（两组静态 smoke tests 均通过）。
- 对文本源码进行 GitHub token / private key / AWS key / 常见明文 API secret 模式扫描：未发现匹配项。
- 迁移时使用的原始项目归档 ZIP：1,601,384 bytes，SHA-256 `c529decb80e58f2186d3f9680835e0deed5ee84979a5f8e39d24159b9f8aca3f`；`zipfile.testzip()` 未发现损坏条目。仓库 Release 资源按源文件 MANIFEST 重新生成当前源码包，并使用新生成 ZIP 自己的 SHA-256 sidecar。
- 本次未执行 Windows portable EXE 构建、GUI 运行及 N1 SSH/SFTP 远程保存测试。
