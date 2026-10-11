"""
MediaPlayer widget: video and audio with a queue — in place, as a bar, or inline.
"""
from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from .._runtime import create_proxy, require_js, to_plain
from .mediaplayer_config import (
    MODES,
    REPEAT_MODES,
    MediaItem,
    MediaPlayerConfig,
    MediaTextTrack,
    item_payload,
)

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

ItemLike = Union[MediaItem, Dict[str, Any]]


def _to_js(value: Any) -> Any:
    return js.JSON.parse(json.dumps(value))


def resolve_patch(
    src: Optional[str] = None,
    *,
    type: Optional[str] = None,
    kind: Optional[str] = None,
    poster: Optional[str] = None,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    start: Optional[float] = None,
    text_tracks: Optional[Sequence[Union[MediaTextTrack, Dict[str, Any]]]] = None,
    data: Any = None,
    error: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    live: Optional[bool] = None,
) -> Dict[str, Any]:
    """The fields ``MediaPlayer.resolve`` sends, in the JS payload's shape."""
    from .mediaplayer_config import _check_headers
    _check_headers(headers, "resolve headers")
    patch: Dict[str, Any] = {
        "src": src, "type": type, "kind": kind, "poster": poster, "title": title,
        "subtitle": subtitle, "start": start, "data": data, "error": error,
        "headers": dict(headers) if headers else None, "live": live,
    }
    if text_tracks is not None:
        patch["textTracks"] = [t.to_dict() if hasattr(t, "to_dict") else t for t in text_tracks]
    if kind is not None:
        MediaItem(kind=kind).to_dict()  # validates
    return {key: value for key, value in patch.items() if value is not None}


class MediaPlayer:
    """
    Plays video and audio, one item or a queue.

    Quick start — a film in a layout cell::

        player = self.add_mediaplayer("main", MediaPlayerConfig(items=[
            MediaItem(src="/media/film.m3u8", title="Sintel", poster="/art/sintel.jpg",
                      text_tracks=[MediaTextTrack("/subs/sintel.en.vtt", "English", "en")]),
        ]))

    An album docked at the foot of the window, each track's URL fetched only
    when it is reached::

        player = self.add_mediaplayer("dock", MediaPlayerConfig(mode="audio", dock="bottom"))
        player.on_resolve(fetch_stream)          # async def fetch_stream(item) -> {"src": ..., "type": "hls"}
        player.on_unload(close_stream)           # the item is done with: end its session
        player.load([MediaItem(title=t["title"], subtitle=artist, poster=cover, kind="audio",
                               data={"id": t["id"]}) for t in tracks])

    A voice message in a chat bubble::

        MediaPlayer(MediaPlayerConfig(mode="compact", group="chat",
                                      items=[MediaItem(src=clip_url, kind="audio")]), container=bubble_el)

    Every event payload carries ``index``, ``title``, ``subtitle``, ``kind``
    and the item's own ``data``.
    """

    def __init__(
        self,
        config: Optional[MediaPlayerConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("MediaPlayer requires a container or a root element.")
        require_js("MediaPlayer")
        self.config = config or MediaPlayerConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        target = self._resolve_root(container=container, root=root)
        if target is None:
            raise RuntimeError("Unable to resolve root element for MediaPlayer.")
        self.player = js.wapyt.MediaPlayer.new(target, _to_js(self.config.to_dict()))

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        if container is not None:
            if hasattr(container, "getContainer"):
                return container.getContainer()
            if hasattr(container, "element"):
                return container.element
            return container
        if isinstance(root, str):
            return js.document.querySelector(root) or js.document.getElementById(root)
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        def call(payload=None):
            result = handler(to_plain(payload))
            if inspect.isawaitable(result):
                asyncio.ensure_future(result)
            return None

        proxy = create_proxy(call)
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.player.on(event_name, proxy)

    # Queue -------------------------------------------------------------

    def load(self, items: Sequence[ItemLike], start_index: int = 0, autoplay: bool = True) -> None:
        """Replace the queue and start at ``start_index``."""
        self.player.load(_to_js([item_payload(i) for i in items]), int(start_index), bool(autoplay))

    def play_item(self, item: ItemLike, autoplay: bool = True) -> None:
        """Play one item as a queue of one."""
        self.load([item], 0, autoplay)

    def add(self, items: Union[ItemLike, Sequence[ItemLike]], at: Optional[int] = None) -> None:
        """Add to the queue, at the end or at ``at``."""
        if isinstance(items, (MediaItem, dict)):
            items = [items]
        self.player.add(_to_js([item_payload(i) for i in items]), js.undefined if at is None else int(at))

    def remove(self, index: int) -> None:
        self.player.remove(int(index))

    def clear(self) -> None:
        self.player.clear()

    def play_index(self, index: int) -> None:
        self.player.playIndex(int(index))

    def next(self) -> None:
        self.player.next()

    def previous(self) -> None:
        """Back to the start of the item, or the previous one within 3 s of its start."""
        self.player.previous()

    def resolve(self, index: int, src: Optional[str] = None, **fields: Any) -> None:
        """
        Supply an item's source after a ``resolve`` event: ``src`` plus any of
        ``type``, ``kind``, ``poster``, ``title``, ``subtitle``, ``start``,
        ``text_tracks``, ``data``. ``error="…"`` instead reports that it could
        not be resolved.
        """
        self.player.resolve(int(index), _to_js(resolve_patch(src, **fields)))

    # Transport ---------------------------------------------------------

    def play(self) -> None:
        self.player.play()

    def pause(self) -> None:
        self.player.pause()

    def toggle(self) -> None:
        self.player.toggle()

    def stop(self) -> None:
        """Stop and unload the current item (``unload`` fires)."""
        self.player.stop()

    def seek(self, seconds: float) -> None:
        self.player.seek(float(seconds))

    def skip(self, seconds: float) -> None:
        """Seek relative to now; negative goes back."""
        self.player.skip(float(seconds))

    def set_volume(self, volume: float) -> None:
        self.player.setVolume(max(0.0, min(1.0, float(volume))))

    def set_muted(self, muted: bool = True) -> None:
        self.player.setMuted(bool(muted))

    def set_rate(self, rate: float) -> None:
        self.player.setRate(float(rate))

    def set_shuffle(self, shuffle: bool = True) -> None:
        self.player.setShuffle(bool(shuffle))

    def set_repeat(self, repeat: str) -> None:
        if repeat not in REPEAT_MODES:
            raise ValueError(f"repeat must be one of {REPEAT_MODES}")
        self.player.setRepeat(repeat)

    def set_text_track(self, index: Optional[int]) -> None:
        """Show text track ``index`` (in ``state()["tracks"]["text"]``), or none."""
        self.player.setTextTrack(-1 if index is None else int(index))

    def set_audio_track(self, index: int) -> None:
        self.player.setAudioTrack(int(index))

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.player.setMode(mode)

    def fullscreen(self, on: Optional[bool] = None) -> None:
        """Toggle full screen, or set it. Browsers allow it only from a user gesture."""
        self.player.fullscreen(js.undefined if on is None else bool(on))

    def refresh(self, index: Optional[int] = None, keep_position: bool = True) -> None:
        """Fetch an item's URL again — an expired signed URL, a dropped server
        session — and carry on. The current item (the default) emits
        ``unload`` (reason ``refresh``), then ``resolve`` with ``refresh`` and
        ``position``, and resumes there (a live item at its live edge).
        Another item forgets its URL and is resolved when it is reached."""
        self.player.refresh(-1 if index is None else int(index), bool(keep_position))

    def set_quality(self, level: Optional[int] = None) -> None:
        """An HLS rendition by its ``index`` in ``on_levels``; None for
        automatic (the default), which adapts to the connection."""
        self.player.setQuality(-1 if level is None else int(level))

    def set_actions(self, actions: Sequence[Union["MediaAction", Dict[str, Any]]]) -> None:
        """Replace the app's buttons in the bar (:class:`MediaAction`)."""
        self.player.setActions(_to_js([a.to_dict() if hasattr(a, "to_dict") else a for a in actions]))

    def set_action(self, action_id: str, *, icon: Optional[str] = None, label: Optional[str] = None,
                   pressed: Optional[bool] = None, disabled: Optional[bool] = None) -> None:
        """Change one of them; omitted fields stay as they are."""
        patch = {k: v for k, v in (("icon", icon), ("label", label), ("pressed", pressed), ("disabled", disabled)) if v is not None}
        self.player.setAction(action_id, _to_js(patch))

    def state(self) -> Dict[str, Any]:
        """``index``, ``count``, ``paused``, ``ended``, ``position``, ``duration``
        (None for live), ``live``, ``volume``, ``muted``, ``rate``, ``shuffle``,
        ``repeat``, ``mode``, ``order``, ``tracks`` (``text`` / ``audio``) and
        ``quality`` (``levels`` / ``current`` / ``auto``)."""
        return to_plain(self.player.getState())

    # Events ------------------------------------------------------------

    def on_play(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("play", handler)

    def on_pause(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("pause", handler)

    def on_ended(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item played to its end (before the queue moves on)."""
        self._bind_event("ended", handler)

    def on_change(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The current item changed: payload plus ``previous`` and ``reason``
        (``load``, ``select``, ``next``, ``previous``, ``ended``, ``remove``)."""
        self._bind_event("change", handler)

    def on_unload(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The current item is no longer current (``reason`` says why): the
        place to close a streaming session or forget a signed URL."""
        self._bind_event("unload", handler)

    def on_resolve(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        An item without a ``src`` became current. The handler may call
        ``resolve`` itself, or return (or, if async, resolve to) a dict of
        ``resolve`` fields — ``{"src": url, "type": "hls"}`` — which is applied
        to that item. Raising reports the failure in the player.
        """
        def handle(payload: Dict[str, Any]):
            index = payload.get("index", -1)

            def apply(result: Any) -> None:
                if isinstance(result, dict):
                    self.resolve(index, **result)
                elif isinstance(result, str):
                    self.resolve(index, result)

            try:
                result = handler(payload)
            except Exception as error:  # noqa: BLE001 - surfaced in the player
                self.resolve(index, error=str(error) or "Could not load this item.")
                return None
            if inspect.isawaitable(result):
                async def finish():
                    try:
                        apply(await result)
                    except Exception as error:  # noqa: BLE001
                        self.resolve(index, error=str(error) or "Could not load this item.")
                return finish()
            apply(result)
            return None

        self._bind_event("resolve", handle)

    def on_time_update(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Every ``time_update_interval`` seconds while playing: payload plus
        ``position`` and ``duration``."""
        self._bind_event("timeupdate", handler)

    def on_error(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Playback failed: payload plus ``message``, ``fatal``, ``code`` and
        ``status``. ``code`` is ``network``, ``media``, ``decode``,
        ``unsupported``, ``aborted``, ``csp`` (the page's policy blocks the
        media) or ``error``; ``status`` is the HTTP status of a failed HLS
        request (401/403/410 usually mean an expired URL: ``refresh()`` it),
        and None where the browser gives none (plain files)."""
        self._bind_event("error", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """One of the app's buttons (``MediaPlayerConfig.actions``) was pressed:
        the current item's payload plus ``action`` (its id) and ``rect`` (the
        button on screen: ``left``, ``top``, ``right``, ``bottom``)."""
        self._bind_event("action", handler)

    def on_levels(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An HLS stream's renditions are known, or another is playing:
        ``levels`` (``index``, ``height``, ``width``, ``bitrate``, ``label``),
        ``current`` (the index playing) and ``auto``."""
        self._bind_event("levels", handler)

    def on_queue_end(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The last item ended (or ``next`` was asked for past it) with repeat off."""
        self._bind_event("queueend", handler)

    def on_tracks(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Text and audio tracks became known or changed: ``text`` / ``audio`` lists."""
        self._bind_event("tracks", handler)

    def on_volume(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("volume", handler)

    def on_mode(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The shape changed (``auto`` moving between a video and an audio item)."""
        self._bind_event("mode", handler)

    def on_fullscreen(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("fullscreen", handler)

    def destroy(self) -> None:
        self.player.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["MediaPlayer", "MediaPlayerConfig", "MediaItem", "MediaTextTrack", "MediaAction"]
