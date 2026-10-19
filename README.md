# Mission Control

**See where your Claude Code tokens go, and the one move that saves the most right now.**

Mission Control is a Claude Code mod. It adds an instrument strip above the prompt and a side pane, both built only from figures Claude Code already reports. Watching it costs **zero tokens**: it never calls the model and never sends anything anywhere.

![Mission Control overview](docs/overview.png)

## Why

A long session gets expensive in ways that are hard to see:

- every message re-sends the whole conversation, so a 400k conversation costs more per message than a 40k one;
- the prompt cache keeps that re-send cheap, but it cools after an hour, and the next message pays to write everything again;
- subagents, big tool outputs and idle MCP servers quietly add weight.

Mission Control makes each of those visible and tells you what to do about it.

## The strip above the prompt

One line that fits the width of the prompt. When space runs short, the least important instruments drop out first.

| Instrument | What it shows |
| --- | --- |
| **Payload** | Context on board against the model's window, with a mark at the auto-compact point. |
| **Cache fuse** | Time left before the prompt cache cools. Turns amber, then red, as it runs down. |
| **Fuel · 5 hours / 7 days** | Usage left in each limit window, raced against the clock. Turns red when you burn faster than time passes. |
| **Spend** | What this session has cost so far, and what the last message added. |
| **Next move** | The single action that saves the most right now, such as compacting before the cache cools. A button runs it. "✓ nominal" means nothing needs doing. |
| **⋯** | Hover for a status card with session time, model and cost, both fuel windows with their refuel times, and your Fable usage over 7 days. Click (or press **O**) to open the side pane. |

## The side pane

Open it with `/mission`, the **⋯** button or **O**. It has four tabs.

- **Maneuvers.** Every saving move available now, ranked by how much it saves in money, each with a one-line reason:
  - compact now, or start a fresh thread once the conversation has decayed;
  - lighten the payload;
  - power down idle MCP servers;
  - send Explore subagents for wide searches;
  - trim heavy tool outputs;
  - warn when you go over your budget.
  
  **Compact now** works even while Claude is answering: the compaction waits in line and runs as soon as the answer ends.
- **Payload.** What fills the context window, by category: messages, system prompt, tools, memory files, MCP servers. A line marks where auto-compact kicks in.
- **Flight log.** Each message of the session with its time, tokens added, cost and cache share, plus which subagents ran and which tool outputs were heaviest.
- **History.** The last 7 days across all your projects:
  - tokens and their equivalent cost;
  - how much came from cache;
  - the split between your own conversations and subagents;
  - how many times a cold cache was rewritten;
  - which projects used the most, and a few lessons drawn from it.

  It is read from Claude Code's own session files on your machine.

## Idle compact

If you leave a large session idle, Mission Control compacts it a few minutes before the 1-hour prompt cache expires. Coming back then costs a short summary instead of rewriting the whole conversation. Small conversations are left alone.

## Settings

Change these with `/plugin configure mission-control@gabriel-mods`.

| Setting | Default | What it does |
| --- | --- | --- |
| Session budget | $100 | One notice when a session passes this amount in US dollars. 0 turns it off. |
| Idle minutes before compacting | 50 | When idle compact fires. 0 turns it off. |
| Smallest conversation worth compacting | 40,000 tokens | Below this, idle compact does nothing. |
| Telemetry line after each answer | off | A dim line under each answer with its figures. The Flight log tab already has them. |

## Install

In Claude Code:

```
/plugin marketplace add gabrieloy-star/mission-control
/plugin install mission-control@gabriel-mods
```

Then start a new session.

To remove it: `/plugin uninstall mission-control@gabriel-mods`.

## Credits

Thanks to the people whose mods shaped the ideas here:
Chris Han ([context-window](https://github.com/chrishan17/claude-mod-context-window)),
David Roberts ([claude-idle-compact](https://github.com/davidar/claude-idle-compact)),
Eric Cologni ([token-weather-usage](https://github.com/augiefra/claude-mods))
and Anthropic (session-report).
