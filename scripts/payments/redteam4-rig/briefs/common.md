# Red team 4 — common brief (read this first, then your lane file)

## What this tool is for (the only background you get)

Customers pay workshop bills by UPI (they scan a QR code with their phone). The bank only tells
the workshop the amount and a name. This page shows each payment, one at a time, and asks you
which bill it paid. You tap the bill, you confirm. If you are not sure, you can skip, search, or
say the bill is not made yet. Accounts staff also use an Import tab to load the day's bills and
payments from files. Nothing is matched automatically; a person always decides.

## How you look at it

You are looking at screenshots of a phone (or a desktop, if your lane says so). They are in
`/tmp/claude-0/-home-user-parastrucks/6501876e-28f8-5e32-8af3-eca8854db3cd/scratchpad/rig/out/`.

- `<ID>-<viewport>.png` = what you see when the screen opens, before scrolling.
- `<ID>-<viewport>-s1.png`, `-s2.png` … = what you see after each thumb-scroll down.
- `<ID>.txt` = every word on that screen, in reading order (handy for quoting).
- Viewports: `360` (small cheap Android), `390`, `412`, `land` (phone turned sideways), `desk`.
- `index.json` lists every state ID with a one-line title.

Open a screenshot with the Read tool on its path. Look at the opening shot first, then the
scroll shots in order, as a person would. Use `ls` on the folder to find your files.

The screenshots are static. You cannot tap. Where you want to know what a tap does, say what
you EXPECT to happen and what the screen gives you to go on. If you cannot tell from the screen,
that itself is a finding ("I cannot tell what this button will do").

Known picture artifact: in some scrolled shots the logo in the black top bar shows as the words
"Paras Trucks" instead of the logo image. Ignore that; it is the screenshot tool, not the app.

## Rules

1. Stay in character. Write as the person you are given. Use their words.
2. Banned words: affordance, hierarchy, contrast ratio, component, UX, UI, modal, CTA, pattern,
   responsive, accessibility, a11y, touch target, padding, viewport. If you type one, delete it
   and say what you actually saw ("the button is too small for my thumb", "I didn't notice the
   grey text").
3. Do not read any code, CSS, or documentation. You have the screenshots and this brief. That is
   all a real user has. (The expert lane is the one exception and has its own brief.)
4. Do not re-litigate these decisions; they are fixed by the owner. A finding that says one of
   these is wrong is dropped:
   - a person always confirms; nothing matches by itself
   - the screen is in English (simpler English is fair game; another language is not)
   - matching is done the next morning in one sitting, not at the counter as money arrives
   - "Bill not raised yet" exists and the payment returns by itself later
   - Import is for accounts only
5. Quote the screen. Every finding names a state ID and the screenshot file you saw it in.
6. Be concrete about cost. "Confusing" is not a finding. "I would tap Skip because I don't know
   what Confirm will do to the money" is.
7. Also note what works. Two or three lines at the end: what you understood at once, what felt
   safe. This keeps the fixes from breaking the good parts.

## Finding format (one block per finding, in a Markdown file)

```
### <LANE>-<n>: <one-line title in plain words>
State: <ID>   Screenshot: <file>   Viewport: <360/390/412/land/desk>
Who I am: <one line>
What I was trying to do:
What I expected:
What I actually saw (quote the screen):
How bad: Blocks | Confuses | Slows | Polish
What I'd change (words or a plain description, no code):
What that pushes down the page: <what moves lower / off the first screen if the change is made; "nothing" is a valid answer>
```

| How bad | Means |
|---|---|
| **Blocks** | I cannot finish, or I would do the wrong thing with money without knowing |
| **Confuses** | I stop and would ask someone, or guess |
| **Slows** | I finish, with extra taps or re-reading |
| **Polish** | I noticed; it cost nothing |

At the end of your file add two short sections:
- `## Needs a live run` — things you could not judge from a still picture (what happens after a
  tap, how long a message stays, scrolling feel). One line each.
- `## What works` — two or three lines.

## Output

Write your findings to the path named in your lane file. Aim for every real finding you have,
ranked worst first. Ten strong findings beat thirty weak ones. Do not pad.
