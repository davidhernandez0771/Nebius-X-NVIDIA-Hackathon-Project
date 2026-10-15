# Project skills

Skills committed here load automatically in every Claude Code session on this repo, including cloud sessions (they read `.claude/skills/` even without plugins).

| Skill | Source | License |
|---|---|---|
| `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) (Jesse Vincent) | MIT (`LICENSE` in each folder) |
| `frontend-design` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design) | Apache 2.0 (`LICENSE.txt`) |

## Notes for Claude
- The Superpowers files refer to each other as `superpowers:<name>`. Here the skills are installed under their bare names, so `superpowers:test-driven-development` means the `test-driven-development` skill in this folder.
- Skills they mention that aren't installed here (`using-git-worktrees`, `subagent-driven-development`, `finishing-a-development-branch`, `requesting-code-review`, `executing-plans`) aren't part of this project's workflow; skip those steps.
- `brainstorming` is interactive: when the user is present, ask the questions one at a time. When running unattended, answer them yourself, record the options and your reasoning, and flag the decision for review.
