---
title: Agent Skills
---

# Agent Skills

[Agent Skills](https://agentskills.io/) are instruction sets that guide AI coding agents through tasks. When you invoke a skill, the agent takes the lead — it asks clarifying questions, makes decisions based on your codebase, and executes the work.

This repository provides four skills:

- [**create-mcp-app**](https://github.com/modelcontextprotocol/ext-apps/blob/main/plugins/mcp-apps/skills/create-mcp-app/SKILL.md) — scaffolds a new MCP App with an interactive UI
- [**migrate-oai-app**](https://github.com/modelcontextprotocol/ext-apps/blob/main/plugins/mcp-apps/skills/migrate-oai-app/SKILL.md) — migrates an existing OpenAI App to the MCP Apps SDK
- [**add-app-to-server**](https://github.com/modelcontextprotocol/ext-apps/blob/main/plugins/mcp-apps/skills/add-app-to-server/SKILL.md) — adds interactive UI to an existing MCP server's tools
- [**convert-web-app**](https://github.com/modelcontextprotocol/ext-apps/blob/main/plugins/mcp-apps/skills/convert-web-app/SKILL.md) — converts an existing web application into an MCP App

## Install the Skills

Choose one of the following installation methods based on your agent:

### Option 1: Claude Code Plugin

Install via Claude Code:

```
/plugin marketplace add modelcontextprotocol/ext-apps
/plugin install mcp-apps@modelcontextprotocol-ext-apps
```

### Option 2: Vercel Skills CLI

Use the [Vercel Skills CLI](https://skills.sh/) to install skills across different AI coding agents:

```bash
npx skills add modelcontextprotocol/ext-apps
```

### Option 3: Manual Installation

Clone the repository:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
```

Then copy the skills from `plugins/mcp-apps/skills/` to your agent's skills directory. See your agent's documentation for the correct location:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills)
- [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) / [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Codex](https://developers.openai.com/codex/skills/)
- [Gemini CLI](https://geminicli.com/docs/cli/skills/)
- [Cline](https://docs.cline.bot/features/skills#skills)
- [Goose](https://block.github.io/goose/docs/guides/context-engineering/using-skills/)

## Verify Installation

Ask your agent "What skills do you have?" — you should see `create-mcp-app`, `migrate-oai-app`, `add-app-to-server`, and `convert-web-app` among the available skills.

## Invoke a Skill

Try invoking the skills by asking your agent:

- "Create an MCP App" — scaffolds a new MCP App with an interactive UI
- "Migrate from OpenAI Apps SDK" — converts an existing OpenAI App to use the MCP Apps SDK
- "Add UI to my MCP server" — adds interactive UI to an existing MCP server's tools
- "Convert my web app to an MCP App" — converts an existing web application into an MCP App

The agent will guide you through the process, asking clarifying questions as needed.

## Test Your App

After creating or migrating your MCP App, see the [Testing MCP Apps](./testing-mcp-apps.md) guide to run and debug it locally.
