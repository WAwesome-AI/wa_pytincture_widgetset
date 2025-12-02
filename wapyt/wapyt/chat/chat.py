import asyncio
import json
import logging
import inspect
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Union

from wapyt._runtime import js, create_proxy, require_js
from wapyt.chat.chat_config import ChatConfig, ChatAgentConfig, ChatMessageConfig


logger = logging.getLogger(__name__)
WRAPPER_REVISION = "wapyt-chat-wrapper/2024-05-20"
logger.info("Chat widget wrapper loaded (%s)", WRAPPER_REVISION)
print(f"[ChatWidget] Wrapper ready ({WRAPPER_REVISION})")


class Chat:
    """
    Python wrapper around the custom Chat widget.
    """

    def __init__(
        self,
        config: Optional[ChatConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        require_js("Chat")
        if container is None and root is None:
            raise ValueError("Chat widget requires a container or a root element.")

        self.config = config or ChatConfig()
        self._container = container
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Chat widget.")

        config_payload = self.config.to_dict()
        config_json = json.dumps(config_payload)
        config_options = js.JSON.parse(config_json)
        self.chat = js.wapyt.ChatWidget.new(root_element, config_options)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _js_class() -> Any:
        try:
            return js.wapyt.ChatWidget
        except AttributeError as exc:
            raise RuntimeError(
                "wapyt.ChatWidget is not available. Ensure the chat JavaScript bundle has been loaded."
            ) from exc

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        target = container
        if target is not None:
            if hasattr(target, "getContainer"):
                return target.getContainer()
            if hasattr(target, "element"):
                return target.element
            return target
        if isinstance(root, str):
            element = js.document.querySelector(root)
            if not element:
                element = js.document.getElementById(root)
            return element
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        def wrapped(*args, **kwargs):
            converted = [
                arg.to_py() if hasattr(arg, "to_py") else arg
                for arg in args
            ]
            return handler(*converted, **kwargs)

        proxy = create_proxy(wrapped)
        bucket = self._event_proxies.setdefault(event_name, [])
        bucket.append(proxy)
        self.chat.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Event binding API
    # ------------------------------------------------------------------

    def on_send(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Fired when the user submits a prompt from the composer.
        Handler receives a payload with message text and identifiers.
        """
        self._bind_event("send", handler)

    def on_artifact_save(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Fired when the user requests to save/download an artifact.
        """
        self._bind_event("artifact:save", handler)

    def on_artifact_load(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Fired after a user picks a file to load into the artifact preview pane.
        """
        self._bind_event("artifact:load", handler)

    def on_copy(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Fired when the user clicks the per-message copy button.
        """
        self._bind_event("copy", handler)

    # ------------------------------------------------------------------
    # Data operations
    # ------------------------------------------------------------------

    @staticmethod
    def _message_to_dict(
        message: Union[ChatMessageConfig, Dict[str, Any]]
    ) -> Dict[str, Any]:
        if hasattr(message, "to_dict"):
            return message.to_dict()
        if isinstance(message, dict):
            return message
        raise TypeError(f"Unsupported chat message type: {type(message)!r}")

    def set_messages(
        self, messages: Iterable[Union[ChatMessageConfig, Dict[str, Any]]]
    ) -> None:
        payload = [self._message_to_dict(message) for message in messages]
        self.chat.setMessages(js.JSON.parse(json.dumps(payload)))

    def add_message(
        self, message: Union[ChatMessageConfig, Dict[str, Any]]
    ) -> str:
        payload = self._message_to_dict(message)
        result = self.chat.addMessage(js.JSON.parse(json.dumps(payload)))
        return result.to_py() if hasattr(result, "to_py") else result

    def update_message(self, message_id: str, **updates: Any) -> None:
        self.chat.updateMessage(
            message_id,
            js.JSON.parse(json.dumps(updates))
        )

    def remove_message(self, message_id: str) -> None:
        if hasattr(self.chat, "removeMessage"):
            self.chat.removeMessage(message_id)

    def clear_messages(self) -> None:
        self.chat.clearMessages()

    # ------------------------------------------------------------------
    # Streaming helpers
    # ------------------------------------------------------------------

    def start_stream(
        self,
        message: Union[ChatMessageConfig, Dict[str, Any]],
    ) -> str:
        payload = self._message_to_dict(message)
        result = self.chat.startStream(js.JSON.parse(json.dumps(payload)))
        return result.to_py() if hasattr(result, "to_py") else result

    def append_stream(self, message_id: str, chunk: str) -> None:
        self.chat.appendStream(message_id, chunk)

    def finish_stream(self, message_id: str, final_chunk: Optional[str] = None) -> None:
        if final_chunk is None:
            self.chat.finishStream(message_id)
        else:
            self.chat.finishStream(message_id, final_chunk)

    # ------------------------------------------------------------------
    # Appearance / metadata
    # ------------------------------------------------------------------

    def set_agent(self, agent: Union[ChatAgentConfig, Dict[str, Any]]) -> None:
        if hasattr(agent, "to_dict"):
            agent_payload = agent.to_dict()
        elif isinstance(agent, dict):
            agent_payload = agent
        else:
            raise TypeError(f"Unsupported agent representation: {type(agent)!r}")
        self.chat.setAgent(js.JSON.parse(json.dumps(agent_payload)))

    def set_theme(self, theme: str) -> None:
        self.chat.setTheme(theme)

    def focus_composer(self) -> None:
        if hasattr(self.chat, "focusComposer"):
            self.chat.focusComposer()

    def set_chat_badge(self, chat_id: str, badge: Optional[int]) -> None:
        if not chat_id:
            raise ValueError("chat_id is required to set a badge")
        self.chat.setChatBadge(chat_id, badge)

    def get_chats(self) -> List[Dict[str, Any]]:
        result = self.chat.getChats()
        if hasattr(result, "to_py"):
            return result.to_py()
        return result

    def get_messages(self, chat_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if chat_id is None:
            result = self.chat.getMessages()
        else:
            result = self.chat.getMessages(chat_id)
        if hasattr(result, "to_py"):
            return result.to_py()
        return result

    # ------------------------------------------------------------------
    # Conversation helpers
    # ------------------------------------------------------------------

    def build_history(
        self,
        *,
        chat_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
        exclude_ids: Optional[Iterable[str]] = None,
        include_empty: bool = False,
    ) -> List[Dict[str, str]]:
        excluded: Set[str] = set(exclude_ids or [])
        history: List[Dict[str, str]] = []

        if system_prompt:
            history.append({"role": "system", "content": system_prompt})

        for entry in self.get_messages(chat_id):
            if not isinstance(entry, dict):
                continue
            if entry.get("id") in excluded:
                continue
            content = (entry.get("content") or "")
            if not include_empty and not content.strip():
                continue
            role = (entry.get("role") or "assistant").lower()
            if role not in {"user", "assistant", "system"}:
                role = "assistant"
            history.append({"role": role, "content": content})

        return history

    @staticmethod
    def extract_stream_text(chunk: Any) -> str:
        if chunk is None:
            return ""

        if isinstance(chunk, str):
            return chunk

        payload = chunk
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump(exclude_none=True)
        elif hasattr(payload, "to_dict"):
            payload = payload.to_dict()

        if isinstance(payload, str):
            return payload

        if not isinstance(payload, dict):
            return ""

        chunk_type = payload.get("type")

        if chunk_type == "chunk":
            payload = payload.get("chunk", {})
            choices = payload.get("choices") or []
        elif chunk_type == "content.delta":
            return ""
        elif chunk_type == "response.output_text.delta":
            delta = payload.get("delta")
            if isinstance(delta, dict):
                return delta.get("content") or delta.get("text") or ""
            return delta or ""
        else:
            choices = payload.get("choices")
            if choices is None and "chunk" in payload:
                choices = payload["chunk"].get("choices")

        if not choices:
            return ""

        for choice in choices:
            delta = (choice or {}).get("delta")
            if not delta:
                continue
            if isinstance(delta, str):
                return delta
            if isinstance(delta, dict):
                text = delta.get("content")
                if text:
                    return text
        return ""

    def consume_stream(
        self,
        response_id: str,
        stream: Any,
        *,
        parser: Optional[Callable[[Any], str]] = None,
        finish: bool = True,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        tokenize = parser or self.extract_stream_text

        def handle_error(exc: Exception) -> None:
            if on_error:
                on_error(exc)
                return
            warning = f"Backend error: {exc}"
            try:
                self.append_stream(response_id, warning)
            finally:
                self.finish_stream(response_id)
            logging.warning("[Chat] stream failed: %s", exc)

        if inspect.isasyncgen(stream) or (
            hasattr(stream, "__aiter__") and not hasattr(stream, "__iter__")
        ):

            async def runner():
                try:
                    async for chunk in stream:
                        text = tokenize(chunk)
                        if text:
                            self.append_stream(response_id, text)
                except Exception as exc:  # pragma: no cover - pass to handler
                    handle_error(exc)
                else:
                    if finish:
                        self.finish_stream(response_id)

            self._run_async(runner())
            return

        try:
            iterator = iter(stream)
        except TypeError:
            raise ValueError("stream must be an iterable or async iterable") from None

        try:
            for chunk in iterator:
                text = tokenize(chunk)
                if not text:
                    continue
                self.append_stream(response_id, text)
        except Exception as exc:  # pragma: no cover - pass to handler
            handle_error(exc)
            return

        if finish:
            self.finish_stream(response_id)

    @staticmethod
    def _run_async(coro):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            loop.create_task(coro)
        else:
            asyncio.run(coro)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def destroy(self) -> None:
        try:
            if hasattr(self.chat, "destroy"):
                self.chat.destroy()
        finally:
            self._event_proxies.clear()
