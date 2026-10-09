"""CPython tests for the MediaPlayer config (no browser needed)."""
from __future__ import annotations

import pytest

import wapyt
from wapyt import MediaItem, MediaPlayerConfig, MediaTextTrack
from wapyt.mediaplayer.mediaplayer import resolve_patch


def test_exported_with_a_layout_helper():
    from wapyt.layout.layout import Layout
    assert {"MediaPlayer", "MediaPlayerConfig", "MediaItem", "MediaTextTrack"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_mediaplayer")


def test_defaults_are_minimal():
    assert MediaPlayerConfig().to_dict() == {"mode": "auto"}
    assert MediaItem("/a.mp4").to_dict() == {"src": "/a.mp4"}
    assert MediaTextTrack("/a.vtt").to_dict() == {"src": "/a.vtt"}


def test_an_item_without_src_is_allowed():
    # Resolved when it becomes current (the "resolve" event).
    assert MediaItem(title="Later", data={"id": 7}).to_dict() == {"title": "Later", "data": {"id": 7}}


def test_options_are_camel_cased():
    payload = MediaPlayerConfig(
        items=[MediaItem("/a.m3u8", title="A", subtitle="S", album="Al", poster="/p.jpg", type="hls",
                         kind="video", start=12.5, data={"id": 1},
                         text_tracks=[MediaTextTrack("/a.vtt", "English", "en", kind="captions", default=True)])],
        mode="audio", autoplay=True, controls=False, muted=True, volume=0.5, rate=1.5, repeat="all",
        shuffle=True, dock="bottom", group="chat", keyboard=False, media_session=False, queue_line=False,
        show_shuffle=False, show_repeat=False, time_update_interval=0, preload="none",
        cross_origin="anonymous", hls_config={"maxBufferLength": 30}, height=64, empty_text="—",
        aria_label="Music",
    ).to_dict()
    assert payload["items"] == [{"src": "/a.m3u8", "title": "A", "subtitle": "S", "album": "Al", "poster": "/p.jpg",
                                 "type": "hls", "kind": "video", "start": 12.5, "data": {"id": 1},
                                 "textTracks": [{"src": "/a.vtt", "label": "English", "language": "en",
                                                 "kind": "captions", "default": True}]}]
    for key, value in {"mode": "audio", "autoplay": True, "controls": False, "muted": True, "volume": 0.5,
                       "rate": 1.5, "repeat": "all", "shuffle": True, "dock": "bottom", "group": "chat",
                       "keyboard": False, "mediaSession": False, "queueLine": False, "showShuffle": False,
                       "showRepeat": False, "timeUpdateInterval": 0, "preload": "none",
                       "crossOrigin": "anonymous", "hlsConfig": {"maxBufferLength": 30}, "height": 64,
                       "emptyText": "—", "ariaLabel": "Music"}.items():
        assert payload[key] == value, key


def test_dict_items_pass_through():
    assert MediaPlayerConfig(items=[{"src": "/x.mp3"}]).to_dict()["items"] == [{"src": "/x.mp3"}]


@pytest.mark.parametrize("bad", [dict(mode="theatre"), dict(repeat="twice"), dict(dock="top"), dict(preload="all"),
                                 dict(cross_origin="yes"), dict(volume=1.5), dict(rate=8),
                                 dict(time_update_interval=-1),
                                 dict(items=[MediaItem("/a.mp4")], start_index=1)])
def test_invalid_configs(bad):
    with pytest.raises(ValueError):
        MediaPlayerConfig(**bad).to_dict()


@pytest.mark.parametrize("bad", [dict(kind="podcast"), dict(start=-1), dict(data={1, 2})])
def test_invalid_items(bad):
    with pytest.raises(ValueError):
        MediaItem("/a.mp4", **bad).to_dict()


def test_invalid_text_tracks():
    with pytest.raises(ValueError):
        MediaTextTrack("/a.vtt", kind="karaoke").to_dict()
    with pytest.raises(ValueError):
        MediaTextTrack("").to_dict()


def test_resolve_patch_shape():
    assert resolve_patch("/s.m3u8", type="hls") == {"src": "/s.m3u8", "type": "hls"}
    assert resolve_patch(error="gone") == {"error": "gone"}
    assert resolve_patch("/a", text_tracks=[MediaTextTrack("/a.vtt", "En")]) == {
        "src": "/a", "textTracks": [{"src": "/a.vtt", "label": "En"}]}
    with pytest.raises(ValueError):
        resolve_patch("/a", kind="slideshow")


def test_assets_are_in_the_manifest_in_order():
    import json
    from pathlib import Path
    manifest = json.loads((Path(wapyt.__file__).parent / "pytincture-assets.json").read_text())
    paths = [a["path"] for a in manifest["assets"]]
    assert paths.index("wapyt/assets/vendor-hlsjs.light.min.js") < paths.index("wapyt/assets/mediaplayer.js")
