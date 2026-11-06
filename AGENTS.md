# AI 必读

## GitHub 提交身份（强制）

- 本仓库 `foqerhk/koko-agent-sdk` 中由 AI 或维护流程创建的所有提交，Author 与 Committer 必须统一为：
  - Name: `foqerhk`
  - Email: `123921693+foqerhk@users.noreply.github.com`
- 禁止沿用电脑全局 Git 身份，也不要添加其他人的 `Co-authored-by` trailer。
- 提交前必须在本仓库设置并核对：

  ```bash
  git config user.name foqerhk
  git config user.email 123921693+foqerhk@users.noreply.github.com
  git var GIT_AUTHOR_IDENT
  git var GIT_COMMITTER_IDENT
  ```

- 推送前必须执行 `git log -1 --format='%an <%ae> | %cn <%ce>'`。若身份不是上述值，尚未推送时先修正提交；已经推送时停止操作并向仓库所有者报告，不得继续叠加错误身份的提交。

这些约束用于保证 GitHub Contributor 归属正确；不得为了方便而省略。

## SDK/网关协议兼容（强制）

- npm 版本、网关版本和线协议版本相互独立。`/v1` 内只允许向后兼容的可选增量；破坏性改动必须新增 `/vN` 并提供双版本迁移期。
- 正常迭代必须先部署兼容后端，再发布 SDK，最后才可按采用率提高最低版本。不得在新版 npm 可安装并完成宿主验收前启用最低版本阻断。
- HTTP 426 `sdk_upgrade_required` 是终止错误，SDK 禁止重试或执行任何 App 操作，必须显示“SDK 版本太旧，请联系应用开发者更新后再使用”的本地化提示。
- SDK 发布前必须运行协议 N/N-1/N-2 兼容矩阵，并同步更新 `protocol/`、`conformance-tests/`、配置文档和 changelog。
