#!/usr/bin/env uv run --default-index https://pypi.org/simple
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp @ git+https://github.com/modelcontextprotocol/python-sdk@main",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
#     "pocket-tts>=1.0.1",
# ]
# ///
"""
Say Demo - MCP App for streaming text-to-speech.

This MCP server provides a "say" tool that speaks text using TTS.
The view receives streaming partial input and starts speaking immediately.

Architecture:
- The `say` tool itself is a no-op - it just triggers the view
- The view uses `ontoolinputpartial` to receive text as it streams
- view calls private tools to create TTS queue, add text, and poll audio
- Audio plays in the view using Web Audio API
- Model context updates show playback progress to the LLM
- Native theming adapts to dark/light mode automatically
- Fullscreen mode with Escape key to exit
- Multi-View speak lock coordinates playback across instances

Usage:
  # Start the MCP server
  python server.py

  # Or with stdio transport (for Claude Desktop)
  python server.py --stdio
"""
from __future__ import annotations
import asyncio
import base64
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal
from pydantic import Field

import torch
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp import types
from mcp.types import Icon
from starlette.middleware.cors import CORSMiddleware

from pocket_tts.models.tts_model import TTSModel, prepare_text_prompt
from pocket_tts.default_parameters import DEFAULT_AUDIO_PROMPT

logger = logging.getLogger(__name__)

VIEW_URI = "ui://say-demo/view.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3109"))

# Speaker icon as SVG data URI
SPEAKER_ICON = Icon(
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpolygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5'/%3E%3Cpath d='M15.54 8.46a5 5 0 0 1 0 7.07'/%3E%3Cpath d='M19.07 4.93a10 10 0 0 1 0 14.14'/%3E%3C/svg%3E",
    mimeType="image/svg+xml",
)

mcp = FastMCP("Say Demo", icons=[SPEAKER_ICON])

# Global TTS model (loaded on startup)
tts_model: TTSModel | None = None


# ------------------------------------------------------
# TTS Queue State Management
# ------------------------------------------------------

@dataclass
class AudioChunkData:
    """Audio chunk with timing metadata."""
    index: int
    audio_base64: str
    char_start: int
    char_end: int
    duration_ms: float


@dataclass
class TTSQueueState:
    """State for a TTS generation queue."""
    id: str
    voice: str
    sample_rate: int
    status: Literal["active", "complete", "error"] = "active"
    error_message: str | None = None

    # Text queue
    text_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    end_signaled: bool = False

    # Audio output
    audio_chunks: list[AudioChunkData] = field(default_factory=list)
    chunks_delivered: int = 0

    # Tracking
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)  # Last text or end signal
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task | None = None


# Active TTS queues
tts_queues: dict[str, TTSQueueState] = {}

# Queue timeout: if no activity for this long, mark as error
QUEUE_TIMEOUT_SECONDS = 30


# ------------------------------------------------------
# Public Tool: say
# ------------------------------------------------------

DEFAULT_TEXT = """Hello! I'm a text-to-speech demonstration. This speech is being generated in real-time as you watch. The words you see highlighted are synchronized with the audio playback, creating a karaoke-style reading experience. You can click to pause or resume, and use the reset button to restart from the beginning. Pretty neat, right?"""

# Predefined voices from pocket-tts (mapped to HuggingFace files)
# See: https://huggingface.co/kyutai/tts-voices
PREDEFINED_VOICES = {
    "alba": "hf://kyutai/tts-voices/alba-mackenna/casual.wav",
    "marius": "hf://kyutai/tts-voices/alba-mackenna/merchant.wav",
    "javert": "hf://kyutai/tts-voices/alba-mackenna/announcer.wav",
    "jean": "hf://kyutai/tts-voices/alba-mackenna/a-moment-by.wav",
    "fantine": "hf://kyutai/tts-voices/vctk/p225_023_mic1.wav",
    "cosette": "hf://kyutai/tts-voices/vctk/p226_023_mic1.wav",
    "eponine": "hf://kyutai/tts-voices/vctk/p227_023_mic1.wav",
    "azelma": "hf://kyutai/tts-voices/vctk/p228_023_mic1.wav",
}

DEFAULT_VOICE = "cosette"


@mcp.tool()
def list_voices() -> list[types.TextContent]:
    """List available TTS voices.

    Returns the predefined voice names that can be used with the say tool.
    You can also use HuggingFace URLs (hf://kyutai/tts-voices/...) or local file paths.
    """
    import json
    voice_info = {
        "predefined_voices": list(PREDEFINED_VOICES.keys()),
        "default_voice": DEFAULT_VOICE,
        "custom_voice_formats": [
            "hf://kyutai/tts-voices/<collection>/<file>.wav",
            "/path/to/local/voice.wav",
        ],
        "collections": [
            "alba-mackenna (CC-BY 4.0) - voice-acted characters",
            "vctk (CC-BY 4.0) - VCTK dataset speakers",
            "cml-tts/fr (CC-BY 4.0) - French voices",
            "voice-donations (CC0) - public domain community voices",
            "expresso (CC-BY-NC 4.0) - expressive (NON-COMMERCIAL ONLY)",
            "ears (CC-BY-NC 4.0) - emotional (NON-COMMERCIAL ONLY)",
        ],
    }
    return [types.TextContent(type="text", text=json.dumps(voice_info, indent=2))]


@mcp.tool(meta={
    "ui":{"resourceUri": VIEW_URI},
    "ui/resourceUri": VIEW_URI, # legacy support
})
def say(
    text: Annotated[str, Field(description="The English text to speak aloud")] = DEFAULT_TEXT,
    voice: Annotated[str, Field(
        description="Voice to use. Can be a predefined name (alba, marius, cosette, etc.), "
                    "a HuggingFace URL (hf://kyutai/tts-voices/...), or a local file path."
    )] = DEFAULT_VOICE,
    autoPlay: Annotated[bool, Field(
        description="Whether to start playing automatically. Note: browsers may block autoplay until user interaction."
    )] = True,
) -> list[types.TextContent]:
    """Speak English text aloud using text-to-speech.

    Use when the user wants text read or spoken aloud:
    - "say ...", "speak ...", "read ... out loud"
    - "...; say it", "...; read it to me", "...; speak it"
    - "narrate ...", "read this aloud"

    Audio streams in real-time as text is provided.
    Use list_voices() for voice options.

    Note: English only. Non-English text may produce poor or garbled results.
    """
    # Generate a unique ID for this view instance (used for speak lock coordination)
    view_uuid = uuid.uuid4().hex[:12]

    # This is a no-op - the view handles everything via ontoolinputpartial
    # The tool exists to:
    # 1. Trigger the view to load
    # 2. Provide the resourceUri metadata
    # 3. Show the final text in the tool result
    # 4. Provide view UUID for multi-player coordination
    return [types.TextContent(
        type="text",
        text=f"Displayed a TTS view with voice '{voice}'. Click to play/pause, use toolbar to restart or fullscreen.",
        _meta={"viewUUID": view_uuid},
    )]


# ------------------------------------------------------
# Private Tools: TTS Queue Management
# ------------------------------------------------------

@mcp.tool(meta={"ui":{"visibility":["app"]}})
async def create_tts_queue(voice: str = "cosette") -> list[types.TextContent]:
    """Create a TTS generation queue. Returns queue_id and sample_rate.

    Args:
        voice: Voice to use (cosette, alba, brenda, etc.)
    """
    if tts_model is None:
        return [types.TextContent(type="text", text='{"error": "TTS model not loaded"}')]

    queue_id = uuid.uuid4().hex[:12]
    sample_rate = tts_model.config.mimi.sample_rate

    state = TTSQueueState(
        id=queue_id,
        voice=voice,
        sample_rate=sample_rate,
    )
    tts_queues[queue_id] = state

    # Start background TTS processing task
    state.task = asyncio.create_task(_run_tts_queue(state))

    logger.info(f"Created TTS queue {queue_id}")

    import json
    return [types.TextContent(
        type="text",
        text=json.dumps({"queue_id": queue_id, "sample_rate": sample_rate})
    )]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def add_tts_text(queue_id: str, text: str) -> list[types.TextContent]:
    """Add text to a TTS queue.

    Args:
        queue_id: The queue ID from create_tts_queue
        text: Text to add (incremental, not cumulative)
    """
    state = tts_queues.get(queue_id)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]
    if state.end_signaled:
        return [types.TextContent(type="text", text='{"error": "Queue already ended"}')]

    # Queue the text (non-blocking)
    try:
        state.text_queue.put_nowait(text)
        state.last_activity = time.time()  # Update activity timestamp
    except asyncio.QueueFull:
        return [types.TextContent(type="text", text='{"error": "Queue full"}')]

    return [types.TextContent(type="text", text='{"queued": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def end_tts_queue(queue_id: str) -> list[types.TextContent]:
    """Signal that no more text will be sent to a queue.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    state = tts_queues.get(queue_id)
    if not state:
        logger.warning(f"end_tts_queue called for unknown queue: {queue_id}")
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]
    if state.end_signaled:
        logger.info(f"end_tts_queue called for already-ended queue: {queue_id}")
        return [types.TextContent(type="text", text='{"already_ended": true}')]

    state.end_signaled = True
    state.last_activity = time.time()  # Update activity timestamp
    try:
        state.text_queue.put_nowait(None)  # EOF marker
    except asyncio.QueueFull:
        pass

    logger.info(f"end_tts_queue called for queue: {queue_id}")
    return [types.TextContent(type="text", text='{"ended": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def cancel_tts_queue(queue_id: str) -> list[types.TextContent]:
    """Cancel and cleanup a TTS queue. Use before creating a new queue to avoid overlapping playback.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    state = tts_queues.pop(queue_id, None)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]

    # Cancel the background task
    if state.task and not state.task.done():
        state.task.cancel()
        logger.info(f"Cancelled TTS queue {queue_id}")

    # Signal end to unblock any waiting consumers
    state.end_signaled = True
    try:
        state.text_queue.put_nowait(None)
    except asyncio.QueueFull:
        pass

    state.status = "complete"

    return [types.TextContent(type="text", text='{"cancelled": true}')]


@mcp.tool(meta={"ui":{"visibility":["app"]}})
def poll_tts_audio(queue_id: str) -> list[types.TextContent]:
    """Poll for available audio chunks from a TTS queue.

    Returns base64-encoded audio chunks with timing metadata.
    Call repeatedly until done=true.

    Args:
        queue_id: The queue ID from create_tts_queue
    """
    import json
    import time

    state = tts_queues.get(queue_id)
    if not state:
        return [types.TextContent(type="text", text='{"error": "Queue not found"}')]

    # Update last activity to prevent timeout during active polling
    state.last_activity = time.time()

    # Get new chunks (use sync approach since we can't await in tool)
    # The lock is async, so we need to be careful here
    # For simplicity, just grab what's available without locking
    new_chunks = state.audio_chunks[state.chunks_delivered:]
    state.chunks_delivered = len(state.audio_chunks)

    # Consider queues with errors as "done" so view stops polling
    done = (state.status == "complete" or state.status == "error") and state.chunks_delivered >= len(state.audio_chunks)

    response = {
        "chunks": [
            {
                "index": c.index,
                "audio_base64": c.audio_base64,
                "char_start": c.char_start,
                "char_end": c.char_end,
                "duration_ms": c.duration_ms,
            }
            for c in new_chunks
        ],
        "done": done,
        "status": state.status,
    }

    # Include error message if present
    if state.error_message:
        response["error"] = state.error_message

    # Clean up completed or errored queues
    if done:
        # Schedule cleanup after a delay
        async def cleanup():
            await asyncio.sleep(60)
            tts_queues.pop(queue_id, None)
        try:
            asyncio.get_event_loop().create_task(cleanup())
        except RuntimeError:
            pass

    return [types.TextContent(type="text", text=json.dumps(response))]


# ------------------------------------------------------
# Background TTS Processing
# ------------------------------------------------------


class StreamingTextChunker:
    """Buffers streaming text and emits chunks when ready for TTS processing.

    Chunks are emitted when:
    - Token count reaches max_tokens threshold (at a sentence boundary if possible)
    - flush() is called (end of stream)

    This matches the chunking behavior of split_into_best_sentences() but works
    incrementally as text arrives.
    """

    def __init__(self, tokenizer, max_tokens: int = 50, min_tokens: int = 15):
        """
        Args:
            tokenizer: SentencePiece tokenizer from flow_lm.conditioner.tokenizer
            max_tokens: Maximum tokens per chunk (default 50, matches existing)
            min_tokens: Minimum tokens before considering emission
        """
        self.tokenizer = tokenizer
        self.max_tokens = max_tokens
        self.min_tokens = min_tokens
        self.buffer = ""

        # Cache end-of-sentence token IDs for boundary detection
        _, *eos_tokens = tokenizer(".!...?").tokens[0].tolist()
        self.eos_tokens = set(eos_tokens)

    def add_text(self, text: str) -> list[str]:
        """Add text to buffer, return any complete chunks ready for processing.

        Args:
            text: Incremental text to add (e.g., from LLM token)

        Returns:
            List of text chunks ready for TTS (may be empty if still buffering)
        """
        self.buffer += text
        return self._extract_ready_chunks()

    def flush(self) -> list[str]:
        """Flush remaining buffer as final chunk(s).

        Call this when the text stream ends to process any remaining text.

        Returns:
            List of final text chunks (may be empty if buffer was empty)
        """
        if not self.buffer.strip():
            return []

        # Force emit whatever remains
        chunks = self._extract_ready_chunks(force_emit=True)
        if self.buffer.strip():
            chunks.append(self.buffer.strip())
            self.buffer = ""
        return chunks

    def _extract_ready_chunks(self, force_emit: bool = False) -> list[str]:
        """Extract chunks that are ready for processing."""
        chunks = []

        while True:
            chunk = self._try_extract_chunk(force_emit and not chunks)
            if chunk is None:
                break
            chunks.append(chunk)

        return chunks

    def _try_extract_chunk(self, force_emit: bool = False) -> str | None:
        """Try to extract one chunk from buffer."""
        text = self.buffer.strip()
        if not text:
            return None

        tokens = self.tokenizer(text).tokens[0].tolist()
        num_tokens = len(tokens)

        # Not enough tokens yet
        if num_tokens < self.min_tokens and not force_emit:
            return None

        # Under max and not forcing - check for complete sentence worth emitting
        if num_tokens < self.max_tokens and not force_emit:
            # Only emit early if we have a complete sentence at a good length
            if num_tokens >= self.min_tokens and self._ends_with_sentence_boundary(tokens):
                # Found a complete sentence - emit it
                chunk = text
                self.buffer = ""
                return chunk
            return None

        # Over max_tokens or force_emit - find best split point
        split_idx = self._find_best_split(tokens, force_emit)

        if split_idx == 0:
            if force_emit:
                chunk = text
                self.buffer = ""
                return chunk
            return None

        # Decode tokens up to split point
        chunk_text = self.tokenizer.sp.decode(tokens[:split_idx])
        remaining_text = self.tokenizer.sp.decode(tokens[split_idx:])

        self.buffer = remaining_text
        return chunk_text.strip()

    def _find_best_split(self, tokens: list[int], force_emit: bool = False) -> int:
        """Find the best token index to split at (sentence boundary near max_tokens)."""
        # Find all sentence boundaries (position AFTER the punctuation)
        boundaries = []
        prev_was_eos = False

        for i, token in enumerate(tokens):
            if token in self.eos_tokens:
                prev_was_eos = True
            elif prev_was_eos:
                boundaries.append(i)
                prev_was_eos = False

        # Also consider end of tokens if it ends with punctuation
        if tokens and tokens[-1] in self.eos_tokens:
            boundaries.append(len(tokens))

        if not boundaries:
            # No sentence boundaries - split at max_tokens if we're over
            if len(tokens) >= self.max_tokens:
                return self.max_tokens
            return len(tokens) if force_emit else 0

        # Find boundary closest to max_tokens without going too far over
        best_boundary = 0
        for boundary in boundaries:
            if boundary <= self.max_tokens:
                best_boundary = boundary
            elif best_boundary == 0:
                # First boundary is past max - use it anyway
                best_boundary = boundary
                break
            else:
                # We have a good boundary before max, stop
                break

        return best_boundary

    def _ends_with_sentence_boundary(self, tokens: list[int]) -> bool:
        """Check if token sequence ends with sentence-ending punctuation."""
        if not tokens:
            return False
        return tokens[-1] in self.eos_tokens

    @property
    def buffered_text(self) -> str:
        """Current buffered text (for debugging/monitoring)."""
        return self.buffer

    @property
    def buffered_token_count(self) -> int:
        """Approximate token count in buffer."""
        if not self.buffer.strip():
            return 0
        return len(self.tokenizer(self.buffer).tokens[0].tolist())


async def _run_tts_queue(state: TTSQueueState):
    """Background task: consume text queue, produce audio chunks."""
    if tts_model is None:
        state.status = "error"
        state.error_message = "TTS model not loaded"
        return

    model_state = tts_model._cached_get_state_for_audio_prompt(state.voice, truncate=True)
    chunker = StreamingTextChunker(tts_model.flow_lm.conditioner.tokenizer)
    chunk_index = 0
    char_offset = 0

    try:
        while True:
            # Wait for text with timeout to detect stale queues
            try:
                text_item = await asyncio.wait_for(
                    state.text_queue.get(),
                    timeout=5.0  # Check every 5 seconds
                )
            except asyncio.TimeoutError:
                # Check if queue is stale (no activity for too long)
                if time.time() - state.last_activity > QUEUE_TIMEOUT_SECONDS:
                    logger.warning(f"TTS queue {state.id} timeout after {QUEUE_TIMEOUT_SECONDS}s of inactivity")
                    state.status = "error"
                    state.error_message = f"Queue timeout: no activity for {QUEUE_TIMEOUT_SECONDS}s"
                    break
                # Continue waiting - queue might still be active
                continue

            if text_item is None:
                # EOF - flush remaining text
                remaining = chunker.flush()
                for chunk_text in remaining:
                    await _process_tts_chunk(state, chunk_text, chunk_index, char_offset, model_state)
                    char_offset += len(chunk_text)
                    chunk_index += 1

                state.status = "complete"
                logger.info(f"TTS queue {state.id} complete: {chunk_index} chunks")
                break

            # Feed text to chunker
            ready_chunks = chunker.add_text(text_item)

            for chunk_text in ready_chunks:
                await _process_tts_chunk(state, chunk_text, chunk_index, char_offset, model_state)
                char_offset += len(chunk_text)
                chunk_index += 1

    except Exception as e:
        logger.error(f"TTS queue {state.id} error: {e}")
        state.status = "error"
        state.error_message = str(e)


async def _process_tts_chunk(
    state: TTSQueueState,
    text: str,
    chunk_index: int,
    char_offset: int,
    model_state: dict,
):
    """Process a text chunk and add audio to state."""
    if tts_model is None:
        return

    loop = asyncio.get_event_loop()
    audio_bytes_list: list[bytes] = []
    total_samples = 0

    def generate_sync():
        nonlocal total_samples
        _, frames_after_eos = prepare_text_prompt(text)
        frames_after_eos += 2

        for audio_chunk in tts_model._generate_audio_stream_short_text(
            model_state=model_state,
            text_to_generate=text,
            frames_after_eos=frames_after_eos,
            copy_state=True,
        ):
            audio_int16 = (audio_chunk * 32767).to(torch.int16)
            audio_bytes_list.append(audio_int16.cpu().numpy().tobytes())
            total_samples += len(audio_chunk)

    await loop.run_in_executor(None, generate_sync)

    combined_audio = b"".join(audio_bytes_list)
    duration_ms = (total_samples / state.sample_rate) * 1000

    chunk_data = AudioChunkData(
        index=chunk_index,
        audio_base64=base64.b64encode(combined_audio).decode(),
        char_start=char_offset,
        char_end=char_offset + len(text),
        duration_ms=duration_ms,
    )

    async with state.lock:
        state.audio_chunks.append(chunk_data)

    logger.debug(f"TTS queue {state.id}: chunk {chunk_index} ready ({duration_ms:.0f}ms)")


# ------------------------------------------------------
# View Resource
# ------------------------------------------------------

# Embedded View HTML for standalone execution via `uv run <url>`
# Uses Babel standalone for in-browser JSX transpilation
# This is a copy of view.html - keep them in sync!
EMBEDDED_VIEW_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Say View</title>
  <script src="https://unpkg.com/@babel/standalone@7.26.10/babel.min.js"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.2.0",
      "react-dom/client": "https://esm.sh/react-dom@19.2.0/client",
      "@modelcontextprotocol/ext-apps": "https://esm.sh/@modelcontextprotocol/ext-apps@0.4.1?deps=zod@3.25.1&external=react,react-dom",
      "@modelcontextprotocol/ext-apps/react": "https://esm.sh/@modelcontextprotocol/ext-apps@0.4.1/react?deps=zod@3.25.1&external=react,react-dom"
    }
  }
  </script>
  <style>
    :root {
      /* Fallback values if host doesn't provide */
      --font-sans: system-ui, -apple-system, sans-serif;
      --color-text-primary: #333;
      --color-text-secondary: #999;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); }
    .container { padding: 16px; min-height: 100px; position: relative; outline: none; }
    .textWrapper { position: relative; }
    .textDisplay {
      font-size: 16px; line-height: 1.6; padding: 8px; border-radius: 6px;
    }
    /* Fullscreen mode: enable scrolling */
    .container.fullscreen .textDisplay {
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    .spoken { color: var(--color-text-primary); }
    .pending { color: var(--color-text-secondary); }
    /* Toolbar - top right, visible on hover */
    .toolbar {
      position: absolute;
      top: 8px; right: 8px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 10;
    }
    .container:hover .toolbar { opacity: 0.8; }
    .toolbar:hover { opacity: 1; }
    .controlBtn {
      width: 32px; height: 32px; border: none; border-radius: 6px;
      background: rgba(0, 0, 0, 0.5); color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
      font-size: 14px;
    }
    .controlBtn:hover { background: rgba(0, 0, 0, 0.8); }
    .controlBtn svg { width: 16px; height: 16px; }
    .fullscreenBtn { display: none; }
    .fullscreenBtn.available { display: flex; }
    .fullscreenBtn .collapseIcon { display: none; }
    .container.fullscreen .fullscreenBtn .expandIcon { display: none; }
    .container.fullscreen .fullscreenBtn .collapseIcon { display: block; }
    /* Info button - bottom right */
    .infoBtn {
      position: absolute;
      bottom: 8px; right: 8px;
      width: 24px; height: 24px;
      border: none; border-radius: 50%;
      background: rgba(128, 128, 128, 0.4);
      color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: bold; font-style: italic; font-family: serif;
      opacity: 0.5;
      transition: opacity 0.2s, background 0.2s;
      z-index: 10;
    }
    .container:hover .infoBtn { opacity: 0.8; }
    .infoBtn:hover { opacity: 1; background: rgba(128, 128, 128, 0.7); }
    /* Info popup */
    .infoPopup {
      position: absolute;
      bottom: 40px; right: 8px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.5;
      max-width: 280px;
      z-index: 20;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .infoPopup h4 { margin: 0 0 8px 0; font-size: 13px; }
    .infoPopup a {
      color: #6cb6ff;
      text-decoration: none;
      cursor: pointer;
    }
    .infoPopup a:hover { text-decoration: underline; }
    .infoPopup ul { margin: 0; padding-left: 16px; }
    .infoPopup li { margin: 4px 0; }
    /* Dark mode: host-provided theme via data-theme attribute */
    [data-theme="dark"] {
      --color-text-primary: #eee;
      --color-text-secondary: #666;
    }
    /* Fallback: system preference when running standalone without host */
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) {
        --color-text-primary: #eee;
        --color-text-secondary: #666;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
    import React, { useState, useCallback, useEffect, useRef, StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useApp } from '@modelcontextprotocol/ext-apps/react';
    import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';

    function SayView() {
      const [hostContext, setHostContext] = useState(undefined);
      const [displayText, setDisplayText] = useState("");
      const [charPosition, setCharPosition] = useState(0);
      const [status, setStatus] = useState("idle"); // idle | playing | paused | finished
      const [hasPendingChunks, setHasPendingChunks] = useState(false);
      const [displayMode, setDisplayMode] = useState("inline");
      const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
      const [autoPlay, setAutoPlay] = useState(true); // Default to autoPlay, can be overridden by tool input
      const [showInfo, setShowInfo] = useState(false);

      const voiceRef = useRef("cosette"); // Current voice, updated from tool input
      const viewUuidRef = useRef(null); // View UUID for speak lock coordination
      const speakLockIntervalRef = useRef(null); // Polling interval for speak lock
      const queueIdRef = useRef(null);
      const audioContextRef = useRef(null);
      const sampleRateRef = useRef(24000);
      const nextPlayTimeRef = useRef(0);
      const playbackStartTimeRef = useRef(0);
      const chunkTimingsRef = useRef([]);
      const pendingChunksRef = useRef([]);
      const allAudioReceivedRef = useRef(false);
      const isPollingRef = useRef(false);
      const lastTextRef = useRef("");
      const fullTextRef = useRef("");
      const progressIntervalRef = useRef(null);
      const appRef = useRef(null);
      const lastModelContextUpdateRef = useRef(0);
      const audioOperationInProgressRef = useRef(false);
      const initQueuePromiseRef = useRef(null);
      const pendingModelContextUpdateRef = useRef(null);

      // Speak lock: coordinates multiple TTS views so only one plays at a time
      const SPEAK_LOCK_KEY = "mcp-tts-playing";

      const announcePlayback = useCallback(() => {
        if (!viewUuidRef.current) return;
        localStorage.setItem(SPEAK_LOCK_KEY, JSON.stringify({
          uuid: viewUuidRef.current,
          timestamp: Date.now()
        }));
      }, []);

      const clearSpeakLock = useCallback(() => {
        if (!viewUuidRef.current) return;
        try {
          const current = JSON.parse(localStorage.getItem(SPEAK_LOCK_KEY) || "null");
          if (current?.uuid === viewUuidRef.current) {
            localStorage.removeItem(SPEAK_LOCK_KEY);
          }
        } catch {}
      }, []);

      const startSpeakLockPolling = useCallback((onStolenCallback) => {
        if (speakLockIntervalRef.current) clearInterval(speakLockIntervalRef.current);
        speakLockIntervalRef.current = setInterval(() => {
          try {
            const current = JSON.parse(localStorage.getItem(SPEAK_LOCK_KEY) || "null");
            if (current && current.uuid !== viewUuidRef.current) {
              // Someone else started playing - yield
              console.log('[TTS] Another view started playing, pausing');
              onStolenCallback();
            }
          } catch {}
        }, 200);
      }, []);

      const stopSpeakLockPolling = useCallback(() => {
        if (speakLockIntervalRef.current) {
          clearInterval(speakLockIntervalRef.current);
          speakLockIntervalRef.current = null;
        }
      }, []);

      const roundToWordEnd = useCallback((pos) => {
        const text = lastTextRef.current;
        if (pos >= text.length) return text.length;
        if (pos <= 0) return 0;
        if (text[pos] === " " || text[pos] === "\\n") return pos;
        let end = pos;
        while (end < text.length && text[end] !== " " && text[end] !== "\\n") end++;
        return end;
      }, []);

      const getCharacterPosition = useCallback((currentTime) => {
        const timings = chunkTimingsRef.current;
        let rawPos = 0;
        if (timings.length === 0) {
          rawPos = Math.floor((currentTime - playbackStartTimeRef.current) * 12);
        } else {
          for (const chunk of timings) {
            if (currentTime >= chunk.audioStartTime && currentTime < chunk.audioEndTime) {
              const duration = chunk.audioEndTime - chunk.audioStartTime;
              if (duration <= 0) { rawPos = chunk.charStart; }
              else {
                const progress = (currentTime - chunk.audioStartTime) / duration;
                rawPos = Math.floor(chunk.charStart + progress * (chunk.charEnd - chunk.charStart));
              }
              break;
            }
          }
          if (rawPos === 0 && timings.length > 0) {
            if (currentTime < timings[0].audioStartTime) rawPos = 0;
            else {
              const last = timings[timings.length - 1];
              if (currentTime >= last.audioEndTime) rawPos = last.charEnd;
            }
          }
        }
        return roundToWordEnd(rawPos);
      }, [roundToWordEnd]);

      const finishPlayback = useCallback(() => {
        setStatus("finished");
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setCharPosition(lastTextRef.current.length);
      }, []);

      const startProgressTracking = useCallback(() => {
        if (progressIntervalRef.current) return;
        progressIntervalRef.current = setInterval(() => {
          const ctx = audioContextRef.current;
          if (!ctx) return;
          setCharPosition(getCharacterPosition(ctx.currentTime));
          if (allAudioReceivedRef.current && ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
            finishPlayback();
          }
        }, 50);
      }, [getCharacterPosition, finishPlayback]);

      const scheduleAudioChunkInternal = useCallback(async (chunk) => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        const binaryString = atob(chunk.audio_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768;
        const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRateRef.current);
        audioBuffer.getChannelData(0).set(float32Array);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
        const duration = audioBuffer.duration;
        if (chunkTimingsRef.current.length === 0) {
          playbackStartTimeRef.current = startTime;
          setStatus("playing");
          startProgressTracking();
        }
        source.start(startTime);
        nextPlayTimeRef.current = startTime + duration;
        chunkTimingsRef.current.push({
          charStart: chunk.char_start, charEnd: chunk.char_end,
          audioStartTime: startTime, audioEndTime: nextPlayTimeRef.current,
        });
        const thisBufferEndTime = nextPlayTimeRef.current;
        source.onended = () => {
          if (!audioContextRef.current) return;
          const ct = audioContextRef.current.currentTime;
          if (allAudioReceivedRef.current && thisBufferEndTime >= nextPlayTimeRef.current - 0.01 && ct >= nextPlayTimeRef.current - 0.05) {
            finishPlayback();
          }
        };
      }, [startProgressTracking, finishPlayback]);

      const scheduleAudioChunk = useCallback(async (chunk) => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        // Only defer to pendingChunks if suspended AND playback hasn't started yet
        // (i.e., autoplay is blocked). If we're paused by user (chunkTimings exists),
        // schedule normally - the audio will queue up and play when resumed.
        if (ctx.state === "suspended" && chunkTimingsRef.current.length === 0) {
          pendingChunksRef.current.push(chunk);
          setHasPendingChunks(true);
          return;
        }
        await scheduleAudioChunkInternal(chunk);
      }, [scheduleAudioChunkInternal]);

      const startPolling = useCallback(async () => {
        const app = appRef.current;
        if (isPollingRef.current || !app) return;
        isPollingRef.current = true;

        let emptyPollCount = 0;
        while (queueIdRef.current) {
          try {
            const result = await app.callServerTool({ name: "poll_tts_audio", arguments: { queue_id: queueIdRef.current } });
            const data = JSON.parse(result.content[0].text);
            if (data.error) {
              console.log('[TTS] Queue error:', data.error);
              break;
            }
            for (const chunk of data.chunks) await scheduleAudioChunk(chunk);
            if (data.done) { allAudioReceivedRef.current = true; break; }

            // Adaptive backoff: faster when streaming, slower when waiting
            if (data.chunks.length > 0) {
              emptyPollCount = 0;  // Reset - we're getting chunks
              await new Promise(r => setTimeout(r, 20));  // Fast poll during streaming
            } else {
              emptyPollCount++;
              // Exponential backoff for empty polls: 50ms, 100ms, 150ms max
              const delay = Math.min(50 + (emptyPollCount * 50), 150);
              await new Promise(r => setTimeout(r, delay));
            }
          } catch (err) {
            console.log('[TTS] Polling error:', err);
            break;
          }
        }
        isPollingRef.current = false;
      }, [scheduleAudioChunk]);

      const cancelCurrentQueue = useCallback(async () => {
        const app = appRef.current;
        if (queueIdRef.current && app) {
          try { await app.callServerTool({ name: "cancel_tts_queue", arguments: { queue_id: queueIdRef.current } }); }
          catch (err) {}
        }
      }, []);

      const initTTSQueue = useCallback(async () => {
        console.log('[TTS] initTTSQueue called, queueIdRef:', queueIdRef.current);
        // Already initialized
        if (queueIdRef.current) { console.log('[TTS] already initialized'); return true; }
        // Wait for in-progress initialization
        if (initQueuePromiseRef.current) {
          await initQueuePromiseRef.current;
          return !!queueIdRef.current;
        }
        const app = appRef.current;
        if (!app) return false;
        // Start initialization with promise lock
        initQueuePromiseRef.current = (async () => {
          try {
            // Close any existing audio context from previous session
            if (audioContextRef.current) {
              try { await audioContextRef.current.close(); } catch {}
              audioContextRef.current = null;
            }
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            // Reset state for new session
            chunkTimingsRef.current = [];
            pendingChunksRef.current = [];
            allAudioReceivedRef.current = false;
            setCharPosition(0);
            setStatus("idle");
            // Create new queue
            console.log('[TTS] creating new queue');
            const result = await app.callServerTool({ name: "create_tts_queue", arguments: { voice: voiceRef.current } });
            console.log('[TTS] create_tts_queue result:', result);
            const text = result.content?.[0]?.text;
            if (!text) { console.error('[TTS] No text in result'); return false; }
            let data;
            try { data = JSON.parse(text); }
            catch (e) { console.error('[TTS] Failed to parse result:', text); return false; }
            if (data.error) { console.log('[TTS] queue creation error:', data.error); return false; }
            queueIdRef.current = data.queue_id;
            sampleRateRef.current = data.sample_rate || 24000;
            console.log('[TTS] creating new AudioContext');
            audioContextRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
            nextPlayTimeRef.current = 0;
            startPolling();
            return true;
          } catch (err) { console.error('[TTS] initTTSQueue error:', err); return false; }
          finally { initQueuePromiseRef.current = null; }
        })();
        return initQueuePromiseRef.current;
      }, [startPolling]);

      const sendTextToTTS = useCallback(async (text) => {
        const app = appRef.current;
        if (!queueIdRef.current || !app) return;
        if (text.length > lastTextRef.current.length) {
          const diff = text.slice(lastTextRef.current.length);
          lastTextRef.current = text;
          try { await app.callServerTool({ name: "add_tts_text", arguments: { queue_id: queueIdRef.current, text: diff } }); }
          catch (err) {}
        }
      }, []);

      const ensureAudioContextResumed = useCallback(async () => {
        const ctx = audioContextRef.current;
        if (ctx && ctx.state === "suspended") {
          await ctx.resume();
          if (pendingChunksRef.current.length > 0) {
            // This is only reached during initial autoplay unblocking (before any audio played).
            // Reset nextPlayTimeRef to current time so chunks start immediately.
            nextPlayTimeRef.current = ctx.currentTime;
            const chunks = pendingChunksRef.current;
            pendingChunksRef.current = [];
            setHasPendingChunks(false);
            for (const chunk of chunks) await scheduleAudioChunkInternal(chunk);
          }
        }
      }, [scheduleAudioChunkInternal]);

      const restartPlayback = useCallback(async () => {
        console.log('[TTS] restartPlayback called');
        // Prevent concurrent audio operations
        if (audioOperationInProgressRef.current) { console.log('[TTS] restartPlayback blocked'); return; }
        audioOperationInProgressRef.current = true;
        try {
          if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
          await cancelCurrentQueue();
          if (audioContextRef.current) { await audioContextRef.current.close(); audioContextRef.current = null; }
          const textToReplay = fullTextRef.current || lastTextRef.current;
          if (!textToReplay) return;
          queueIdRef.current = null; lastTextRef.current = ""; isPollingRef.current = false;
          nextPlayTimeRef.current = 0; playbackStartTimeRef.current = 0;
          setStatus("idle"); chunkTimingsRef.current = []; allAudioReceivedRef.current = false;
          setCharPosition(0); pendingChunksRef.current = []; setHasPendingChunks(false);
          setDisplayText(textToReplay);
          const app = appRef.current;
          if (!app) return;
          const result = await app.callServerTool({ name: "create_tts_queue", arguments: { voice: voiceRef.current } });
          const data = JSON.parse(result.content[0].text);
          if (data.error) return;
          queueIdRef.current = data.queue_id;
          sampleRateRef.current = data.sample_rate || 24000;
          audioContextRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
          nextPlayTimeRef.current = 0;
          await app.callServerTool({ name: "add_tts_text", arguments: { queue_id: queueIdRef.current, text: textToReplay } });
          lastTextRef.current = textToReplay;
          await app.callServerTool({ name: "end_tts_queue", arguments: { queue_id: queueIdRef.current } });
          startPolling();
        } catch (err) {
        } finally {
          audioOperationInProgressRef.current = false;
        }
      }, [cancelCurrentQueue, startPolling]);

      const togglePlayPause = useCallback(async () => {
        console.log('[TTS] togglePlayPause called, status:', status, 'ctx:', audioContextRef.current?.state);
        // Prevent concurrent audio operations
        if (audioOperationInProgressRef.current) { console.log('[TTS] blocked by audioOpInProgress'); return; }
        let ctx = audioContextRef.current;
        try {
          if (status === "finished") { console.log('[TTS] finished, calling restartPlayback'); await restartPlayback(); return; }
          // If no context yet, wait for init to complete (up to 3s)
          if (!ctx) {
            console.log('[TTS] no ctx, waiting for init');
            for (let i = 0; i < 30 && !audioContextRef.current; i++) {
              await new Promise(r => setTimeout(r, 100));
            }
            ctx = audioContextRef.current;
            if (!ctx) { console.log('[TTS] still no ctx, giving up'); return; }
          }
          if (ctx.state === "suspended" || pendingChunksRef.current.length > 0) {
            console.log('[TTS] resuming via ensureAudioContextResumed');
            await ensureAudioContextResumed(); setStatus("playing"); return;
          }
          if (status === "paused") { console.log('[TTS] resuming paused'); await ctx.resume(); setStatus("playing"); }
          else if (status === "playing") { console.log('[TTS] pausing'); await ctx.suspend(); setStatus("paused"); }
        } catch (err) { console.error('[TTS] togglePlayPause error:', err); }
      }, [status, restartPlayback, ensureAudioContextResumed]);

      const toggleFullscreen = useCallback(async () => {
        const app = appRef.current;
        if (!app) return;
        const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
        try {
          const result = await app.requestDisplayMode({ mode: newMode });
          setDisplayMode(result.mode);
        } catch (err) {}
      }, [displayMode]);

      const { app, error } = useApp({
        appInfo: { name: "Say View", version: "1.0.0" },
        capabilities: {},
        onHostContextChanged: (ctx) => {
          if (ctx.availableDisplayModes?.includes("fullscreen")) {
            setFullscreenAvailable(true);
          }
          if (ctx.displayMode) {
            setDisplayMode(ctx.displayMode);
          }
        },
        onAppCreated: (app) => {
          appRef.current = app;
          app.ontoolinputpartial = async (params) => {
            console.log('[TTS] ontoolinputpartial called, queueId:', queueIdRef.current);
            const newText = params.arguments?.text;
            if (!newText) return;
            // Detect new session: text doesn't continue from where we left off
            const isNewSession = lastTextRef.current.length > 0 && !newText.startsWith(lastTextRef.current);
            if (isNewSession) {
              console.log('[TTS] new session detected in partial - resetting queue');
              // Reset for new session
              queueIdRef.current = null;
              lastTextRef.current = "";
            }
            setDisplayText(newText);
            if (!queueIdRef.current && !(await initTTSQueue())) {
              console.log('[TTS] initTTSQueue failed in partial');
              return;
            }
            await sendTextToTTS(newText);
          };
          app.ontoolinput = async (params) => {
            console.log('[TTS] ontoolinput called, queueId:', queueIdRef.current);
            const text = params.arguments?.text;
            if (!text) return;
            // Read voice setting (defaults to cosette)
            const voice = params.arguments?.voice || "cosette";
            voiceRef.current = voice;
            // Read autoPlay setting (defaults to true, but browser may block autoplay)
            const shouldAutoPlay = params.arguments?.autoPlay !== false;
            setAutoPlay(shouldAutoPlay);
            // Detect new session: text doesn't continue from where we left off
            const isNewSession = lastTextRef.current.length > 0 && !text.startsWith(lastTextRef.current);
            if (isNewSession) {
              console.log('[TTS] new session detected in input - resetting queue');
              queueIdRef.current = null;
              lastTextRef.current = "";
            }
            setDisplayText(text);
            if (!queueIdRef.current && !(await initTTSQueue())) {
              console.log('[TTS] initTTSQueue failed in input');
              return;
            }
            await sendTextToTTS(text);
          };
          app.ontoolresult = async (params) => {
            console.log('[TTS] ontoolresult called, queueId:', queueIdRef.current);
            fullTextRef.current = lastTextRef.current;
            // Read View UUID from tool result _meta for speak lock coordination
            const resultUuid = params.content?.[0]?._meta?.viewUUID;
            if (resultUuid) {
              viewUuidRef.current = resultUuid;
              console.log('[TTS] View UUID:', resultUuid);
            }
            if (queueIdRef.current) {
              console.log('[TTS] Calling end_tts_queue for:', queueIdRef.current);
              try { await app.callServerTool({ name: "end_tts_queue", arguments: { queue_id: queueIdRef.current } }); }
              catch (err) {
                console.log('[TTS] end_tts_queue error:', err);
              }
            } else {
              console.log('[TTS] No queueId to end in ontoolresult');
            }
            // DON'T reset here - let audio continue playing
            // New session detection happens in ontoolinputpartial via text comparison
          };
          app.onteardown = async () => {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            stopSpeakLockPolling();
            clearSpeakLock();
            await cancelCurrentQueue();
            if (audioContextRef.current) { await audioContextRef.current.close(); audioContextRef.current = null; }
            return {};
          };
          app.onhostcontextchanged = (params) => {
            setHostContext(prev => ({ ...prev, ...params }));
            // Sync displayMode when host changes it (e.g., user exits fullscreen via host UI)
            if (params.displayMode) {
              setDisplayMode(params.displayMode);
            }
            // Apply host theme and styles
            if (params.theme) {
              applyDocumentTheme(params.theme);
            }
            if (params.styles?.variables) {
              applyHostStyleVariables(params.styles.variables);
            }
            if (params.styles?.css?.fonts) {
              applyHostFonts(params.styles.css.fonts);
            }
          };
        },
      });

      useEffect(() => {
        if (!app) return;
        const ctx = app.getHostContext();
        setHostContext(ctx);
        if (ctx?.availableDisplayModes?.includes("fullscreen")) {
          setFullscreenAvailable(true);
        }
        if (ctx?.displayMode) {
          setDisplayMode(ctx.displayMode);
        }
        // Apply initial host theme and styles
        if (ctx?.theme) {
          applyDocumentTheme(ctx.theme);
        }
        if (ctx?.styles?.variables) {
          applyHostStyleVariables(ctx.styles.variables);
        }
        if (ctx?.styles?.css?.fonts) {
          applyHostFonts(ctx.styles.css.fonts);
        }
      }, [app]);

      // Speak lock: coordinate with other TTS Views
      useEffect(() => {
        if (status === "playing") {
          // Announce that we're playing
          announcePlayback();
          // Poll to detect if another View starts
          startSpeakLockPolling(() => {
            // Another View took over - pause
            const ctx = audioContextRef.current;
            if (ctx && ctx.state === "running") {
              ctx.suspend();
              setStatus("paused");
            }
          });
        } else {
          // Not playing - stop polling and clear lock if we own it
          stopSpeakLockPolling();
          if (status === "paused" || status === "finished") {
            clearSpeakLock();
          }
        }
        return () => stopSpeakLockPolling();
      }, [status, announcePlayback, startSpeakLockPolling, stopSpeakLockPolling, clearSpeakLock]);

      useEffect(() => {
        if (!app || !displayText || status === "idle") return;
        const caps = app.getHostCapabilities();
        if (!caps?.updateModelContext) return;
        const now = Date.now();
        const timeSince = now - lastModelContextUpdateRef.current;
        const DEBOUNCE_MS = 2000;
        const doUpdate = () => {
          lastModelContextUpdateRef.current = Date.now();
          pendingModelContextUpdateRef.current = null;
          const snippetStart = Math.max(0, charPosition - 30);
          const snippetEnd = Math.min(displayText.length, charPosition + 10);
          const snippet = `...` + displayText.slice(snippetStart, charPosition) + `█` + displayText.slice(charPosition, snippetEnd) + `...`;
          let statusText;
          if (status === "finished") statusText = `Finished playing ` + displayText.length + ` chars.`;
          else if (status === "paused") statusText = `PAUSED at "` + snippet + `" (` + charPosition + `/` + displayText.length + `)`;
          else statusText = `Playing: "` + snippet + `" (` + charPosition + `/` + displayText.length + `)`;
          app.updateModelContext({ content: [{ type: "text", text: statusText }] }).catch(() => {});
        };
        if (pendingModelContextUpdateRef.current) { clearTimeout(pendingModelContextUpdateRef.current); pendingModelContextUpdateRef.current = null; }
        if (timeSince >= DEBOUNCE_MS) doUpdate();
        else pendingModelContextUpdateRef.current = setTimeout(doUpdate, DEBOUNCE_MS - timeSince);
        return () => { if (pendingModelContextUpdateRef.current) clearTimeout(pendingModelContextUpdateRef.current); };
      }, [app, status, charPosition, displayText]);

      if (error) return <div><strong>ERROR:</strong> {error.message}</div>;
      if (!app) return <div>Connecting...</div>;

      const spokenText = displayText.slice(0, charPosition);
      const pendingText = displayText.slice(charPosition);

      return (
        <main
          className={`container` + (displayMode === "fullscreen" ? ` fullscreen` : ``)}
          style={{
            paddingTop: hostContext?.safeAreaInsets?.top,
            paddingRight: hostContext?.safeAreaInsets?.right,
            paddingBottom: showInfo ? 140 : hostContext?.safeAreaInsets?.bottom,
            paddingLeft: hostContext?.safeAreaInsets?.left,
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape" && displayMode === "fullscreen") {
              toggleFullscreen();
            }
          }}
        >
          <div className="textWrapper">
            <div className="textDisplay" onClick={togglePlayPause} style={{cursor: "pointer"}}>
              <span className="spoken">{spokenText}</span>
              <span className="pending">{pendingText}</span>
            </div>
          </div>
          {/* Toolbar - top right */}
          <div className="toolbar">
            <button className="controlBtn" onClick={togglePlayPause} title="Play/Pause">
              {status === "playing" ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : status === "finished" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              )}
            </button>
            <button className="controlBtn" onClick={restartPlayback} title="Restart">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
            <button className={`controlBtn fullscreenBtn` + (fullscreenAvailable ? ` available` : ``)} onClick={toggleFullscreen} title="Toggle fullscreen">
              <svg className="expandIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              <svg className="collapseIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </button>
          </div>
          {/* Info button - bottom right */}
          <button className="infoBtn" onClick={() => setShowInfo(!showInfo)} title="Attribution info">i</button>
          {showInfo && (
            <div className="infoPopup">
              <h4>Powered by Pocket TTS</h4>
              <ul>
                <li><a onClick={() => { app.openLink({ url: "https://github.com/kyutai-labs/pocket-tts" }); }}>Pocket TTS Repository</a> (Apache 2.0)</li>
                <li><a onClick={() => { app.openLink({ url: "https://huggingface.co/kyutai/pocket-tts" }); }}>Pocket TTS Model</a> (CC BY 4.0)</li>
                <li><a onClick={() => { app.openLink({ url: "https://huggingface.co/kyutai/tts-voices" }); }}>Voice Samples</a> (CC BY 4.0)</li>
              </ul>
            </div>
          )}
        </main>
      );
    }

    createRoot(document.getElementById('root')).render(<StrictMode><SayView /></StrictMode>);
  </script>
</body>
</html>"""


def get_view_html() -> str:
    """Get the View HTML, preferring built version from dist/."""
    # Prefer built version from dist/ (local development with npm run build)
    dist_path = Path(__file__).parent / "dist" / "mcp-app.html"
    if dist_path.exists():
        return dist_path.read_text()
    # Fallback to embedded View (for `uv run <url>` or unbundled usage)
    return EMBEDDED_VIEW_HTML


# IMPORTANT: all the external domains used by app must be listed
# in the meta.ui.csp.resourceDomains - otherwise they will be blocked by CSP policy
@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://esm.sh", "https://unpkg.com"]}}},
)
def view() -> str:
    """View HTML resource with CSP metadata for external dependencies."""
    return get_view_html()


# ------------------------------------------------------
# Startup
# ------------------------------------------------------

def load_tts_model():
    """Load the TTS model on startup."""
    global tts_model
    logger.info("Loading TTS model...")
    tts_model = TTSModel.load_model()
    logger.info("TTS model loaded")


def create_app():
    """Create the ASGI app (for uvicorn reload mode)."""
    load_tts_model()
    # Pass host=HOST to disable DNS rebinding protection for non-localhost deployments
    app = mcp.streamable_http_app(stateless_http=True, host=HOST)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    if "--stdio" in sys.argv:
        # Claude Desktop mode
        load_tts_model()
        mcp.run(transport="stdio")
    elif "--reload" in sys.argv:
        # Reload mode - pass app as string so uvicorn can reimport
        print(f"Say Server listening on http://{HOST}:{PORT}/mcp (reload mode)")
        uvicorn.run("server:create_app", host=HOST, port=PORT, reload=True, factory=True)
    else:
        # HTTP mode
        app = create_app()
        print(f"Say Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)
