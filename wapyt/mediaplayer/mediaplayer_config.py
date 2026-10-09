from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Union

MODES = ("auto", "video", "audio", "compact")
REPEAT_MODES = ("off", "all", "one")
DOCKS = ("none", "bottom")
PRELOADS = ("none", "metadata", "auto")
CROSS_ORIGINS = ("anonymous", "use-credentials")
ITEM_KINDS = ("audio", "video")
TRACK_KINDS = ("subtitles", "captions", "descriptions", "chapters", "metadata")

Number = Union[int, float]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def _check(value: Any, allowed: Sequence[Any], what: str) -> None:
    if value not in allowed:
        raise ValueError(f"{what} must be one of {', '.join(map(repr, allowed))}, not {value!r}")


@dataclass
class MediaTextTrack:
    """
    A WebVTT text track for an item: subtitles, captions, chapters.

    Args:
        src: The ``.vtt`` URL. A track on another origin needs CORS and
            ``MediaPlayerConfig(cross_origin="anonymous")``.
        label: Shown in the player's subtitles menu.
        language: BCP 47 tag (``"en"``, ``"pt-BR"``).
        kind: ``subtitles`` (default), ``captions``, ``descriptions``,
            ``chapters`` or ``metadata``.
        default: Show this track when the item starts.
    """

    src: str
    label: Optional[str] = None
    language: Optional[str] = None
    kind: str = "subtitles"
    default: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if not self.src:
            raise ValueError("MediaTextTrack needs a src")
        _check(self.kind, TRACK_KINDS, "MediaTextTrack.kind")
        return _clean({
            "src": self.src,
            "label": self.label,
            "language": self.language,
            "kind": self.kind if self.kind != "subtitles" else None,
            "default": self.default or None,
        })


@dataclass
class MediaItem:
    """
    One thing to play: a film, an episode, a song, a voice message.

    Args:
        src: The media URL: a file, or an HLS playlist (``.m3u8``). Leave it
            out to resolve it when the item becomes current — the player emits
            ``resolve`` and waits for ``MediaPlayer.resolve`` (or the return
            value of an ``on_resolve`` handler). That is how a per-play session
            URL or an expiring signed link is fetched only when needed.
        title: Main line in the audio bar and the OS media controls.
        subtitle: Second line: an artist, a show, a sender.
        album: For the OS media controls.
        poster: Artwork URL: the video poster, and the cover in the audio bar.
        type: ``"hls"`` or a MIME type. Without one, ``.m3u8`` means HLS and
            the extension decides audio or video.
        kind: ``"audio"`` or ``"video"``, when the URL doesn't say (a
            server-generated stream URL usually doesn't).
        start: Start position in seconds.
        text_tracks: WebVTT tracks for this item.
        data: Anything JSON-serialisable; handed back in every event about the
            item (an id, a session) so the app never has to map indices back.
    """

    src: Optional[str] = None
    title: Optional[str] = None
    subtitle: Optional[str] = None
    album: Optional[str] = None
    poster: Optional[str] = None
    type: Optional[str] = None
    kind: Optional[str] = None
    start: Number = 0
    text_tracks: List[MediaTextTrack] = field(default_factory=list)
    data: Any = None

    def to_dict(self) -> Dict[str, Any]:
        if self.kind is not None:
            _check(self.kind, ITEM_KINDS, "MediaItem.kind")
        if self.start and self.start < 0:
            raise ValueError("MediaItem.start must not be negative")
        if self.data is not None:
            try:
                json.dumps(self.data)
            except (TypeError, ValueError) as error:
                raise ValueError(f"MediaItem.data must be JSON-serialisable: {error}") from error
        return _clean({
            "src": self.src,
            "title": self.title,
            "subtitle": self.subtitle,
            "album": self.album,
            "poster": self.poster,
            "type": self.type,
            "kind": self.kind,
            "start": self.start or None,
            "textTracks": [t.to_dict() if hasattr(t, "to_dict") else t for t in self.text_tracks] or None,
            "data": self.data,
        })


def item_payload(item: Union[MediaItem, Dict[str, Any]]) -> Dict[str, Any]:
    return item.to_dict() if hasattr(item, "to_dict") else dict(item)


@dataclass
class MediaPlayerConfig:
    """
    A media player: video in place, an audio bar, or a compact inline player.

    Args:
        items: The initial queue.
        start_index: Which item starts.
        mode: ``"auto"`` (video items show the picture, audio items the bar),
            ``"video"``, ``"audio"`` or ``"compact"`` (play, scrubber and time:
            for a chat message or a list row).
        autoplay: Start playing the first item. Browsers may refuse sound
            before a click; the player then waits with its play button.
        controls: Show the controls. ``False`` for a player driven entirely
            from Python.
        muted, volume, rate: Initial state (volume 0–1, rate 0.25–4).
        repeat: ``"off"``, ``"all"`` (the queue) or ``"one"``.
        shuffle: Start shuffled. Shuffle keeps the current item where it is
            and rearranges what is still to come.
        dock: ``"bottom"`` pins the audio bar to the foot of the window.
        group: An exclusive group name: starting one player pauses the others
            in the group (the voice messages of a chat).
        keyboard: Space/K play, ←/→ 5 s, J/L 10 s, ↑/↓ volume, M mute,
            F full screen, N/P next/previous, C subtitles.
        media_session: Drive the OS media keys and now-playing controls
            (the most recently played player owns them).
        queue_line: Show "3 of 14 · up next: …" in the audio bar.
        show_shuffle, show_repeat: Offer those buttons.
        time_update_interval: Seconds between ``timeupdate`` events to Python
            (0 turns them off). The scrubber itself updates every frame in JS.
        preload: ``"none"``, ``"metadata"`` (default) or ``"auto"``.
        cross_origin: ``"anonymous"`` or ``"use-credentials"`` for media and
            text tracks on another origin.
        hls_config: Options merged into hls.js's configuration.
        height: CSS height (a number means px). Video mode otherwise fills
            its container; give that container a height.
        empty_text: Shown in the bar with nothing loaded.
        aria_label: The region's accessible name.

    HLS plays through the bundled hls.js light build. The page's
    Content-Security-Policy must allow ``media-src 'self' blob:`` for it (and
    ``worker-src blob:``); the player names a blocked policy in its status line
    and an ``error`` event (``code == "csp"``).
    """

    items: List[MediaItem] = field(default_factory=list)
    start_index: int = 0
    mode: str = "auto"
    autoplay: bool = False
    controls: bool = True
    muted: bool = False
    volume: Number = 1.0
    rate: Number = 1.0
    repeat: str = "off"
    shuffle: bool = False
    dock: str = "none"
    group: Optional[str] = None
    keyboard: bool = True
    media_session: bool = True
    queue_line: bool = True
    show_shuffle: bool = True
    show_repeat: bool = True
    time_update_interval: Number = 1.0
    preload: str = "metadata"
    cross_origin: Optional[str] = None
    hls_config: Optional[Dict[str, Any]] = None
    height: Optional[Union[int, str]] = None
    empty_text: Optional[str] = None
    aria_label: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        _check(self.mode, MODES, "MediaPlayerConfig.mode")
        _check(self.repeat, REPEAT_MODES, "MediaPlayerConfig.repeat")
        _check(self.dock, DOCKS, "MediaPlayerConfig.dock")
        _check(self.preload, PRELOADS, "MediaPlayerConfig.preload")
        if self.cross_origin is not None:
            _check(self.cross_origin, CROSS_ORIGINS, "MediaPlayerConfig.cross_origin")
        if not 0 <= self.volume <= 1:
            raise ValueError("MediaPlayerConfig.volume must be between 0 and 1")
        if not 0.25 <= self.rate <= 4:
            raise ValueError("MediaPlayerConfig.rate must be between 0.25 and 4")
        if self.time_update_interval < 0:
            raise ValueError("MediaPlayerConfig.time_update_interval must not be negative")
        if self.items and not 0 <= self.start_index < len(self.items):
            raise ValueError("MediaPlayerConfig.start_index is outside the items")
        return _clean({
            "items": [item_payload(i) for i in self.items] or None,
            "startIndex": self.start_index or None,
            "mode": self.mode,
            "autoplay": self.autoplay or None,
            "controls": False if not self.controls else None,
            "muted": self.muted or None,
            "volume": self.volume if self.volume != 1 else None,
            "rate": self.rate if self.rate != 1 else None,
            "repeat": self.repeat if self.repeat != "off" else None,
            "shuffle": self.shuffle or None,
            "dock": self.dock if self.dock != "none" else None,
            "group": self.group,
            "keyboard": False if not self.keyboard else None,
            "mediaSession": False if not self.media_session else None,
            "queueLine": False if not self.queue_line else None,
            "showShuffle": False if not self.show_shuffle else None,
            "showRepeat": False if not self.show_repeat else None,
            "timeUpdateInterval": self.time_update_interval if self.time_update_interval != 1 else None,
            "preload": self.preload if self.preload != "metadata" else None,
            "crossOrigin": self.cross_origin,
            "hlsConfig": self.hls_config,
            "height": self.height,
            "emptyText": self.empty_text,
            "ariaLabel": self.aria_label,
        })
