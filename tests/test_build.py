"""Tests for semanticprez.build — SKOS and OWL graph -> presentation data."""

import json
import os

from semanticprez.build import build_data, write_presentation

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def steps_by_id(data):
    return {s["id"]: s for s in data["steps"]}


# --------------------------------------------------------------------------- #
# SKOS
# --------------------------------------------------------------------------- #
SKOS_CFG = {
    "input": "skos.ttl",
    "namespaces": {
        "skos": "http://www.w3.org/2004/02/skos/core#",
        "dcterms": "http://purl.org/dc/terms/",
        "schema": "http://schema.org/",
    },
    "languages": ["en", "fr"],
    "concept": {"type": "skos:Concept"},
    "scheme": {
        "type": "skos:ConceptScheme",
        "fields": {"title": {"property": "dcterms:title", "localized": True}},
    },
    "hierarchy": {
        "narrower": "skos:narrower",
        "broader": "skos:broader",
        "topConcept": "skos:hasTopConcept",
    },
    "fields": {
        "title": {"property": "skos:prefLabel", "localized": True},
        "subtitle": {"property": "skos:altLabel", "localized": True, "multi": True},
        "description": {"property": "skos:definition", "localized": True},
        "image": {"property": "schema:image"},
        "related": {"property": "skos:related", "multi": True, "ref": True},
    },
    "display": [{"field": "description", "as": "paragraph"}],
}


def test_skos_all_nodes_and_tops():
    data = build_data(SKOS_CFG, FIX)
    ids = steps_by_id(data)
    assert set(ids) == {"Animal", "Mammal", "Dog", "Cat"}
    assert data["tops"] == ["Animal"]  # via skos:hasTopConcept
    assert data["_unreached"] == []


def test_skos_broader_is_inverted_to_children():
    data = build_data(SKOS_CFG, FIX)
    ids = steps_by_id(data)
    # hierarchy was declared with broader only; children must be derived
    assert ids["Animal"]["child_ids"] == ["Mammal"]
    assert sorted(ids["Mammal"]["child_ids"]) == ["Cat", "Dog"]
    assert ids["Dog"]["parent"] == "Mammal"
    assert ids["Mammal"]["depth"] == 2 and ids["Dog"]["depth"] == 3


def test_skos_field_extraction():
    ids = steps_by_id(build_data(SKOS_CFG, FIX))
    dog = ids["Dog"]["fields"]
    assert dog["title"] == {"en": "Dog"}
    assert dog["subtitle"] == {"en": ["Canine"]}  # localized + multi
    assert dog["image"] == "http://example.org/dog.jpg"  # plain literal
    assert dog["related"] == ["Mammal"]  # ref -> local id
    assert ids["Mammal"]["fields"]["title"] == {"en": "Mammal", "fr": "Mammifère"}


def test_branch_colors_cover_every_top():
    data = build_data(SKOS_CFG, FIX)
    assert set(data["branchColors"]) == set(data["tops"])
    assert all(c.startswith("#") for c in data["branchColors"].values())


# --------------------------------------------------------------------------- #
# OWL ontology
# --------------------------------------------------------------------------- #
OWL_CFG = {
    "input": "owl.ttl",
    "namespaces": {
        "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
        "owl": "http://www.w3.org/2002/07/owl#",
        "schema": "https://schema.org/",
    },
    "languages": ["en"],
    "nodeTypes": ["owl:Class", "owl:NamedIndividual"],
    "scheme": {
        "type": "owl:Ontology",
        "fields": {"title": {"property": "rdfs:label", "localized": True}},
    },
    "hierarchy": {"parentLinks": ["rdfs:subClassOf", "rdf:type"], "childLinks": []},
    "fields": {
        "title": {"property": "rdfs:label", "localized": True},
        "description": {"property": "rdfs:comment", "localized": True},
        "links": {"property": "schema:url", "multi": True},
    },
    "display": [{"field": "description", "as": "paragraph"}],
}


def test_owl_classes_and_individuals_are_nodes():
    ids = steps_by_id(build_data(OWL_CFG, FIX))
    # 4 classes + 2 individuals
    assert set(ids) == {"Thing2", "Vehicle", "Car", "Unlabelled", "Tesla", "Beetle"}


def test_owl_subclass_hierarchy_and_roots():
    data = build_data(OWL_CFG, FIX)
    ids = steps_by_id(data)
    assert data["tops"] == ["Root"] or data["tops"] == ["Thing2"]  # Root has no super-class
    assert "Thing2" in data["tops"]
    assert ids["Vehicle"]["parent"] == "Thing2"
    assert "Car" in ids["Vehicle"]["child_ids"]


def test_owl_individuals_attach_under_their_class():
    ids = steps_by_id(build_data(OWL_CFG, FIX))
    assert sorted(ids["Car"]["child_ids"]) == ["Beetle", "Tesla"]
    assert ids["Tesla"]["parent"] == "Car"
    assert ids["Tesla"]["fields"]["links"] == ["http://example.org/tesla"]


def test_owl_untagged_label_maps_to_primary_language():
    ids = steps_by_id(build_data(OWL_CFG, FIX))
    assert ids["Vehicle"]["fields"]["title"] == {"en": "Vehicle"}


def test_owl_unlabelled_node_still_present_without_title():
    ids = steps_by_id(build_data(OWL_CFG, FIX))
    assert "Unlabelled" in ids
    assert "title" not in ids["Unlabelled"]["fields"]  # viewer falls back to the id


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #
def test_write_presentation_emits_data_and_viewer(tmp_path):
    data = build_data(SKOS_CFG, FIX)
    cfg = dict(SKOS_CFG, output="out")
    out_dir = write_presentation(data, cfg, str(tmp_path))
    for name in ("data.js", "index.html", "style.css", "app.js", "impress.min.js"):
        assert os.path.exists(os.path.join(out_dir, name))
    body = open(os.path.join(out_dir, "data.js"), encoding="utf-8").read()
    assert body.startswith("window.TAXONOMY = ")
    payload = json.loads(body[len("window.TAXONOMY = ") :].rstrip().rstrip(";"))
    assert "_unreached" not in payload  # internal keys stripped from output
    assert payload["tops"] == ["Animal"]
