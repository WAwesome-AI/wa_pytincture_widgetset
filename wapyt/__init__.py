"""
wA PyTincture widgetset entrypoint.
"""

__widgetset__ = "wapyt"
__version__ = "0.1.0"
__version_tuple__ = tuple(int(part) for part in __version__.split("."))
__description__ = "DHTMLX-free widgetset for PyTincture apps"

from .layout.layout import Layout, MainWindow
from .layout.layout_config import LayoutConfig, CellConfig
from .chat.chat import Chat, ChatStreamError
from .chat.chat_config import ChatConfig, ChatAgentConfig, ChatMessageConfig
from .cardpanel.cardpanel import CardPanel, CardPanelConfig, CardPanelCardConfig
from .tabwidget.tabwidget import TabWidget, TabWidgetConfig, TabConfig
from .sidebar.sidebar import Sidebar
from .sidebar.sidebar_config import SidebarConfig, SidebarItem
from .modal.modal import ModalWindow, ModalConfig
from .form.form import Form
from .datatable.datatable import DataTable
from . import filetransfer
from .filetransfer.filetransfer import Capabilities, PickedFile, TransferResult
from .tree.tree import Tree
from .tree.tree_config import TreeConfig, TreeItem, TreeAction
from .datatable.datatable_config import DataTableConfig, ColumnConfig, TableAction
from .form.form_config import FormConfig, FieldConfig, SelectOption
from .terminal.terminal import Terminal
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
    "ModalWindow",
    "ModalConfig",
    "Form",
    "DataTable",
    "filetransfer",
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
    "Terminal",
    "TerminalConfig",
    "TerminalTheme",
    "ResourceBoard",
    "ResourceBoardConfig",
    "ResourceItem",
]
