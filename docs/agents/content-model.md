# Content model: pages, sections and the structured form

## Where it lives

- `islands/sections.ts` — `PAGES` (which sections render on which public page) and
  `SECTION_SCHEMAS` (typed form fields per section key).
- `islands/SitesList.tsx` — `SiteEditor`, `StructuredForm`, `ListEditor` and the raw-JSON editor.

## The structured form must spread, never replace

`SECTION_SCHEMAS` lists a **subset** of a block's keys; the public sites merge the whole block
over their defaults. `StructuredForm.setField` and `ListEditor`'s per-item update both spread
(`{ ...value, [key]: v }`), so keys the schema doesn't know survive an edit. Replacing would
silently blank live landing-page content on the next save. Two tests fail on exactly that.

## Form ↔ JSON

- Known sections open in Form mode; unknown sections use the JSON editor. A Form/JSON toggle is
  always available.
- Form mode keeps a parsed `value` object as source of truth; JSON mode keeps the text. Switching
  seeds one from the other. Save resolves the active mode; invalid JSON blocks the save.
- `currentValue()` refuses arrays, scalars and `null`, so a block is always an object. A
  hand-broken stored value degrades instead of white-screening the editor.
- Field types: text, textarea, `number` (a cleared number becomes `null`), `checkbox` (stays
  boolean), `stringlist` (array of plain strings), and repeatable object lists (e.g. FAQ
  `items: [{q, a}]`), usable top-level and inside list items. `LeafInput` emits the typed value
  and `blank()` seeds new items per field type.

## Adding a section or page

1. Copy the shape from the landing-page component's `cmsFor("<key>", …, {…default…})` call (or
   from tds-shared `translations.ts` where the defaults live there). Guessed keys show empty
   fields for real content.
2. Add the schema to `SECTION_SCHEMAS` **and** list the section in `PAGES` wherever it renders.
3. Partial schemas are safe; unlisted keys are preserved by the spread.

## Current namespaces (landing page)

The landing page uses isolated namespaces rather than reusing overrides written for older copy:

| Group | Keys |
|---|---|
| Home | `home_hero` (incl. `eyebrow`), `home_trust` (the site fills `{name}`, `{town}`, `{rate}`), `references_home`, `why_me`, `website_demos` |
| Services | `services_overview`, `service_consulting`, `service_process`, `service_solutions`, `service_custom_development`, `service_web_presence`, `service_complete_it` |
| Process & pricing | `first_call` (process, contact block and every service page), `pricing_logic` |
| FAQ | `faq_v2` (incl. `headlineAccent`) |
| Blog | `cookie_banner`, `ads` |

- The six `service_*` blocks share one shallow structured shape (detail copy, string lists, price
  copy, repeatable anonymised references). IDs, slugs and hrefs are deliberately absent; route
  metadata lives in landing-page code. `references: []` is valid and means "no reference section".
- Service blocks render on the home cards and their detail page, so `PAGES` lists them wherever
  they render.
- There is no pricing page in `PAGES`: `/preise` 301s to the home page's `#preise`.
- The site's service finder is code-owned and has no block.
- Legacy schemas (`hero`, `about`, `services`, `faq`, `contact`, `process`, `consulting`, `footer`,
  `pricing`, `tech`, `journal`, `portfolio`, `digital_responsibility`, `pricing_services`) stay
  available for stored rows under "Weitere Abschnitte". Fields the site stopped rendering were
  removed from the forms; stored values survive the spread.
