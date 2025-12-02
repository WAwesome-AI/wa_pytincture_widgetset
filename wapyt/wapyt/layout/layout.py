from __future__ import annotations

import json
from typing import Any, Callable, Dict, Optional, TypeVar, Union

from wapyt._runtime import js, create_proxy, require_js
from wapyt.layout.layout_config import LayoutConfig, CellConfig
from wapyt.cardpanel import CardPanel, CardPanelConfig
from wapyt.sidebar import Sidebar, SidebarConfig
from wapyt.resourceboard import ResourceBoard, ResourceBoardConfig

TLayout = TypeVar("TLayout", bound="Layout")


class LoadUICaller(type):
    def __call__(cls, *args, **kwargs):
        obj = super().__call__(*args, **kwargs)
        if hasattr(obj, "load_ui"):
            obj.load_ui()
        return obj


class Layout(object, metaclass=LoadUICaller):
    """
    DOM-driven layout wrapper.
    """

    layout_config: Optional[Union[LayoutConfig, Dict[str, Any]]] = None

    def __init__(self, config: Optional[Union[LayoutConfig, Dict[str, Any]]] = None, *, mainwindow: bool = False, **kwargs: Any) -> None:
        #require_js("Layout")
        self.parent = kwargs.get("parent")
        base_config = config or self.layout_config
        if base_config is None:
            base_config = LayoutConfig(
                css="wapyt-mainwindow",
                rows=[
                    CellConfig(id="mainwindow_header", height="auto"),
                    CellConfig(id="mainwindow", grow=1),
                ],
            )

        if hasattr(base_config, "to_dict"):
            config_dict = base_config.to_dict()
        else:
            config_dict = base_config or {}

        config_json = json.dumps(config_dict)
        root_target: Optional[str] = "maindiv" if mainwindow else None
        self.layout = js.wapyt.Layout.new(root_target, js.JSON.parse(config_json))
        self.initialized = False

    # ------------------------------------------------------------------
    # Hooks
    # ------------------------------------------------------------------

    def load_ui(self, *_: Any, **__: Any) -> None:  # pragma: no cover - subclass hook
        pass

    # ------------------------------------------------------------------
    # Widget helpers
    # ------------------------------------------------------------------

    def add_layout(self, id: str = "mainwindow", layout_config: Optional[LayoutConfig] = None) -> TLayout:
        nested = Layout(config=layout_config)
        self.attach(id, nested.layout)
        return nested

    def add_chat(self, id: str = "mainwindow", chat_config: Optional["ChatConfig"] = None) -> "Chat":
        from ..chat import Chat, ChatConfig

        chat_widget = Chat(config=chat_config or ChatConfig(), container=self.layout.getCell(id))
        return chat_widget

    def add_cardpanel(self, id: str = "mainwindow", cardpanel_config: Optional["CardPanelConfig"] = None) -> "CardPanel":
        cardpanel_widget = CardPanel(config=cardpanel_config or CardPanelConfig(), container=self.layout.getCell(id))
        return cardpanel_widget

    def add_tabwidget(self, id: str = "mainwindow", tab_config: Optional["TabWidgetConfig"] = None) -> "TabWidget":
        from ..tabwidget import TabWidget, TabWidgetConfig

        tab_widget = TabWidget(config=tab_config or TabWidgetConfig(), container=self.layout.getCell(id))
        return tab_widget

    def add_sidebar(self, id: str = "mainwindow", sidebar_config: Optional["SidebarConfig"] = None) -> "Sidebar":
        sidebar_widget = Sidebar(config=sidebar_config or SidebarConfig(), container=self.layout.getCell(id))
        return sidebar_widget

    def add_resourceboard(self, id: str = "mainwindow", resourceboard_config: Optional["ResourceBoardConfig"] = None) -> "ResourceBoard":
        board_widget = ResourceBoard(config=resourceboard_config or ResourceBoardConfig(), container=self.layout.getCell(id))
        return board_widget

    def attach_html(self, id: str, html: str) -> None:
        self.layout.attachHTML(id, html)

    def attach(self, id: str, component: Any, config: Optional[Dict[str, Any]] = None) -> Any:
        payload = js.JSON.parse(json.dumps(config or {}))
        return self.layout.attach(id, component, payload)

    # ------------------------------------------------------------------
    # Layout level API
    # ------------------------------------------------------------------

    def destructor(self) -> None:
        self.layout.destructor()

    def for_each(self, callback: Callable[[Any, int, Any], Any]) -> None:
        proxy = create_proxy(callback)
        self.layout.forEach(proxy)

    def get_cell(self, id: str) -> Any:
        return self.layout.getCell(id)

    def progress_show(self, id: Optional[str] = None, text: Optional[str] = None) -> None:
        self.layout.progressShow(id or None, text or None)

    def progress_hide(self, id: Optional[str] = None) -> None:
        self.layout.progressHide(id or None)

    def remove_cell(self, id: str) -> None:
        self.layout.removeCell(id)

    def resize(self, id: Optional[str] = None) -> None:
        self.layout.resize(id or None)

    # ------------------------------------------------------------------
    # Event helpers
    # ------------------------------------------------------------------

    def add_event_handler(self, event_name: str, handler: Callable) -> None:
        event_proxy = create_proxy(handler)
        self.layout.registerEvent(event_name, event_proxy)

    # Convenience wrappers ------------------------------------------------

    def after_add(self, handler: Callable) -> None:
        self.add_event_handler("afterAdd", handler)

    def after_remove(self, handler: Callable) -> None:
        self.add_event_handler("afterRemove", handler)

    def after_show(self, handler: Callable) -> None:
        self.add_event_handler("afterShow", handler)

    def after_hide(self, handler: Callable) -> None:
        self.add_event_handler("afterHide", handler)

    def before_remove(self, handler: Callable) -> None:
        self.add_event_handler("beforeRemove", handler)

    # ------------------------------------------------------------------
    # Cell helpers
    # ------------------------------------------------------------------

    def _cell_call(self, id: str, method: str, *args: Any) -> Any:
        cell = self.layout.getCell(id)
        if not cell:
            raise KeyError(f"Unknown layout cell '{id}'")
        return getattr(cell, method)(*args)

    def collapse(self, id: str) -> None:
        self._cell_call(id, "collapse")

    def expand(self, id: str) -> None:
        self._cell_call(id, "expand")

    def toggle(self, id: str) -> None:
        self._cell_call(id, "toggle")

    def detach(self, id: str) -> None:
        self._cell_call(id, "detach")

    def hide(self, id: str) -> None:
        self._cell_call(id, "hide")

    def show(self, id: str) -> None:
        self._cell_call(id, "show")

    def is_visible(self, id: str) -> bool:
        return bool(self._cell_call(id, "isVisible"))

    def get_parent(self, id: str) -> Any:
        return self._cell_call(id, "getParent")

    def get_widget(self, id: str) -> Any:
        return self._cell_call(id, "getWidget")

    def attach_html_cell(self, id: str, html: str) -> None:
        self.attach_html(id, html)

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def wait_for_element(self, selector: str, callback: Callable[[], Any], interval_ms: int = 100) -> None:
        def _check():
            if js.document.querySelector(selector):
                callback()
            else:
                js.window.setTimeout(create_proxy(_check), interval_ms)

        _check()


class MainWindow(Layout):
    """
    Legacy-compatible wrapper so existing apps can inherit from `MainWindow`.
    """

    def __init__(self) -> None:
        super().__init__(mainwindow=True)
        self.initialized = True
        self.cookie_status = None

    def set_theme(self, theme: str) -> None:
        js.document.documentElement.setAttribute("data-wapyt-theme", theme)

    # Simple cookie helpers retained for compatibility -------------------

    def show_cookie_banner(self) -> None:
        banner = js.document.getElementById("cookie-banner")
        if banner:
            banner.style.display = "block"

    def hide_cookie_banner(self) -> None:
        banner = js.document.getElementById("cookie-banner")
        if banner:
            banner.style.display = "none"

    def accept_cookies(self, _event=None) -> None:
        js.document.cookie = "cookie_consent=accepted; path=/; max-age=31536000"
        self.hide_cookie_banner()
        self.cookie_status = True

    def reject_cookies(self, _event=None) -> None:
        js.document.cookie = "cookie_consent=rejected; path=/; max-age=31536000"
        self.hide_cookie_banner()
        self.cookie_status = False

    def check_cookie_consent(self) -> None:
        cookies = js.document.cookie or ""
        if "cookie_consent=accepted" in cookies or "cookie_consent=rejected" in cookies:
            return
        self.show_cookie_banner()
        accept_button = js.document.getElementById("accept-btn")
        reject_button = js.document.getElementById("reject-btn")
        if accept_button:
            accept_button.addEventListener("click", create_proxy(self.accept_cookies))
        if reject_button:
            reject_button.addEventListener("click", create_proxy(self.reject_cookies))
