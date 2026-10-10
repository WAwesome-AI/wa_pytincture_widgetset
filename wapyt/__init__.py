"""
wA PyTincture widgetset entrypoint.
"""

import re as _re

__widgetset__ = "wapyt"
# A plain string literal: pytincture reads it by parsing this file, and it must
# match pyproject.toml and the asset manifest (CI and the release workflow check).
__version__ = "0.2.0.dev1"
# The numeric release part only, so pre-releases ("0.2.0.dev0", "0.2.0rc1")
# do not break `int()`.
__version_tuple__ = tuple(int(part) for part in _re.match(r"\d+(?:\.\d+)*", __version__).group(0).split("."))
__description__ = "DHTMLX-free widgetset for PyTincture apps"

from .layout.layout import Layout, MainWindow
from .layout.layout_config import LayoutConfig, CellConfig
from .chat.chat import Chat, ChatStreamError
from .chat.chat_config import ChatConfig, ChatAgentConfig, ChatMessageConfig
from .cardpanel.cardpanel import CardPanel, CardPanelConfig, CardPanelCardConfig
from .tabwidget.tabwidget import TabWidget, TabWidgetConfig, TabConfig
from .sidebar.sidebar import Sidebar
from .sidebar.sidebar_config import SidebarConfig, SidebarHeading, SidebarItem, SidebarSeparator, SidebarSpacer
from .modal.modal import ModalWindow, ModalConfig
from .window.window import Window, WindowConfig
from .chart import Chart, ChartConfig, ChartDataset
from .mediaplayer import MediaAction, MediaItem, MediaPlayer, MediaPlayerConfig, MediaTextTrack
from .scheduler import Scheduler, SchedulerConfig, ScheduleItem
from .form.form import Form
from .datatable.datatable import DataTable
from . import filetransfer
from . import message
from .filetransfer.filetransfer import Capabilities, PickedFile, TransferResult
from .tree.tree import Tree
from .tree.tree_config import TreeConfig, TreeItem, TreeAction
from .datatable.datatable_config import DataTableConfig, ColumnConfig, TableAction
from .form.form_config import FormConfig, FieldConfig, FormButton, FormFieldset, FormSpacer, SelectOption
from .terminal.terminal import Terminal
from .toolbar.toolbar import Toolbar
from .contextmenu.contextmenu import ContextMenu
from .progressbar.progressbar import ProgressBar
from .progressbar.progressbar_config import ProgressBarConfig, progress_html
from .pagination.pagination import Pagination, page_slice
from .pagination.pagination_config import PaginationConfig
from .contextmenu.contextmenu_config import ContextMenuConfig, MenuItem
from .menubar.menubar import MenuBar
from .menubar.menubar_config import MenuBarConfig
from .listbox.listbox import Listbox
from .listbox.listbox_config import ListAction, ListboxConfig
from .kanban.kanban import Kanban
from .kanban.kanban_config import KanbanColumn, KanbanConfig
from .popup.popup import Popup, set_tooltips_enabled, tooltip
from .popup.popup_config import PopupConfig, tooltip_attr
from .toolbar.toolbar_config import (
    ToolbarButton,
    ToolbarConfig,
    ToolbarSeparator,
    ToolbarSpacer,
    ToolbarText,
)
from .terminal.terminal_config import TerminalConfig, TerminalTheme
from .resourceboard.resourceboard import ResourceBoard
from .resourceboard.resourceboard_config import ResourceBoardConfig, ResourceItem

__all__ = [
    "Layout",
    "MainWindow",
    "LayoutConfig",
    "CellConfig",
    "Chat",
    "ChatStreamError",
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
    "SidebarHeading",
    "SidebarSeparator",
    "SidebarSpacer",
    "ModalWindow",
    "Window",
    "WindowConfig",
    "Chart",
    "ChartConfig",
    "ChartDataset",
    "MediaPlayer",
    "MediaPlayerConfig",
    "MediaItem",
    "MediaTextTrack",
    "MediaAction",
    "Scheduler",
    "SchedulerConfig",
    "ScheduleItem",
    "ModalConfig",
    "Form",
    "DataTable",
    "filetransfer",
    "message",
    "Capabilities",
    "PickedFile",
    "TransferResult",
    "Tree",
    "TreeConfig",
    "TreeItem",
    "TreeAction",
    "DataTableConfig",
    "ColumnConfig",
    "TableAction",
    "FormConfig",
    "FieldConfig",
    "SelectOption",
    "FormButton",
    "FormFieldset",
    "FormSpacer",
    "Terminal",
    "TerminalConfig",
    "TerminalTheme",
    "Toolbar",
    "ContextMenu",
    "ProgressBar",
    "ProgressBarConfig",
    "progress_html",
    "Pagination",
    "PaginationConfig",
    "page_slice",
    "ContextMenuConfig",
    "MenuItem",
    "MenuBar",
    "MenuBarConfig",
    "Listbox",
    "ListboxConfig",
    "ListAction",
    "Kanban",
    "KanbanConfig",
    "KanbanColumn",
    "Popup",
    "PopupConfig",
    "tooltip",
    "tooltip_attr",
    "set_tooltips_enabled",
    "ToolbarConfig",
    "ToolbarButton",
    "ToolbarText",
    "ToolbarSeparator",
    "ToolbarSpacer",
    "ResourceBoard",
    "ResourceBoardConfig",
    "ResourceItem",
]
