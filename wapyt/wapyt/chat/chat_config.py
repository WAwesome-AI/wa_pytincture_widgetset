from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


def _clean_dict(source: Dict[str, Any]) -> Dict[str, Any]:
    """
    Utility helper that removes ``None`` values from a dictionary. Nested dictionaries
    are left intact to preserve explicit nulls if desired.
    """
    return {key: value for key, value in source.items() if value is not None}


@dataclass
class ChatAgentConfig:
    """
    Describes the assistant/agent that powers the chat experience.
    """
    name: str = "Assistant"
    subtitle: Optional[str] = None
    avatar: Optional[str] = None
    accent_color: Optional[str] = None
    tagline: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "name": self.name,
            "subtitle": self.subtitle,
            "avatar": self.avatar,
            "accentColor": self.accent_color,
            "tagline": self.tagline,
        }
        payload.update(self.extra or {})
        return _clean_dict(payload)


@dataclass
class ChatMessageConfig:
    """
    Represents a single chat message rendered within the widget.
    """
    role: str
    content: str
    id: Optional[str] = None
    name: Optional[str] = None
    timestamp: Optional[str] = None
    avatar: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)
    streaming: bool = False
    actions: Optional[List[Dict[str, Any]]] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "name": self.name,
            "timestamp": self.timestamp,
            "avatar": self.avatar,
            "meta": self.meta or {},
            "streaming": self.streaming,
            "actions": self.actions,
        }
        return _clean_dict(payload)


@dataclass
class ChatConfig:
    """
    High-level configuration object for the Chat widget.
    """
    agent: ChatAgentConfig = field(default_factory=ChatAgentConfig)
    messages: List[Union[ChatMessageConfig, Dict[str, Any]]] = field(default_factory=list)
    input_placeholder: str = "Message the assistant…"
    send_button_text: str = "Send"
    composer_help_text: Optional[str] = "Shift+Enter for a newline"
    composer_max_height: Optional[int] = None
    theme: str = "auto"
    auto_append_user_messages: bool = True
    enable_artifacts: bool = True
    artifact_panel_width: Optional[int] = None
    max_messages: Optional[int] = None
    streaming_debounce_ms: int = 32
    id_prefix: Optional[str] = None
    demo_response: Optional[str] = None
    storage_key: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)
    layout_mode: str = "advanced"
    layout_density: str = "comfortable"
    layout_show_sidebar: bool = True

    def to_dict(self) -> Dict[str, Any]:
        messages_payload: List[Dict[str, Any]] = []
        for message in self.messages:
            if hasattr(message, "to_dict"):
                messages_payload.append(message.to_dict())
            elif isinstance(message, dict):
                messages_payload.append(message)
            else:
                raise TypeError(f"Unsupported chat message type: {type(message)!r}")

        payload = {
            "agent": self.agent.to_dict() if self.agent else None,
            "messages": messages_payload,
            "inputPlaceholder": self.input_placeholder,
            "sendButtonText": self.send_button_text,
            "composerHelpText": self.composer_help_text,
            "composerMaxHeight": self.composer_max_height,
            "theme": self.theme,
            "autoAppendUserMessages": self.auto_append_user_messages,
            "enableArtifacts": self.enable_artifacts,
            "artifactPanelWidth": self.artifact_panel_width,
            "maxMessages": self.max_messages,
            "streamingDebounce": self.streaming_debounce_ms,
            "idPrefix": self.id_prefix,
            "demoResponse": self.demo_response,
            "storageKey": self.storage_key,
        }
        layout_payload = {}
        if self.layout_mode:
            layout_payload["mode"] = self.layout_mode
        if self.layout_density:
            layout_payload["density"] = self.layout_density
        layout_payload["sidebar"] = self.layout_show_sidebar
        if layout_payload:
            payload["layout"] = layout_payload
        payload.update(self.extra or {})
        return _clean_dict(payload)
