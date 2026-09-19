"""Prompt templates and parsing for the AI-backed routes.

Everything here calls nebius_llm.chat() or nebius_llm.chat_vision() -- routers
never call those directly, so usage logging and error handling stay in one
place. See docs/ARCHITECTURE.md §5/§6/§8.
"""
