# 发布 SDK

本文面向包维护者；接入请看[接入指南](INTEGRATION.zh-CN.md)。网关位于同一仓库的其他目录并独立部署，绝不会包含在 npm 包中。

1. 从仓库根目录执行 `cd sdks/typescript` 进入包目录，检查变更记录、包信息、版本和支持的平台。npm 版本不可覆盖，每次发布使用新的语义化版本。
2. 执行 `npm ci` 和 `npm run build`，维护者还必须运行私有测试套件；原生代码变更需在代表性宿主中验证。
3. 检查 `npm pack --dry-run` 和实际 tarball；不得包含环境文件、凭证、宿主数据、构建缓存或私有代码。
4. 在仓库根目录 `.env` 配置 `NPM_TOKEN`。脚本强制核验 `npm whoami` 为 `intentcomputing`，固定使用 npmjs，且不把 token 放入命令行参数。根 `.npmrc` 只能引用 `${NPM_TOKEN}`。
5. 执行 `npm run release -- /absolute/path/to/audited-package.tgz` 发布已审计文件。脚本检查包名、版本、registry 和 SDK 上报版本。发布后从公网 registry 核实精确版本、dist-tag 和完整性，并在干净消费项目中重新安装精确版本。

发布前用解包后的候选包执行仓库 N/N-1/N-2 协议矩阵，并同步协议、符合性测试、
部署/配置文档和 changelog。UI 兼容补丁不得用于提高最低版本阻断或开启紧急强更。

若 npm 显示暂存发布，需由维护者审查并批准后才能公开安装，具体见 [npm 暂存发布文档](https://docs.npmjs.com/staged-publishing/)。
