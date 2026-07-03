# SemanticPrez

**Turn a SKOS taxonomy or an OWL ontology into a zoomable, nested slide deck.**

SemanticPrez reads an RDF (Turtle) file and a small JSON config describing *where
each piece of a slide comes from*, and generates a self-contained presentation you
open in any browser. The hierarchy of the vocabulary becomes the navigation: each
concept/class is a slide that visually **contains its narrower concepts / subclasses
/ individuals**, and you zoom in and out of the tree (powered by
[impress.js](https://impress.js.org)).

- **Works with SKOS** (`skos:broader` / `skos:narrower`) **and OWL**
  (`rdfs:subClassOf` for class hierarchy, `rdf:type` to attach individuals).
- **Config-driven metadata** — you declare which property feeds the title, text,
  image, video, links, etc. Nothing about your vocabulary is hard-coded.
- **Multilingual**, with a per-language switch.
- **Scales to large branches** — a node with many children switches to a numbered
  bullet list instead of unreadable tiny cards.

---

## How it works

```
   your.ttl  +  config.json          semanticprez.build            viewer/
 ┌─────────────────────────┐        ┌──────────────────┐        ┌──────────────┐
 │ SKOS concepts / OWL      │ ─────▶ │ parse graph,     │ ─────▶ │ index.html   │
 │ classes + individuals,   │        │ build hierarchy, │  data  │ app.js       │
 │ labels, definitions,     │        │ extract fields   │  .js   │ style.css    │
 │ images, links …          │        └──────────────────┘        │ impress.min  │
 └─────────────────────────┘                                     └──────────────┘
```

`build.py` emits a `build/` folder containing `data.js` (your vocabulary as JSON)
plus the static viewer. The viewer lays every node out as a card, positions each
node's children *inside* it on the impress.js canvas, and moves the camera as you
navigate. No server or internet is required (images/links load from the web if you
use remote URLs).

---

## Requirements & installation

- **Python ≥ 3.9** with [`rdflib`](https://rdflib.dev) (only runtime dependency).
- A modern browser (Chrome, Firefox, Safari).

```sh
git clone https://github.com/<you>/SemanticPrez.git
cd SemanticPrez
pip install -r requirements.txt         # just rdflib
# ...or install as a package (adds the `semanticprez` command):
pip install -e ".[dev]"                 # [dev] also pulls in pytest
```

---

## Quick start

Build one of the bundled examples and open it:

```sh
# SKOS taxonomy (bilingual EN/FR)
python -m semanticprez examples/windvane/config.json
open examples/windvane/build/index.html

# OWL ontology (classes + individuals)
python -m semanticprez examples/produce/config.json
open examples/produce/build/index.html
```

(If you installed the package, `semanticprez examples/windvane/config.json` works too.)

---

## Navigating the slides

| Key | Action |
|-----|--------|
| **↓** | go **into** the children (first child) |
| **↑** | go back to the **parent** |
| **← / →** | move across **siblings** on the same level |
| **1 – 9** | **jump** straight to the numbered child shown on the current slide |
| **Esc** / **Home** | back to the **overview** (root) |
| **L** | switch language |

You can also **click any card** to zoom to it, or click a bullet / chip. The bottom
bar (auto-hides; move the mouse to the bottom to show it) holds the language switch
and an Overview button.

**Large branches:** when a node has more than 8 children, its slide shows them as a
**numbered bullet list** (so they all fit and stay readable), and the full child
slides stay hidden until you enter one.

---

## Configuration reference

A config is a single JSON file that lives next to your `.ttl`. Paths and the output
folder are resolved relative to the config file.

```jsonc
{
  "input":  "my-vocab.ttl",     // RDF file (relative to this config)
  "output": "build",            // output folder to generate (relative to this config)
  "format": "turtle",           // optional; any format rdflib understands

  "namespaces": {               // prefixes used by the property names below
    "skos": "http://www.w3.org/2004/02/skos/core#",
    "schema": "http://schema.org/",
    "...": "..."
  },

  "languages": ["en", "fr"],    // languages to show; the first is the default

  // ---- what is a node, and how nodes connect ----
  "nodeTypes": ["skos:Concept"],          // rdf:type values that make a subject a node
  "hierarchy": {
    "narrower": "skos:narrower",          // parent -> child   (childLinks, see below)
    "broader":  "skos:broader",           // child  -> parent  (parentLinks, see below)
    "topConcept": "skos:hasTopConcept"    // optional: property on the scheme listing roots
  },

  // ---- the opening "overview" slide ----
  "scheme": {
    "type": "skos:ConceptScheme",
    "fields": {
      "title":       { "property": "dcterms:title", "localized": true },
      "description": { "property": "dcterms:description", "localized": true }
    }
  },

  // ---- where each slide part comes from ----
  "fields": {
    "title":       { "property": "skos:prefLabel", "localized": true },
    "subtitle":    { "property": "skos:altLabel",  "localized": true, "multi": true },
    "description": { "property": "skos:definition", "localized": true },
    "note":        { "property": "skos:scopeNote",  "localized": true },
    "image":       { "property": "schema:image" },
    "video":       { "property": "schema:video" },
    "links":       { "property": "rdfs:seeAlso", "multi": true },
    "related":     { "property": "skos:related", "multi": true, "ref": true }
  },

  // ---- what to render, in what order ----
  "display": [
    { "field": "subtitle",    "as": "subtitle" },
    { "field": "image",       "as": "image" },
    { "field": "video",       "as": "video" },
    { "field": "description", "as": "paragraph" },
    { "field": "note",        "as": "note",  "label": { "en": "Scope", "fr": "Portée" } },
    { "field": "links",       "as": "links", "label": "Links" },
    { "field": "related",     "as": "chips", "label": "Related" }
  ],

  "branchColors": { "SomeTopConcept": "#2dd4bf" }   // optional per-top-node accent overrides
}
```

### Field flags

| Flag | Meaning |
|------|---------|
| `localized: true` | collect one value per language (only `languages` are kept; **untagged literals map to the primary language**, so plain-label ontologies work) |
| `multi: true` | keep several values |
| `ref: true` | the value is a reference to another node → rendered as a chip that navigates |

### `display` render types (`as`)

`subtitle`, `paragraph`, `note`, `image`, `video`, `links` (external anchors),
`chips` (navigating references). `note` / `links` / `chips` accept an optional
`label` (a string or a `{lang: text}` object). The **title** is always rendered as
the slide heading; unlabeled nodes fall back to their id.

### Hierarchy: `narrower`/`broader` vs `parentLinks`/`childLinks`

The generic form is:

```jsonc
"nodeTypes": ["owl:Class", "owl:NamedIndividual"],
"hierarchy": {
  "parentLinks": ["rdfs:subClassOf", "rdf:type"],  // child -> parent properties
  "childLinks":  []                                 // parent -> child properties
}
```

`hierarchy.narrower` / `hierarchy.broader` are shorthands for a single child-link /
parent-link. Either direction is enough — a `broader`/`subClassOf` link is
automatically inverted so the tree can be walked. **Top nodes** are chosen as:
explicit `hierarchy.topOrder` → the scheme's `topConcept` property → otherwise the
roots (nodes with no parent) are derived automatically. Each top node gets an accent
colour from a built-in palette (override via `branchColors`).

---

## Setting it up for your own vocabulary

**A SKOS taxonomy** — copy `examples/windvane/config.json`, then set `input`, the
`namespaces`, and point each `fields` entry at your properties (commonly
`skos:prefLabel`, `skos:definition`, `skos:altLabel`). Done.

**An OWL ontology** — copy `examples/produce/config.json`. The important parts:

```jsonc
"nodeTypes": ["owl:Class", "owl:NamedIndividual"],
"hierarchy": { "parentLinks": ["rdfs:subClassOf", "rdf:type"] },
"fields": {
  "title":       { "property": "rdfs:label", "localized": true },
  "description": { "property": "rdfs:comment", "localized": true },
  "image":       { "property": "schema:image" },
  "links":       { "property": "schema:url", "multi": true }
}
```

This browses **superclass → subclass → individual**: classes nest by
`rdfs:subClassOf`, and each individual appears under the class it is an instance of
(`rdf:type`). Then `python -m semanticprez your/config.json`.

---

## Project structure

```
semanticprez/
  build.py            # RDF + config -> data.js  (generator; importable functions)
  __main__.py         # `python -m semanticprez <config.json>`
  viewer/             # the static viewer (index.html, style.css, app.js, impress.min.js)
examples/
  windvane/           # SKOS example (bilingual)
  produce/            # OWL example (classes + individuals)
tests/                # pytest suite + RDF fixtures
```

---

## Development

```sh
pip install -e ".[dev]"
pytest                     # runs the SKOS + OWL generator tests
```

The generator is split into importable functions (`build_data`, `write_presentation`)
so it is testable without touching the filesystem; `tests/` cover hierarchy
inversion, class/individual attachment, localized/multi/ref field extraction,
untagged-literal handling, root derivation and the emitted output.

---

## License

MIT (see `LICENSE`). Bundles **impress.js** (MIT) — see `THIRD_PARTY.md`.
