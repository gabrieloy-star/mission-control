# Changelog

## 1.1.0

- A context ceiling, 500k tokens by default: past it, compacting is always the first suggestion, and the red line on the context gauge sits there. Change it with the "Context ceiling" setting; 0 keeps the line at 85% of the window.
- The listing icon is the gauge again.
- Keywords, an author link and a shorter description in the plugin manifest.
- README: requirements, troubleshooting and the hover-card screenshots.

## 1.0.0

First release.

- The strip above the prompt: context, prompt cache, usage limits, session cost and the suggestion that saves the most right now.
- The side pane with five tabs: Suggestions, Context, Session, History and Insights.
- Idle compact, 5 minutes before the 1-hour prompt cache expires.
- What its compactions saved, kept for 7 days.
- A forecast of when each usage limit runs out, and a warning when Claude fails the same step three times in a row.
