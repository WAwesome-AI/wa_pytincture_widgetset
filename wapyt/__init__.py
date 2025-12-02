"""
wA PyTincture widgetset entrypoint.
"""

__widgetset__ = "wapyt"
__version__ = "0.1.0"
__version_tuple__ = tuple(int(part) for part in __version__.split("."))
__description__ = "DHTMLX-free widgetset for PyTincture apps"

from .layout.layout import Layout, MainWindow
from .layout.layout_config import LayoutConfig, CellConfig
from .chat.chat import Chat, ChatConfig, ChatAgentConfig, ChatMessageConfig
from .cardpanel.cardpanel import CardPanel, CardPanelConfig, CardPanelCardConfig
from .tabwidget.tabwidget import TabWidget, TabWidgetConfig, TabConfig
from .sidebar.sidebar import Sidebar
from .sidebar.sidebar_config import SidebarConfig, SidebarItem
from .modal.modal import ModalWindow, ModalConfig
from .resourceboard.resourceboard import ResourceBoard
from .resourceboard.resourceboard_config import ResourceBoardConfig, ResourceItem

__all__ = [
    "Layout",
    "MainWindow",
    "LayoutConfig",
    "CellConfig",
    "Chat",
    "ChatConfig",
    "ChatAgentConfig",
    "ChatMessageConfig",
    "CardPanel",
    "CardPanelConfig",
    "CardPanelCardConfig",
    "TabWidget",
    "TabWidgetConfig",
    "TabConfig",
    "Sidebar",
    "SidebarConfig",
    "SidebarItem",
    "ModalWindow",
    "ModalConfig",
    "ResourceBoard",
    "ResourceBoardConfig",
    "ResourceItem",
]
