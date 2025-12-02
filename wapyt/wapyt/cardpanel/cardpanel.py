import json
import logging
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from wapyt._runtime import js, create_proxy, require_js
from wapyt.cardpanel.cardpanel_config import CardPanelConfig, CardPanelCardConfig


logger = logging.getLogger(__name__)
WRAPPER_REVISION = "wapyt-cardpanel-wrapper/2024-05-20"
logger.info("CardPanel wrapper loaded (%s)", WRAPPER_REVISION)
print(f"[CardPanel] Wrapper ready ({WRAPPER_REVISION})")


class CardPanel:
    """
    Python wrapper for the custom CardPanel widget.
    """

    _template_proxies: Dict[str, List[Any]] = {}

    def __init__(
        self,
        config: Optional[CardPanelConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        """
        :param config: Optional CardPanelConfig object describing initial options.
        :param container: Optional layout cell (or similar) used to mount the widget.
        :param root: Optional CSS selector string or DOM element where the widget should render.
        """
        require_js("CardPanel")
        if container is None and root is None:
            raise ValueError("CardPanel requires either a container or a root element.")

        self.config = config or CardPanelConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        self._container = container

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for CardPanel.")

        config_payload = self.config.to_dict()
        self.cardpanel = js.wapyt.CardPanel.new(
            root_element,
            js.JSON.parse(json.dumps(config_payload))
        )

    # ---------------------------------------------------------------------
    # Template registration helpers
    # ---------------------------------------------------------------------

    @staticmethod
    def _js_class() -> Any:
        """
        Access the underlying JavaScript constructor, raising a helpful error if unavailable.
        """
        try:
            return js.wapyt.CardPanel
        except AttributeError as exc:
            raise RuntimeError(
                "wapyt.CardPanel is not available. Ensure the cardpanel JavaScript has been loaded."
            ) from exc

    @classmethod
    def register_template(cls, name: str, factory: Any) -> None:
        """
        Register a template factory with the underlying JavaScript widget.

        The `factory` argument may be:
            * a string containing JS code that evaluates to a factory function
            * a JsProxy/Function returned from js.eval/js.Function
            * a Python callable that returns a renderer. The callable will be proxied to JS.
        """
        if not name or not isinstance(name, str):
            raise ValueError("Template name must be a non-empty string.")

        cardpanel_cls = cls._js_class()
        register = getattr(cardpanel_cls, "registerTemplate", None)
        if register is None:
            raise RuntimeError(
                "CardPanel.registerTemplate is not available. Rebuild your front-end bundle to include the latest widget code."
            )

        factory_ref = factory
        if isinstance(factory, str):
            factory_ref = js.eval(factory)
        elif callable(factory) and not hasattr(factory, "to_py"):
            # Proxy the Python callable into JS and keep the proxy alive.
            proxied = create_proxy(factory)
            cls._template_proxies.setdefault(name, []).append(proxied)
            factory_ref = proxied
        else:
            print(f"[CardPanel] register_template received factory of type {type(factory)}")

        logger.info(
            "CardPanel.register_template called for '%s' (%s)", name, WRAPPER_REVISION
        )
        print(f"[CardPanel] register_template -> '{name}' ({WRAPPER_REVISION})")
        register(name, factory_ref)

    @classmethod
    def get_template(cls, name: str) -> Any:
        """
        Retrieve a previously registered template factory from the JS layer (if available).
        """
        cardpanel_cls = cls._js_class()
        getter = getattr(cardpanel_cls, "getTemplate", None)
        if getter is None:
            return None
        return getter(name)

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        """
        Resolve the DOM element that will host the CardPanel.
        """
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
        """
        Helper that registers an event handler and keeps a proxy alive.
        """
        def wrapped(*args, **kwargs):
            if args:
                converted = [
                    arg.to_py() if hasattr(arg, "to_py") else arg
                    for arg in args
                ]
            else:
                converted = []
            return handler(*converted, **kwargs)

        proxy = create_proxy(wrapped)
        bucket = self._event_proxies.setdefault(event_name, [])
        bucket.append(proxy)
        self.cardpanel.on(event_name, proxy)

    # Event bindings -------------------------------------------------------

    def on_search(self, handler: Callable[[str], Any]) -> None:
        self._bind_event("search", handler)

    def on_add(self, handler: Callable[[], Any]) -> None:
        self._bind_event("add", handler)

    def on_view(self, handler: Callable[[Any], Any]) -> None:
        self._bind_event("view", handler)

    def on_card_click(self, handler: Callable[[Any], Any]) -> None:
        self._bind_event("cardClick", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("action", handler)

    # Data API -------------------------------------------------------------

    def load(self, cards: Iterable[Union[CardPanelCardConfig, Dict[str, Any]]]) -> None:
        payload = [card.to_dict() if hasattr(card, "to_dict") else card for card in cards]
        self.cardpanel.load(js.JSON.parse(json.dumps(payload)))

    def add_card(self, card: Union[CardPanelCardConfig, Dict[str, Any]]) -> None:
        card_payload = card.to_dict() if hasattr(card, "to_dict") else card
        self.cardpanel.add(js.JSON.parse(json.dumps(card_payload)))

    def filter(self, query: str) -> None:
        """
        Access the underlying filter logic (mirrors the JS helper).
        """
        if hasattr(self.cardpanel, "_filter"):
            self.cardpanel._filter(query)

    def destroy(self) -> None:
        """
        Tears down DOM content created for the widget (best-effort).
        """
        try:
            if hasattr(self.cardpanel, "destroy"):
                self.cardpanel.destroy()
            elif hasattr(self.cardpanel, "destructor"):
                self.cardpanel.destructor()
        finally:
            self._event_proxies.clear()
