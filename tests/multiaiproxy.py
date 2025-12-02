"""Backend-for-frontend proxy for multi-provider AI chat APIs.

This module integrates LiteLLM to support OpenAI, Anthropic, AWS Bedrock, xAI
Grok, and Google Gemini through a unified streaming interface while maintaining
PyTincture compatibility.
"""

import json
import os

import litellm

from dotenv import load_dotenv

litellm._turn_on_debug()


from pytincture.dataclass import backend_for_frontend, bff_stream

# ---------------------------------------------------------------------------
# Defaults (can be overridden when instantiating the proxy)
# ---------------------------------------------------------------------------



DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "60"))

DEFAULT_PROVIDER_CONFIG = {
    "providers": {
        "aws_bedrock": {
            "anthropic": [
                "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
                "bedrock/us.anthropic.claude-opus-4-20250514-v1:0",
                "bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0",
                "bedrock/us.anthropic.claude-3-5-sonnet-20241022-v2:0",
                "bedrock/us.anthropic.claude-3-7-sonnet-20250219-v1:0"
            ],
            "meta": [
                "us.meta.llama3-3-70b-instruct-v1:0",
                "us.meta.llama4-maverick-17b-instruct-v1:0",
                "us.meta.llama4-scout-17b-instruct-v1:0"
            ],
            "amazon": [
                "us.amazon.nova-pro-v1:0",
                "us.amazon.nova-premier-v1:0",
                "us.amazon.nova-micro-v1:0",
                "us.amazon.nova-lite-v1:0"
            ]
        },
        "anthropic": [
            "claude-sonnet-4-20250514",
            "claude-opus-4-20250514",
            "claude-opus-4-1-20250805",
            "claude-3-7-sonnet-latest"
        ],
        "openai": [
            "gpt-5",
            "gpt-5-mini",
            "o4-mini",
            "gpt-4o-mini",
            "gpt-4o",
            "o3",
            "o3-mini",
            "chatgpt-4o-latest",
            "gpt-3.5-turbo"
        ],
        "xai": [
            "xai/grok-2-1212",
            "xai/grok-2-vision-1212",
            "xai/grok-3",
            "xai/grok-3-mini",
            "xai/grok-4-0709",
            "xai/grok-4-fast-non-reasoning",
            "xai/grok-4-fast-reasoning",
            "xai/grok-code-fast-1",
            "xai/grok-2-image-1212"
        ],
        "google": [
            "gemini-2.5-pro-preview-03-25",
            "gemini-2.0-flash",
            "gemini-2.0-flash-thinking-exp-01-21"
        ]
    }
}

# ---------------------------------------------------------------------------
# LiteLLM provider helpers
# ---------------------------------------------------------------------------


class UnifiedAIProvider:
    """Unified AI provider using LiteLLM for multi-provider support."""

    def __init__(self, provider_config):
        self.provider_config = provider_config or {"providers": {}}
        #self.setup_environment()
        self._build_model_mapping()

    @staticmethod
    def setup_environment() -> None:
        """Populate LiteLLM environment variables from existing env vars."""

        env_mappings = {
            "OPENAI_API_KEY": "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY": "ANTHROPIC_API_KEY",
            "GOOGLE_KEY": "GEMINI_API_KEY",
            "XAI_API_KEY": "XAI_API_KEY",
            "AWS_ACCESS_KEY_ID": "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY": "AWS_SECRET_ACCESS_KEY",
            "AWS_DEFAULT_REGION": "AWS_DEFAULT_REGION",
        }

        for source_var, target_var in env_mappings.items():
            value = os.getenv(source_var)
            if value and not os.getenv(target_var):
                os.environ[target_var] = value

    def _build_model_mapping(self):
        providers = self.provider_config.get("providers", {})
        self.model_mapping = {}

        bedrock = providers.get("aws_bedrock", {})
        for provider_type, models in bedrock.items():
            for model in models:
                litellm_name = model
                self.model_mapping[model] = litellm_name

        for provider, models in providers.items():
            if provider == "aws_bedrock":
                continue
            for model in models:
                self.model_mapping[model] = self._map_direct_model(provider, model)

    @staticmethod
    def _map_direct_model(provider, model):
        if provider == "openai" or provider == "xai":
            return model
        if provider == "google":
            return f"gemini/{model}"
        return f"{provider}/{model}"

    def get_litellm_model(self, model):
        return self.model_mapping.get(model, model)

    def is_xai_model(self, model):
        providers = self.provider_config.get("providers", {})
        if model.startswith("xai/"):
            return True
        return model in providers.get("xai", []) or model.startswith("grok")

    def stream_completion(self, model, messages, **kwargs):
        litellm_model = self.get_litellm_model(model)

        if self.is_xai_model(model):
            original_base_url = os.getenv("OPENAI_BASE_URL")
            os.environ["OPENAI_BASE_URL"] = "https://api.x.ai/v1"
            try:
                response = litellm.completion(
                    model=litellm_model,
                    messages=list(messages),
                    stream=True,
                    api_key=os.getenv("XAI_API_KEY"),
                    **kwargs,
                )
                for chunk in response:
                    yield chunk
            finally:
                if original_base_url is not None:
                    os.environ["OPENAI_BASE_URL"] = original_base_url
                elif "OPENAI_BASE_URL" in os.environ:
                    del os.environ["OPENAI_BASE_URL"]
        else:
            response = litellm.completion(
                model=litellm_model,
                messages=list(messages),
                stream=True,
                **kwargs
            )
            print("RESPONSE", response)
            for chunk in response:
                yield chunk


# ---------------------------------------------------------------------------
# Backend-for-frontend proxy
# ---------------------------------------------------------------------------


@backend_for_frontend
class multiaiproxy:
    """Multi-provider AI proxy supporting OpenAI, Anthropic, Bedrock, xAI, and Google."""

    def __init__(self, *, provider_config=None, default_model=None, timeout=None):
        config = provider_config or self._load_config_from_env() or DEFAULT_PROVIDER_CONFIG
        self._provider = UnifiedAIProvider(config)
        self._provider_config = config
        self._default_model = default_model or os.getenv("DEFAULT_MODEL", DEFAULT_MODEL)
        self._timeout = timeout or REQUEST_TIMEOUT

    @staticmethod
    def _load_config_from_env():
        raw = os.getenv("MULTIPROXY_PROVIDER_CONFIG")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            print("Warning: MULTIPROXY_PROVIDER_CONFIG is not valid JSON; falling back to defaults.")
            return None

    def get_available_models(self):
        return self._provider_config.get("providers", {})

    def get_model_info(self, model):
        litellm_name = self._provider.get_litellm_model(model)
        provider = "unknown"
        providers = self._provider_config.get("providers", {})

        if model in providers.get("openai", []):
            provider = "openai"
        elif model in providers.get("anthropic", []):
            provider = "anthropic"
        elif model in providers.get("xai", []):
            provider = "xai"
        elif model in providers.get("google", []):
            provider = "google"
        elif any(model in group for group in providers.get("aws_bedrock", {}).values()):
            provider = "aws_bedrock"

        return {
            "original_name": model,
            "litellm_name": litellm_name,
            "provider": provider,
            "supported": model in self._provider.model_mapping,
        }

    @bff_stream()
    def chat_stream(self, messages, model=None, **extra):
        options = extra.copy()
        timeout_override = options.pop("timeout", None)
        options.pop("stream", None)
        timeout = timeout_override or self._timeout

        selected_model = model or self._default_model

        if selected_model not in self._provider.model_mapping:
            raise ValueError(
                f"Model '{selected_model}' is not supported. Available models: {list(self._provider.model_mapping.keys())}"
            )

        try:
            for chunk in self._provider.stream_completion(
                model=selected_model,
                messages=messages,
                timeout=timeout,
                **options,
            ):
                if hasattr(chunk, "model_dump"):
                    yield chunk.model_dump(exclude_none=True)
                elif hasattr(chunk, "dict"):
                    yield chunk.dict(exclude_none=True)
                else:
                    yield chunk
        except Exception as exc:  # pragma: no cover - provider errors
            yield {
                "error": {
                    "message": str(exc),
                    "type": "provider_error",
                    "code": "stream_error",
                }
            }

    @bff_stream()
    def chat_stream_with_provider_info(self, messages, model=None, **extra):
        model_info = self.get_model_info(model or self._default_model)
        yield {"type": "model_info", "model_info": model_info}
        for chunk in self.chat_stream(messages, model, **extra):
            if isinstance(chunk, dict) and "error" not in chunk:
                chunk["provider"] = model_info["provider"]
            yield chunk


# Backwards compatibility alias expected by existing demos
openaiproxy = multiaiproxy
