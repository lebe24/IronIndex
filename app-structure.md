# Application structure

How Iron Index is put together: where state lives, how data moves, and what each
file is responsible for. Written against the code as of the `docs/readme-banner`
branch.

## Shape of the thing

A Create React App with two pages and no state library. `/` is one screen
scrolled top to bottom through four numbered chapters; `/build` is the workout
builder. The only server code is `api/chat.js`, a Vercel function that keeps
the Anthropic key off the client; everything else is static.

| # | Section | Anchor | Component |
|---|---|---|---|
| 01 | Masthead | `#top` | `Hero` |
| 02 | Select target | `#target` | `TargetRail` |
| 03 | Muscle map | `#muscles` | `MuscleMap` |
| 04 | Archive / video | `#results` | `ExerciseGrid` or `VideoGrid` |

`/build` is a separate page holding `WorkoutBuilder` and `CoachChat`.
`/news` is a third, holding `NewsFeed`.

Within the home page, navigation is anchor scrolling: `scrollToId` in
`pages/Home.jsx`, with `[id] { scroll-margin-top: 96px }` in `base.css` keeping
the sticky masthead off the target.

Between pages, `src/lib/router.js` drives the History API directly. It is about
sixty lines because react-router would have cost roughly a quarter of the
bundle for two paths with no params. Three details are deliberate:

- **Links are real anchors.** `RouteLink` only intercepts a plain left click,
  so modifier-clicks and middle-clicks still open a new tab.
- **Anchor scrolling after a route change polls on a timer, not
  `requestAnimationFrame`.** rAF is paused while a tab is in the background, so
  a link opened in a background tab would never apply its scroll. It retries
  until the element exists, because React may not have committed the incoming
  page when the first attempt runs.
- **A same-page hash uses `replaceState`.** Pushing would make the back button
  unwind one anchor at a time.

`vercel.json` rewrites unknown paths to `index.html`; without it `/build` 404s
on refresh.

## Data sources

There is no API for the exercise archive. Three sources feed the app:

**The catalogue** is `public/exercises.json`, 1,324 records shipped as a static
asset and fetched once at runtime. It is not imported, so it never enters the
JavaScript bundle.

**The media** comes from a version-pinned jsDelivr mirror of
`hasaneyldrm/exercises-dataset`. Each record names an image and a GIF file; the
service prefixes them with a base URL. Nothing is bundled, and no key is needed.

**Video search** is the only network call that needs credentials: YouTube Data
API v3, keyed by `REACT_APP_YOUTUBE_API_KEY`.

Quotes used to be a fourth source. They are now a local array, so a failing
third-party endpoint can no longer leave the masthead blank.

### Catalogue record shape

Upstream fields are terse. `normalise()` in `exerciseapi.js` expands them:

| Raw | Normalised | Example |
|---|---|---|
| `n` | `name` | `barbell deadlift` |
| `bp` | `bodyPart` | `back` |
| `tg` | `target` | `spine` |
| `eq` | `equipment` | `barbell` |
| `mg` | `mainMuscle` | `hamstrings` |
| `sm` | `secondary` | `["glutes", "traps"]` |
| `st` | `instructions` | array of steps |
| `img` | `imgUrl` | base + filename |
| `gif` | `gifUrl` | base + filename |

Every component downstream sees the normalised shape only. If the dataset is ever
swapped, `normalise()` is the single place that changes.

`instructions` and `mainMuscle` are carried through but not yet rendered
anywhere. They are the obvious raw material for an exercise detail view.

### How the catalogue splits

| Body part | Exercises |
|---|---|
| upper arms | 292 |
| upper legs | 227 |
| back | 203 |
| waist | 169 |
| chest | 163 |
| shoulders | 143 |
| lower legs | 59 |
| lower arms | 37 |
| cardio | 29 |
| neck | 2 |

Nineteen distinct target muscles and twenty-eight equipment types across the set.

## State

`App.js` owns everything. Every other component is presentational and driven by
props. There are eleven pieces of state:

- `quote` — picked once in the state initialiser, never updated
- `parts` — the body-part list, as `{ status, data, error }`
- `activePart` — which body part is selected, defaults to `back`
- `exercises` — every exercise for `activePart`, same envelope
- `videos` — YouTube results, same envelope, starts at status `idle`
- `mode` — `exercises` or `videos`, drives which grid renders
- `query` — what is typed in the search field
- `term` — what was actually submitted, which is what triggers the fetch
- `page` — current page of the archive
- `catalogueCount` — total records, for the masthead readout
- `muscle` — the active muscle filter, or `null`

Three of those use the same `{ status, data, error }` envelope, where status is
one of `idle`, `loading`, `ready`, `error`. Each grid switches on it to choose
between a skeleton, a `StateBlock`, and real content. That uniformity is why the
loading and failure paths are handled everywhere rather than only on the happy
path.

Splitting `query` from `term` matters: typing re-renders the input but does not
fire a request. Only submitting sets `term`, and only `term` is an effect
dependency. That is what keeps a 100-unit-per-call API from being hit on every
keystroke.

## Data flow

```
mount
  ├─ fetchCatalogueCount ──> catalogueCount ──> Hero stat strip
  └─ fetchBodyParts ───────> parts ──────────> Ticker, TargetRail

activePart changes
  └─ fetchExercisesByBodyPart ──> exercises ──> MuscleMap (unfiltered)
                                           └──> filtered ──> ExerciseGrid, Pager

muscle changes
  └─ filtered = exercises.data.filter(trains(e, muscle))

term changes
  └─ searchVideos ──> videos ──> VideoGrid
```

The archive and the muscle map read the same `exercises.data`. The map always
sees the unfiltered set, so its shading and counts stay stable while you narrow
the grid beneath it. Only `filtered` feeds the grid and the pager.

`filtered` and `pageItems` are both memoised. Pagination is a slice of
`filtered`, never of the raw data, which is the bug that had the pager reporting
203 results while showing a filtered 139.

## Services

### `services/exerciseapi.js`

The catalogue loader, and the only genuinely subtle file in the project.

`fetchCatalogue()` memoises a single in-flight promise so the three consumers
that need the catalogue on mount share one HTTP request. It deliberately does
**not** accept an `AbortSignal`. An earlier version passed the first caller's
signal into the shared fetch, which meant React StrictMode's double-mount
aborted the request for every consumer and the page hung on skeletons forever.
`loadCatalogue(signal)` instead awaits the shared promise and checks each
caller's own signal after it settles.

A rejection clears the cached promise rather than caching it, so a transient
failure does not poison every later call.

Three exports read from it: `fetchBodyParts`, `fetchCatalogueCount`,
`fetchExercisesByBodyPart`.

### `services/youtubechannelapi.js`

One export, `searchVideos`. Appends `workout` to the query, requests 24 results,
and maps the response down to `{ id, title, channel, publishedAt, thumbnail }`.
Decodes HTML entities in titles, which the API returns raw. Throws with the
API's own error message when present, which is why the failure state can tell
you the key is invalid rather than just reporting a status code.

### `services/quotes.js`

Ten quotes and a random pick. No network.

## The muscle system

`lib/muscles.js` is the most logic-dense file. It exists because the dataset
names muscles inconsistently: `delts`, `deltoids` and `shoulders` are one muscle;
`lats` and `latissimus dorsi` are another.

- `MUSCLES` — the eighteen drawable muscles, head-to-toe. This ordering is also
  the render order for the map list and for the tags on every card, so the two
  always agree.
- `INERT` — head, hands, feet and so on. Drawn as silhouette, never shaded.
- `ALIAS` — every spelling that occurs in the data, mapped onto a slug. Things
  that cannot be drawn (`cardiovascular system`, `ankles`, `hands`) map to
  `null` and are dropped rather than guessed at.
- `BY_BODYPART` — fallback weights when nothing resolves. Weights within a group
  sum to 1, so `upper legs` spreads across quads, hamstrings and glutes instead
  of counting three times.
- `musclesOf(exercise)` — returns `{ slug: weight }`. Primary target weighs 1,
  each supporting muscle 0.4.

Built on top of that: `trains` and `isPrimary` for filtering and emphasis,
`coverageOf` and `countsOf` for aggregates, `levelsOf` for the four shade
buckets, `rankOf` for ordering.

`levelsOf` is relative to the heaviest muscle in whatever set it is given. The
map therefore answers "where is this group concentrated", which only means
anything as a comparison within one selection. It is not an absolute scale.

`lib/body-paths.js` is 92 KB of SVG path data, MIT-licensed, derived from
MuscleMap by Melih Colpan. It is `import()`ed dynamically inside `MuscleMap`,
cached in a module-level variable shared across mounts, so it lands as a separate
40 KB gzipped chunk that only downloads for visitors who scroll that far.

## Components

Each is one `.jsx` plus one `.css` of the same name. None holds application
state; the three that hold local state hold only interaction state.

| Component | Props | Notes |
|---|---|---|
| `Nav` | `onStart` | Tracks its own scroll position for the blurred state |
| `Hero` | `quote`, `targetCount`, `exerciseCount`, `onBrowse` | Staggered entrance via inline `animation-delay` |
| `Ticker` | `words` | Marquee; falls back to a verb list before parts load |
| `TargetRail` | `parts`, `active`, `onSelect`, `status`, `error` | Scroll-snap row of buttons with `aria-pressed` |
| `MuscleMap` | `exercises`, `selected`, `onSelect`, `bodyPart` | Lazy-loads geometry; list is the accessible path |
| `Toolbar` | `mode`, `onMode`, `query`, `onQuery`, `onSubmit` | Segmented tabs plus search form |
| `ExerciseGrid` | `exercises`, `loading`, `offset`, `pageSize`, `activeMuscle` | Renders `ExerciseCard` and skeletons |
| `VideoGrid` | `videos`, `loading` | Renders `VideoCard` and skeletons |
| `Pager` | `page`, `total`, `onChange`, `rangeStart`, `rangeEnd`, `count`, `unit` | Windowed page numbers with ellipses |
| `StateBlock` | `tone`, `code`, `title`, `children` | Shared empty, idle and error panel |
| `Footer` | none | Static |

### `ExerciseCard`

The only component with meaningful local state, and worth understanding.

It holds `hovered`, `pinned` and `armed`. Playing is `pinned || hovered`, so a
mouse can hover to play while a tap pins it, and moving the mouse away does not
cancel a deliberate tap. `armed` latches true the first time playing goes true
and never resets, which is what keeps the GIF in the DOM and cached once
requested.

The still image renders always. The animation element is not rendered at all
until `armed`, so a page of twelve cards fetches twelve 6 KB stills rather than
twelve 90 KB animations. Both sit absolutely positioned in the same box and
cross-fade by opacity.

Media uses `mix-blend-mode: multiply` over a bone-coloured plate. The dataset
ships both frames on a white field, so multiply drops the white out and the card
reads as a printed illustration rather than a pasted photo.

### `MuscleMap`

Renders two SVG views, front and back, from the lazily loaded geometry. Each
muscle path takes a level class `l0` through `l4` and is clickable only when it
has exercises behind it.

The list beside the figures is not decoration. SVG paths are not focusable
controls, so the list is the accessible route to the same filter for keyboard and
screen reader users. Both call the same `onSelect`.

When nothing in a group resolves to a drawable muscle the component returns an
explanatory panel instead. In practice this never fires for the current dataset,
including cardio, which resolves through secondary muscles.

## Styling

Plain CSS with custom properties. No framework, no preprocessor, no CSS-in-JS.

`styles/tokens.css` holds every colour, family, rhythm value and timing. Four
inks from `#0b0b0c` to `#17171a`, three bone tints, one signal colour
(`--volt`, `#d8ff3d`) and one rare secondary (`--ember`, `#ff4a1c`) reserved for
the selected muscle and error states. Three families: Big Shoulders Display for
headlines, Chivo for body, Chivo Mono for labels and data.

`styles/base.css` imports the tokens and defines the reset plus the primitives
shared across sections: `.shell`, `.chapter`, `.btn`, `.skeleton`, the `rise`
entrance animation, and the reduced-motion block that disables all of it.

Everything else is scoped to its component file. There are no global component
styles outside those two files.

Two layout details worth knowing, because both were bugs:

- Grids use `minmax(min(280px, 100%), 1fr)`, not `minmax(280px, 1fr)`. The fixed
  form overflows the page below about 320px wide.
- The root uses `overflow-x: clip`, not `hidden`. The ticker is rotated and
  scaled past the viewport edge; `hidden` would clip it but would also create a
  scroll container and break the sticky masthead.

## Build and deploy

Create React App 5.0.1 on React 18. Dependencies are react, react-dom,
react-scripts and web-vitals. Testing Library is present as a dev dependency;
there are no tests.

Node 24 is required, declared in both `engines.node` and `.nvmrc`. On Vercel the
dashboard's Node.js Version setting overrides both, which is what caused the
failed deploy.

Output is three files:

| File | Gzipped |
|---|---|
| `main.js` | 54 KB |
| `body-paths` chunk | 40 KB |
| `main.css` | 7 KB |

Plus `exercises.json` at 888 KB uncompressed, fetched at runtime and served
compressed by any sane host.

Environment variables are all optional except the YouTube key:
`REACT_APP_YOUTUBE_API_KEY` for video search, `REACT_APP_IMG_BASE` and
`REACT_APP_GIF_BASE` to self-host the media.

## The workout builder

`lib/workout.js` generates a session. Each split (`push`, `pull`, `legs`,
`upper`, `lower`, `full`, `core`, `arms`) declares an ordered list of muscle
slots; slots are filled in order, with roughly the first half preferring
compound movements.

Three decisions in there are load-bearing and look arbitrary otherwise:

- **Compound is detected by movement pattern, not muscle count.** Counting
  muscles marks almost everything compound, because most entries list two or
  more secondaries, which produced sessions of six presses and no accessory
  work.
- **Candidates are ranked, then picked randomly from the top eight.** An even
  draw over the whole pool surfaces the long tail. Scoring rewards mainstream
  equipment and recognised movement names, and penalises one-word catalogue
  stubs like "quads", long niche variants, parenthetical qualifiers, and names
  containing two movement words, which are novelty combos that would otherwise
  score like staples.
- **A compound slot falls back to isolation when the best compound scores far
  worse than the best exercise available.** Biceps, calves and abs have no real
  compound, and forcing one produced hybrids like "dumbbell bicep curl lunge
  with bowling motion".

The PRNG hashes its seed before use. Seeds arrive as 1, 2, 3 from the shuffle
button, and consecutive small seeds in a raw xorshift produce correlated first
outputs, so shuffling changed only the tail of the workout.

`lib/workoutCard.js` draws the session to a 1080x1350 canvas and returns a PNG
data URL. It waits on `document.fonts` first, or the canvas silently falls back
from the display face, and it loads the exercise art with
`crossOrigin="anonymous"` so the canvas stays exportable.

`WorkoutBuilder` is the one component that owns data rather than taking it as
props. It calls `fetchAllExercises`, which shares the same memoised catalogue
promise as the rest of the app, so this costs no extra request.

## Where to extend

`instructions` and `mainMuscle` are already normalised and unused, so an exercise
detail view needs no data work. Equipment is a natural second filter axis and the
pattern is established: derive the options from the currently visible list, the
way the muscle list is derived, so every option has results behind it. Anything
that should survive a reload needs a store, since there is none today: reloading
resets to `back` with no muscle filter.
