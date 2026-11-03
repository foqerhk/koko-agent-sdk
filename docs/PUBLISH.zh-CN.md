# 发布 SDK

本文面向包维护者；接入请看[接入指南](INTEGRATION.zh-CN.md)。网关服务独立维护和部署，不包含在 npm 包或公开 SDK 仓库中。

1. 检查变更记录、包信息、版本和支持的平台。npm 版本不可覆盖，每次发布使用新的语义化版本。
2. 执行 `npm ci`、`npm test -- --runInBand --watchman=false` 和 `npm run build`；原生代码变更需在代表性宿主中验证。
3. 检查 `npm pack --dry-run` 和实际 tarball；不得包含环境文件、凭证、宿主数据、构建缓存或私有代码。
4. 通过 `https://registry.npmjs.org/` 使用有发布权限的账号登录；npm 可能要求双重验证。不要把令牌提交到仓库。
5. 执行 `npm publish --access public --registry https://registry.npmjs.org/`，再核实仓库版本、dist-tag 和包完整性，并考虑缓存传播延迟。

若 npm 显示暂存发布，需由维护者审查并批准后才能公开安装，具体见 [npm 暂存发布文档](https://docs.npmjs.com/staged-publishing/)。
