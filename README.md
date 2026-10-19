# Mission Control

A Claude Code mod that shows where your tokens go and the move that saves the most right now, at no token cost.

- **Strip above the prompt**: payload, cache, fuel for the 5-hour and 7-day limits, spend, and the best move. Hover **⋯** for the session, the fuel windows and the week of Fable.
- **Side pane** (`/mission`): Maneuvers, Payload, Flight log and History.
- **Idle compact**: compacts an idle session before the 1-hour prompt cache cools, so coming back is cheap.

## Install

In Claude Code:

```
/plugin marketplace add gabrieloy-star/mission-control
/plugin install mission-control@gabriel-mods
```

Then start a new session. Currency, budget and idle-compact timing are in the plugin's settings.

## Credits

Thanks to the people whose mods shaped the ideas here:
Chris Han ([context-window](https://github.com/chrishan17/claude-mod-context-window)),
David Roberts ([claude-idle-compact](https://github.com/davidar/claude-idle-compact)),
Eric Cologni ([token-weather-usage](https://github.com/augiefra/claude-mods))
and Anthropic (session-report).
