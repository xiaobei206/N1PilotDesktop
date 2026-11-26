# N1PilotDesktop 版本归档索引

当前主分支以 Monaco `1.0.3` 为唯一开发基线。源码树保存完整、可逐文件浏览的 v1.0.3 项目文件；发布工作流会按随附 MANIFEST 重新打包当前版本并附上 SHA-256。

## 历史版本/候选身份

| 归档 | 大小（bytes） | SHA-256 | 定位 |
|---|---:|---|---|
| `N1PilotDesktop-1.0.0.zip` | 262476 | `76119d3fc71789c71102b01f7e7abc7cb8c6beca627295e2e828ec94747b0f1f` | Monaco 远程编辑器初始版本 |
| `N1PilotDesktop-1.0.1.zip` | 263777 | `30a0d03592cb6bcdef7e4cb5e523f9435504e6515c71965491884564ca3c7ffd` | 编辑器窗口关闭崩溃修复 |
| `N1PilotDesktop-1.0.2.zip` | 266844 | `449a53d6454ea041b1485c4da509175c2363e08fc89a3d26f5572a7cdd2c74f8` | Monaco 1.0.2 基线 |
| `N1PilotDesktop-1.0.3.zip` | 268354 | `07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509` | 当前规范源码包；42 个文件 |
| `N1PilotDesktop-Monaco-v1.0.2.1-hotfix.zip` | 267867 | `ec8c61029b99b4d816bdca16d9c7915a47cfa40e184cb99055383a1343ff48ce` | 版本号无效的旧候选，仅作追溯 |
| `N1PilotDesktop-Monaco-v1.0.2.1-hotfix-fixed.zip` | 268782 | `56e85b99626e1c86b2d14e88499fb8721374394d1f4875d5bf7fa84f629f589e` | 内部版本为 `1.0.2-hotfix.1` 的候选，外部标签仍不一致 |

## 历史记录保留策略

- 既有 v0.6.x、v1.0.0、v1.0.1、v1.0.2、v1.0.2.1 候选和 v1.0.3 变更记录保留在仓库根目录，主开发日志保留在 `docs/PROJECT-DEVELOPMENT-LOG-CN.md`。
- 每次正式版本通过 Git tag 与 GitHub Release 保留版本源码快照。当前发布工作流生成的源码 ZIP 会单独随 Release 提供。
- 历史包的哈希是追溯用身份记录；此仓库的自动打包过程会产生新的 ZIP 元数据，因此自动生成的 Release ZIP 使用自己附带的 SHA-256 sidecar，不会错误复用历史 ZIP 的哈希。
