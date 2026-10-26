# DeepSeek Monitor design direction

## Product and audience

An operations ledger for the person responsible for several clients using DeepSeek. The main job is to see when token usage and rupiah cost changed, identify which client created the usage, and inspect the request that produced it.

## Personality

Quiet, precise, and practical. The UI should feel like a readable usage ledger, with the cost trend as its defining visual. It should not imitate a generic dark control room or present made-up activity.

## Color tokens

| Token | Hex | Purpose |
| --- | --- | --- |
| Fog | `#EEF2EF` | Page background |
| Paper | `#FAFBF8` | Reading surfaces |
| Spruce ink | `#24352F` | Primary text and navigation |
| Slate | `#5F6D66` | Supporting labels |
| Ledger amber | `#C6863D` | Cost, tariff, and real warnings |
| Deep teal | `#4C7468` | Confirmed and healthy states |

Amber stays tied to money and warnings. Teal marks actual healthy or confirmed states. Surfaces use quiet borders rather than repeated shadows.

## Typography

IBM Plex Sans carries headings, labels, and tables. Use tabular numerals for token counts and rupiah so values compare cleanly. Avoid monospace labels and decorative uppercase text.

## Layout

Keep the main navigation in a narrow left rail on wide screens and a bottom bar on small screens. The overview centers on the cumulative cost and its daily ledger line; a ranked client list explains the cost, and the latest request rows lead into the full history. Do not use a row of equal metric cards.

```text
┌──────────────┬─────────────────────────────────────────────┐
│ navigation   │ period · client filter · add client         │
│              ├──────────────────────────┬──────────────────┤
│              │ cost ledger              │ client ranking   │
│              ├──────────────────────────┴──────────────────┤
│              │ request history                             │
└──────────────┴─────────────────────────────────────────────┘
```

Use left alignment for headings, filters, and data. Labels and numeric columns should align by their job, with token and cost values right-aligned.

## Motion dials

ENERGY 1 / RHYTHM 2 / MOTION 1

Design Read: A quiet usage ledger with one clear cost trend. Motion confirms a user action or opens a dialog; it does not decorate live data.

## Motion

Use a restrained corporate motion profile. Hover and press feedback should feel immediate. Drawers and dialogs may move a few pixels into place; toasts confirm a completed action. Do not animate the live-status indicator continuously. Respect reduced-motion preferences.
