#!/usr/bin/env python3
"""SemanticPrez — generate a zoomable presentation from a SKOS or OWL Turtle file.

Everything that ties the viewer to a particular vocabulary lives in a JSON config
(which RDF property feeds each slide slot, the class/individual types, the
hierarchy links, ...). This module reads that config plus the RDF file and emits
a self-contained presentation folder (``data.js`` + the viewer assets).

Usage:  python -m semanticprez.build path/to/config.json
        semanticprez path/to/config.json          # if installed
"""
import sys
import os
import json
import shutil

from rdflib import Graph, URIRef
from rdflib.namespace import RDF

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER_DIR = os.path.join(HERE, "viewer")
VIEWER_FILES = ("index.html", "style.css", "app.js", "impress.min.js")

DEFAULT_PALETTE = [
    "#2dd4bf", "#a78bfa", "#60a5fa", "#f59e0b", "#34d399",
    "#f472b6", "#38bdf8", "#fb7185", "#a3e635", "#c084fc",
]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def load_config(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _loc(term):
    """Local name of a URI: the part after the last '#' or '/'."""
    return str(term).split("/")[-1].split("#")[-1]


def _expander(namespaces):
    def expand(qname):
        prefix, local = qname.split(":", 1)
        return URIRef(namespaces[prefix] + local)
    return expand


# --------------------------------------------------------------------------- #
# core: RDF graph -> presentation data dict
# --------------------------------------------------------------------------- #
def build_data(cfg, base_dir="."):
    """Turn a config + its RDF file into the data dict consumed by the viewer."""
    ns = cfg["namespaces"]
    langs = cfg["languages"]
    expand = _expander(ns)

    g = Graph()
    g.parse(os.path.join(base_dir, cfg["input"]), format=cfg.get("format", "turtle"))

    # --- generic field extraction (localized / multi / ref) ---
    def extract(subject, field_defs):
        out = {}
        if subject is None:
            return out
        for name, spec in field_defs.items():
            prop = expand(spec["property"])
            localized = spec.get("localized", False)
            multi = spec.get("multi", False)
            ref = spec.get("ref", False)
            objs = list(g.objects(subject, prop))
            if not objs:
                continue
            if localized:
                bucket = {}
                for o in objs:
                    lang = getattr(o, "language", None) or langs[0]  # untagged -> primary
                    if lang in langs:
                        if multi:
                            bucket.setdefault(lang, []).append(str(o))
                        else:
                            bucket.setdefault(lang, str(o))
                if bucket:
                    out[name] = bucket
            else:
                vals = [_loc(o) if ref else str(o) for o in objs]
                vals = sorted(vals) if ref else vals
                out[name] = vals if multi else vals[0]
        return out

    # --- which subjects are nodes, and how they link to parents / children ---
    node_types = cfg.get("nodeTypes") or [cfg["concept"]["type"]]
    node_type_uris = [expand(t) for t in node_types]
    h = cfg["hierarchy"]
    parent_props = [expand(p) for p in (h.get("parentLinks") or ([h["broader"]] if h.get("broader") else []))]
    child_props = [expand(p) for p in (h.get("childLinks") or ([h["narrower"]] if h.get("narrower") else []))]

    node_subj = {}
    for t in node_type_uris:
        for s in g.subjects(RDF.type, t):
            node_subj.setdefault(_loc(s), s)
    idset = set(node_subj)

    concepts = {}
    for cid, s in node_subj.items():
        parents = []
        for pp in parent_props:
            for o in g.objects(s, pp):
                oid = _loc(o)
                if oid in idset and oid != cid:
                    parents.append(oid)
        concepts[cid] = {
            "id": cid,
            "fields": extract(s, cfg["fields"]),
            "broader": sorted(set(parents)),
            "narrower": [],
        }
    for cid, s in node_subj.items():
        for cp in child_props:
            for o in g.objects(s, cp):
                oid = _loc(o)
                if oid in idset and oid != cid and oid not in concepts[cid]["narrower"]:
                    concepts[cid]["narrower"].append(oid)
    # derive narrower from broader (inverse) so any direction can be walked
    for cid, c in concepts.items():
        for par in c["broader"]:
            if par in concepts and cid not in concepts[par]["narrower"]:
                concepts[par]["narrower"].append(cid)
    for c in concepts.values():
        c["narrower"] = sorted(c["narrower"])

    # --- scheme / ontology header (optional) ---
    scheme_subj = None
    scheme_type = cfg.get("scheme", {}).get("type")
    if scheme_type:
        subs = list(g.subjects(RDF.type, expand(scheme_type)))
        scheme_subj = subs[0] if subs else None
    scheme = extract(scheme_subj, cfg.get("scheme", {}).get("fields", {}))

    def title_key(cid):
        t = concepts[cid]["fields"].get("title", {})
        return (t.get(langs[0]) or (t.get(langs[1]) if len(langs) > 1 else None) or cid).lower()

    # --- top nodes: explicit order > topConcept property > derived roots ---
    tops = h.get("topOrder")
    if not tops and scheme_subj and h.get("topConcept"):
        tc = expand(h["topConcept"])
        tops = sorted((_loc(o) for o in g.objects(scheme_subj, tc)), key=title_key)
    if not tops:
        has_parent = set()
        for cid, c in concepts.items():
            has_parent.update(c["narrower"])
            if c["broader"]:
                has_parent.add(cid)
        tops = sorted([cid for cid in concepts if cid not in has_parent], key=title_key)

    # --- build tree (first-visit dedup): depth / branch / parent / child_ids ---
    visited = set()

    def build(cid, branch, parent, depth):
        visited.add(cid)
        n = concepts[cid]
        n["branch"], n["parent"], n["depth"] = branch, parent, depth
        kids = [c for c in sorted(n["narrower"], key=title_key)
                if c in concepts and c not in visited]
        n["child_ids"] = kids
        for c in kids:
            build(c, branch, cid, depth + 1)

    for t in tops:
        build(t, t, None, 1)

    ordered = []

    def dfs(cid):
        ordered.append(cid)
        for c in concepts[cid]["child_ids"]:
            dfs(c)

    for t in tops:
        dfs(t)

    steps = [{
        "id": cid,
        "depth": concepts[cid]["depth"],
        "parent": concepts[cid]["parent"],
        "branch": concepts[cid]["branch"],
        "child_ids": concepts[cid]["child_ids"],
        "fields": concepts[cid]["fields"],
    } for cid in ordered]

    index = {cid: concepts[cid]["fields"].get("title", {}) for cid in concepts}

    palette = cfg.get("palette", DEFAULT_PALETTE)
    overrides = cfg.get("branchColors", {})
    branch_colors = {t: overrides.get(t, palette[i % len(palette)]) for i, t in enumerate(tops)}

    return {
        "scheme": scheme,
        "languages": langs,
        "display": cfg["display"],
        "branchColors": branch_colors,
        "tops": tops,
        "index": index,
        "steps": steps,
        "_unreached": sorted(set(concepts) - visited),
    }


# --------------------------------------------------------------------------- #
# write a self-contained presentation folder
# --------------------------------------------------------------------------- #
def write_presentation(out, cfg, base_dir=".", viewer_dir=VIEWER_DIR):
    out_dir = os.path.join(base_dir, cfg.get("output", "build"))
    os.makedirs(out_dir, exist_ok=True)
    data = {k: v for k, v in out.items() if not k.startswith("_")}
    with open(os.path.join(out_dir, "data.js"), "w", encoding="utf-8") as fh:
        fh.write("window.TAXONOMY = ")
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")
    for name in VIEWER_FILES:
        shutil.copy(os.path.join(viewer_dir, name), os.path.join(out_dir, name))
    return out_dir


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    cfg_path = argv[0] if argv else "config.json"
    cfg = load_config(cfg_path)
    base_dir = os.path.dirname(os.path.abspath(cfg_path))
    out = build_data(cfg, base_dir)
    out_dir = write_presentation(out, cfg, base_dir)

    steps = out["steps"]
    with_img = sum(1 for s in steps if s["fields"].get("image"))
    print("nodes: %d | with image: %d | top nodes: %d" % (len(steps), with_img, len(out["tops"])))
    print("languages: %s" % ", ".join(out["languages"]))
    if out["_unreached"]:
        print("WARNING unreached nodes: %s" % ", ".join(out["_unreached"]))
    print("open %s" % os.path.join(out_dir, "index.html"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
