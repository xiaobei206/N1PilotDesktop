# N1PilotDesktop

Windows Electron SSH/SFTP 工作区与独立 Monaco 远程文本编辑器。本仓库以 **v1.0.3** 为当前规范基线。

## 项目交接入口
- [跨会话开发交接](docs/v1.0.3/N1PilotDesktop-1.0.3-HANDOFF-CN.md)
- [累计开发日志](docs/PROJECT-DEVELOPMENT-LOG-CN.md)
- [项目总览](docs/PROJECT-OVERVIEW-CN.md)
- [v1.0.3 构建报告](docs/v1.0.3/N1PilotDesktop-1.0.3-BUILD-REPORT.md)
- [Windows 验收清单](docs/v1.0.3/N1PilotDesktop-1.0.3-Windows-验收命令.txt)
- [历史归档索引](docs/ARCHIVE-INDEX-CN.md)
- [Release Notes](docs/RELEASE-NOTES-v1.0.3.md)

## 本地构建
在 Windows 上运行 `build.bat`，或手动执行：
```powershell
npm.cmd install
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\native\build-properties-helper.ps1 -Source .\native\PropertiesLauncher.cs -Output .\assets\N1PilotProperties.exe
npm.cmd test
npm.cmd run dist:win
```

## GitHub Release
主分支工作流会重建并校验原始源码归档和文档包，然后在 Windows runner 上编译原生属性助手、安装依赖、运行静态测试和打包 Electron portable EXE。构建失败时不会发布 Release。发布内容包含 Windows portable EXE、版本化源码 ZIP、SHA-256 校验文件及源码清单。

## 验收边界
CI 能证明源码测试和构建流程通过，但不能替代目标 Windows 机器的 GUI 验收或真实 N1 SSH/SFTP、远程保存与冲突保护实测。请对照随附交接文档完成设备侧验收。

版本源码的独立 README 保存在 `docs/source-snapshot-v1.0.3/README.md`，源码 ZIP 由 `scripts/package-source.py` 根据 42 文件清单生成。
