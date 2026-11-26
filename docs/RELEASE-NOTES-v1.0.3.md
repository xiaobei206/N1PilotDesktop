# N1PilotDesktop v1.0.3

## 版本定位

本次发布采用 Monaco 分支的规范化 1.0.3 源码基线。此版本的重点是统一三段式 SemVer、构建产物命名、构建提示和静态测试断言；不是一次未经计划的功能重写。

## 内容

- 既有 Windows Electron SSH/SFTP 工作区、SSH 多会话及交互式终端。
- 独立可调整大小的 Monaco 远程编辑器窗口，包含本地打包的 Monaco worker 资源。
- 远程保存阶段诊断、文件哈希冲突检查、临时文件/备份替换及恢复路径。
- 保留 v0.6.x 至 v1.0.3 的历史变更记录和中文交接材料。
- 附带版本化源码 ZIP、SOURCE-MANIFEST 和 SHA-256 校验值。

## 验证

- `npm test`：通过（Node.js v22.16.0 / npm 10.9.2 的整理环境）。
- ZIP CRC 与源码逐文件 SHA-256：原始 v1.0.3 归档验证通过。
- Windows portable EXE 构建、Windows GUI 运行、真实 N1 SSH/SFTP 和远程保存：未由本次仓库迁移验证，需依照随附验收文档实测。

## 已知限制

- 当前源码没有 `package-lock.json`，依赖版本解析没有 lockfile 固定。
- 历史 npm 安装日志记录过安全审计告警，尚未在本次迁移中强制升级依赖。
- 不要把静态 smoke test 结果解释为端到端测试通过。
