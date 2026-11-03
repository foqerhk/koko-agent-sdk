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
