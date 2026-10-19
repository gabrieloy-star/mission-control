# Mission Control

**See where your Claude Code tokens go, and the one change that saves the most right now.**

Mission Control is a Claude Code mod. It adds a strip above the prompt and a side pane, both built only from figures Claude Code already reports. Watching it costs **zero tokens**: it never calls the model and never sends anything anywhere.

![Mission Control overview](docs/overview.png)

## Why

A long session gets expensive in ways that are hard to see:

- every message re-sends the whole conversation, so a 400k conversation costs more per message than a 40k one;
- the prompt cache keeps that resend cheap, but it expires after an hour, and the next message pays full price to send everything again;
- subagents, large tool outputs, unused MCP servers and a model bigger than the work quietly add cost.

Mission Control makes each of those visible and tells you what to do about it.

## The strip above the prompt

One line that fits the width of the prompt. When space runs short, the least important parts drop out first.

| Part | What it shows |
| --- | --- |
| **Context** | Tokens in context against the model's context window, with a mark at 85%, where compacting pays off. |
| **Prompt cache** | Time left before the prompt cache expires: 1 hour normally, 5 minutes when Claude writes the short cache. Turns amber, then red. |
| **Usage limits · 5 hours / 7 days** | How much of each limit is left, against the time left in the window. Turns red when you use it faster than time passes. |
| **Session cost** | What this session has cost so far at API list prices, and what the last message added. |
| **Suggestion** | The single change that saves the most right now, such as compacting before the cache expires. A button runs it. Only savings of $1 or more over an hour of work are suggested; otherwise it says "✓ all good". |
| **insights** | Opens the Insights tab. The number is how many insights this session has. Press **i**. |
| **details** | Hover for a status card: session time, model and cost, both usage limits with their reset times, and your Fable use over 7 days. Click (or press **O**) to open the side pane. |

## The side pane

Open it with `/mission`, the **details** button or **O**. It has five tabs.

- **Suggestions.** Every change worth making now, ranked by how much it saves, each with a one-line reason:
  - compact, or start a new session once the cache has expired on a large context;
  - turn off unused MCP servers;
  - use the Explore agent for searches;
  - ask for shorter tool outputs;
  - a notice when the session passes your budget.

  **Compact now** always works: while Claude is answering, the compaction is queued and runs as soon as the answer ends, and the strip shows "compaction queued" until then.
- **Context.** What every message sends, by Claude's own categories (as `/context` shows them): messages, system prompt, system tools, MCP tools, memory files, skills. A line marks 85% of the context window.
- **Session.** Each message with its cost and cache share, plus which subagents ran and the largest tool outputs.
- **History.** The last 7 days across all your projects:
  - tokens and their cost at list prices;
  - how much came from the cache;
  - the split between your own conversations and subagents;
  - how many times the cache had expired and a large context was sent again;
  - which projects used the most, and a few lessons drawn from it.

  It is read from Claude Code's own session files on your machine.
- **Insights.** Whether the model fits the work, and habits that keep sessions cheap:
  - Fable or Opus on routine work points to a cheaper model, with what switching costs (a new model has no cache, so it sends the context once at full price);
  - Haiku on long multi-step work points to Sonnet;
  - subagents running on a top model, and Fable's share of your week;
  - a low cache share, returns after the cache expired, a large fixed context, a context near its limit.

  A model that does not fit the work is also said once per session in a notice. Insights are local rules over the same figures: they cost no tokens.

## Idle compact

If you leave a large session idle, Mission Control compacts it 5 minutes before the 1-hour prompt cache expires. Coming back then costs a short summary instead of sending the whole conversation again. Small conversations are left alone, and so is a session on the 5-minute cache, which leaves no time to act.

## Settings

Change these with `/plugin configure mission-control@gabriel-mods`.

| Setting | Default | What it does |
| --- | --- | --- |
| Session budget | $100 | One notice when a session passes this amount in US dollars. 0 turns it off. |
| Smallest saving worth suggesting | $1 | Suggestions that save less over an hour of work are not shown. |
| Idle compact: minutes before the cache expires | 5 | When idle compact runs. 0 turns it off. |
| Smallest conversation worth compacting | 40,000 tokens | Below this, idle compact does nothing. |
| Cost line after each answer | off | A dim line under each answer with its figures. The Session tab already has them. |

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
