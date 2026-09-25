"""
Config serialisation for the widgets added for IguanaXterm.

These run under CPython with no browser: the config dataclasses are pure, and
the ``.to_dict()`` payload is the contract with the JS side, so a silent rename
on either side shows up here.
"""
from __future__ import annotations

import json

import pytest

from wapyt.datatable.datatable_config import (
    ColumnConfig,
    DataTableConfig,
    TableAction,
)
from wapyt.form.form_config import FieldConfig, FormConfig, SelectOption
from wapyt.terminal.terminal_config import TerminalConfig, TerminalTheme
from wapyt.tree.tree_config import TreeAction, TreeConfig, TreeItem


def roundtrip(config) -> dict:
    """Every payload has to survive json.dumps — it crosses the FFI as JSON."""
    return json.loads(json.dumps(config.to_dict()))


# ── Terminal ──────────────────────────────────────────────────────────────────


def test_terminal_defaults_are_camel_cased():
    payload = roundtrip(TerminalConfig(ws_url="/ws/terminal/1"))
    assert payload["wsUrl"] == "/ws/terminal/1"
    assert payload["assetBase"] == "/xterm"
    assert payload["reconnectMaxAttempts"] == 5
    assert payload["search"] is True


def test_terminal_omits_unset_fields_so_js_defaults_win():
    payload = roundtrip(TerminalConfig())
    for absent in ("wsUrl", "fontFamily", "fontSize", "scrollback", "theme"):
        assert absent not in payload


def test_terminal_theme_is_nested_and_camel_cased():
    payload = roundtrip(
        TerminalConfig(theme=TerminalTheme(background="#000", cursor_accent="#fff"))
    )
    assert payload["theme"] == {"background": "#000", "cursorAccent": "#fff"}


def test_terminal_clipboard_is_on_by_default_and_can_be_turned_off():
    assert roundtrip(TerminalConfig())["clipboard"] is True
    # False must survive _clean(): dropping it would let the JS default win.
    assert roundtrip(TerminalConfig(clipboard=False))["clipboard"] is False


def test_terminal_extra_passes_through():
    payload = roundtrip(TerminalConfig(extra={"customFlag": 7}))
    assert payload["customFlag"] == 7


# ── Form ──────────────────────────────────────────────────────────────────────


def test_field_defaults_are_minimal():
    """
    An unset label is omitted, not defaulted here — form.js falls back to the
    id at render time. (ColumnConfig fills `header` in Python instead; the two
    differ, and this pins which is which.)
    """
    payload = roundtrip(FormConfig(fields=[FieldConfig(id="host")]))
    field = payload["fields"][0]
    assert field == {"id": "host", "type": "text"}


def test_field_falsy_flags_are_omitted_not_sent_as_false():
    # required/disabled/readonly map to None when false so the JS default wins.
    field = roundtrip(FormConfig(fields=[FieldConfig(id="x")]))["fields"][0]
    assert "required" not in field
    assert "disabled" not in field


def test_field_zero_value_survives():
    """A falsy-but-real value must not be stripped by the None filter."""
    field = roundtrip(FormConfig(fields=[FieldConfig(id="port", value=0)]))["fields"][0]
    assert field["value"] == 0


def test_select_options_normalise():
    payload = roundtrip(
        FormConfig(
            fields=[
                FieldConfig(
                    id="type",
                    type="select",
                    options=[SelectOption("ssh", "SSH"), SelectOption("telnet")],
                )
            ]
        )
    )
    assert payload["fields"][0]["options"] == [
        {"value": "ssh", "label": "SSH"},
        {"value": "telnet", "label": "telnet"},
    ]


def test_validation_metadata_is_camel_cased():
    field = roundtrip(
        FormConfig(
            fields=[
                FieldConfig(
                    id="confirm",
                    min_length=8,
                    matches="password",
                    matches_message="No match",
                )
            ]
        )
    )["fields"][0]
    assert field["minLength"] == 8
    assert field["matches"] == "password"
    assert field["matchesMessage"] == "No match"


# ── DataTable ─────────────────────────────────────────────────────────────────


def test_column_defaults_header_to_id():
    column = roundtrip(DataTableConfig(columns=[ColumnConfig(id="name")]))["columns"][0]
    assert column["header"] == "name"
    assert column["sortable"] is True


def test_column_sort_by_is_camel_cased():
    column = roundtrip(
        DataTableConfig(columns=[ColumnConfig(id="size", sort_by="size_bytes")])
    )["columns"][0]
    assert column["sortBy"] == "size_bytes"


def test_empty_header_is_preserved():
    """An icon column wants a blank header, which must not fall back to the id."""
    column = roundtrip(
        DataTableConfig(columns=[ColumnConfig(id="icon", header="", type="icon")])
    )["columns"][0]
    assert column["header"] == ""
    assert column["type"] == "icon"


def test_table_action_separator_drops_every_other_field():
    payload = roundtrip(
        DataTableConfig(context_actions=[TableAction(separator=True)])
    )
    assert payload["contextActions"] == [{"separator": True}]


def test_table_action_danger_flag():
    action = roundtrip(
        DataTableConfig(context_actions=[TableAction("rm", "Delete", danger=True)])
    )["contextActions"][0]
    assert action["danger"] is True


def test_group_dirs_first_is_camel_cased():
    payload = roundtrip(DataTableConfig(group_dirs_first="is_dir"))
    assert payload["groupDirsFirst"] == "is_dir"


# ── Tree ──────────────────────────────────────────────────────────────────────


def test_tree_item_nests_children():
    payload = roundtrip(
        TreeConfig(
            items=[
                TreeItem(
                    id="prod",
                    label="Production",
                    badge=2,
                    items=[TreeItem(id="a"), TreeItem(id="b")],
                )
            ]
        )
    )
    root = payload["items"][0]
    assert root["badge"] == 2
    assert [child["id"] for child in root["items"]] == ["a", "b"]


def test_tree_leaf_has_no_items_key():
    leaf = roundtrip(TreeConfig(items=[TreeItem(id="a")]))["items"][0]
    assert "items" not in leaf
    assert leaf["label"] == "a"


def test_tree_action_scope_defaults_to_any():
    action = roundtrip(
        TreeConfig(context_actions=[TreeAction("edit", "Edit")])
    )["contextActions"][0]
    assert action["scope"] == "any"


@pytest.mark.parametrize("scope", ["any", "branch", "leaf"])
def test_tree_action_scopes_round_trip(scope):
    action = roundtrip(
        TreeConfig(context_actions=[TreeAction("x", "X", scope=scope)])
    )["contextActions"][0]
    assert action["scope"] == scope


def test_tree_action_kinds_are_omitted_unless_given():
    action = roundtrip(
        TreeConfig(context_actions=[TreeAction("x", "X")])
    )["contextActions"][0]
    assert "kinds" not in action


def test_tree_action_kinds_round_trip():
    action = roundtrip(
        TreeConfig(context_actions=[TreeAction("x", "X", kinds=("database", "server"))])
    )["contextActions"][0]
    assert action["kinds"] == ["database", "server"]


# ── File transfer ─────────────────────────────────────────────────────────────


def test_filetransfer_exports_everything_it_defines():
    """
    The package re-exports by hand, and resume() was once defined but not
    exported: the app then failed with AttributeError at the moment someone
    pressed Resume. Every public callable in the module must be reachable
    from the package.
    """
    import inspect

    import wapyt.filetransfer as package
    from wapyt.filetransfer import filetransfer as module

    public = {
        name for name, value in vars(module).items()
        if not name.startswith("_") and inspect.isfunction(value)
        and value.__module__ == module.__name__
    }
    missing = sorted(name for name in public if not hasattr(package, name))
    assert missing == [], f"defined but not exported: {missing}"
    assert set(package.__all__) >= public
