# Privacy

Usage Coach collects nothing and sends nothing anywhere.

- **No network.** It makes no network requests and has no server, account or analytics.
- **No model calls of its own.** It only reads figures Claude Code already reports.
- **What it reads, on your machine only:** session figures (context size, cost at list prices, usage limits, prompt cache), token counts per request, tool names and their command or file path (for labels), the first 60 characters of each request you type (to label cost per task, kept in the session's memory), and token counts, model names, timestamps and project folder names from your local Claude Code transcripts in `~/.claude/projects`.
- **What it keeps:** a 14-day usage summary and a 7-day list of what compactions saved, in Claude Code's own local plugin storage, on your machine.
- **What it runs:** `node scripts/week.mjs` from its own folder, which only reads the transcripts above and prints a summary.

The full list is in the README, under "What it reads, runs and sends".

Questions: open an issue at https://github.com/gabrieloy-star/usage-coach/issues
