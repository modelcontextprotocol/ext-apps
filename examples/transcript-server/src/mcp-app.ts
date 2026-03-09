/**
 * Live Transcript MCP App
 *
 * Simple speech-to-text transcription using Web Speech API.
 * Transcribed text can be sent to the host via ui/message.
 */
import {
  App,
  type McpUiHostContext,
  applyDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

const log = {
  info: console.log.bind(console, "[Transcript]"),
  warn: console.warn.bind(console, "[Transcript]"),
  error: console.error.bind(console, "[Transcript]"),
};

// ============================================================================
// DOM Elements
// ============================================================================

const mainEl = document.querySelector(".transcript-app") as HTMLElement;
const levelBarEl = document.getElementById("level-bar")!;
const micLevelEl = document.getElementById("mic-level")!;
const timerEl = document.getElementById("timer")!;
const transcriptEl = document.getElementById("transcript")!;
const startBtn = document.getElementById("start-btn")!;
const copyBtn = document.getElementById("copy-btn")!;
const clearBtn = document.getElementById("clear-btn")!;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

// ============================================================================
// State
// ============================================================================

let isListening = false;
let lastSentIndex = 0; // Track how many entries have been sent

// Timer
let timerStart: number | null = null;
let timerInterval: number | null = null;

// Audio
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let animationFrame: number | null = null;

// Speech Recognition
let recognition: SpeechRecognition | null = null;
let committedResultCount = 0; // How many results have been committed as entries
let interimTranscript = ""; // Current interim (unstable) text

// ============================================================================
// MCP App Setup
// ============================================================================

const app = new App({ name: "Live Transcript", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App teardown");
  stopListening();
  return {};
};

app.onerror = log.error;

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
}

app.onhostcontextchanged = handleHostContextChanged;

// ============================================================================
// Audio Capture
// ============================================================================

async function startAudioCapture(): Promise<boolean> {
  try {
    audioContext = new AudioContext();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const source = audioContext.createMediaStreamSource(micStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    source.connect(micAnalyser);

    updateAudioLevels();
    log.info("Audio capture started");
    return true;
  } catch (e) {
    log.error("Failed to start audio capture:", e);
    return false;
  }
}

function updateAudioLevels() {
  if (micAnalyser && isListening) {
    const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);
    micAnalyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const level = Math.min(100, (average / 128) * 100);
    micLevelEl.style.width = `${level}%`;
  } else {
    micLevelEl.style.width = "0%";
  }

  animationFrame = requestAnimationFrame(updateAudioLevels);
}

function stopAudioCapture() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  micLevelEl.style.width = "0%";
}

// ============================================================================
// Speech Recognition
// ============================================================================

function startSpeechRecognition(): boolean {
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) {
    log.warn("Speech recognition not supported");
    return false;
  }

  recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    log.info("Speech recognition started");
    committedResultCount = 0;
    interimTranscript = "";
  };

  recognition.onresult = (event) => {
    const e = event as SpeechRecognitionEvent;

    // Process results, committing newly-finalized ones
    interimTranscript = "";

    for (let i = 0; i < e.results.length; i++) {
      const result = e.results[i];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        // Only commit if this result hasn't been committed yet
        if (i >= committedResultCount) {
          const text = transcript.trim();
          if (text) {
            clearInterimTranscript();
            addTranscriptEntry(text, true);
            updateSendButton();
            updateModelContext();
          }
          committedResultCount = i + 1;
        }
      } else {
        // Accumulate all interim text
        interimTranscript += transcript;
      }
    }

    // Show interim text if any
    if (interimTranscript.trim()) {
      updateInterimTranscript("", interimTranscript);
    } else {
      clearInterimTranscript();
    }
  };

  recognition.onerror = (event) => {
    const e = event as SpeechRecognitionErrorEvent;
    log.error("Speech recognition error:", e.error);
    if (e.error === "not-allowed") {
      addTranscriptEntry("Microphone access denied", true);
      stopListening();
    }
  };

  recognition.onend = () => {
    log.info("Speech recognition ended");
    if (isListening) {
      // Restart if still supposed to be listening
      try {
        recognition?.start();
      } catch (e) {
        // Ignore
      }
    }
  };

  try {
    recognition.start();
    return true;
  } catch (e) {
    log.error("Failed to start speech recognition:", e);
    return false;
  }
}

function stopSpeechRecognition() {
  // Commit any accumulated final transcript before stopping
  commitFinalTranscript();

  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // Ignore
    }
    recognition = null;
  }
}

function commitFinalTranscript() {
  // Commit any remaining interim text when stopping
  const textToCommit = interimTranscript.trim();
  if (textToCommit) {
    clearInterimTranscript();
    addTranscriptEntry(textToCommit, true);
    updateSendButton();
    updateModelContext();
  }
  committedResultCount = 0;
  interimTranscript = "";
}

// ============================================================================
// UI Helpers
// ============================================================================

function clearTranscriptPlaceholder() {
  const placeholder = transcriptEl.querySelector(".transcript-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function startTimer() {
  timerStart = Date.now();
  timerEl.textContent = "0:00";
  timerEl.classList.add("active");
  timerInterval = window.setInterval(() => {
    if (timerStart) {
      const elapsed = Math.floor((Date.now() - timerStart) / 1000);
      timerEl.textContent = formatTime(elapsed);
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.classList.remove("active");
}

function addTranscriptEntry(text: string, isFinal: boolean) {
  // Skip empty entries
  if (!text.trim()) return;

  clearTranscriptPlaceholder();

  // Remove interim entry
  const interim = transcriptEl.querySelector(".transcript-entry.interim");
  if (interim) {
    interim.remove();
  }

  const timestamp = new Date().toLocaleTimeString();

  const entry = document.createElement("p");
  entry.className = `transcript-entry${isFinal ? "" : " interim"}`;
  entry.innerHTML = `<div class="timestamp">${timestamp}</div>${escapeHtml(text)}`;
  transcriptEl.appendChild(entry);
}

function updateInterimTranscript(finalText: string, interimText: string) {
  clearTranscriptPlaceholder();

  let interim = transcriptEl.querySelector(
    ".transcript-entry.interim",
  ) as HTMLElement;
  if (!interim) {
    interim = document.createElement("p");
    interim.className = "transcript-entry interim";
    transcriptEl.appendChild(interim);
  }

  const timestamp = new Date().toLocaleTimeString();

  // Show final text (stable) in normal style, interim text (unstable) in delta style
  const finalHtml = escapeHtml(finalText);
  const interimHtml = interimText
    ? `<span class="interim-delta">${escapeHtml(interimText)}</span>`
    : "";

  interim.innerHTML = `<div class="timestamp">${timestamp}</div>${finalHtml}${interimHtml}`;
}

function clearInterimTranscript() {
  const interim = transcriptEl.querySelector(".transcript-entry.interim");
  if (interim) {
    interim.remove();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatEntry(entry: HTMLElement): string {
  const timestamp = entry.querySelector(".timestamp")?.textContent?.trim();
  const clone = entry.cloneNode(true) as HTMLElement;
  clone.querySelector(".timestamp")?.remove();
  const text = clone.textContent?.trim() || "";
  if (!text) return "";
  return timestamp ? `[${timestamp}] ${text}` : text;
}

function formatEntries(entries: HTMLElement[]): string {
  return entries.map(formatEntry).filter(Boolean).join("\n");
}

function getAllEntries(): HTMLElement[] {
  return Array.from(
    transcriptEl.querySelectorAll(".transcript-entry:not(.interim)"),
  ) as HTMLElement[];
}

function getUnsentEntries(): HTMLElement[] {
  return getAllEntries().slice(lastSentIndex);
}

function getAllTranscriptText(): string {
  return formatEntries(getAllEntries());
}

function getUnsentText(): string {
  return formatEntries(getUnsentEntries());
}

function updateSendButton() {
  const unsentEntries = getUnsentEntries();
  sendBtn.disabled = unsentEntries.length === 0;
}

/**
 * Update model context with structured YAML frontmatter (like pdf-server, map-server).
 */
function updateModelContext() {
  const caps = app.getHostCapabilities();
  if (!caps?.updateModelContext) return;

  const text = getUnsentText();
  const unsentCount = getUnsentEntries().length;
  log.info("Updating model context:", text || "(empty)");

  // Build structured markdown with YAML frontmatter
  const frontmatter = [
    "---",
    "tool: transcribe",
    `status: ${isListening ? "listening" : "paused"}`,
    `unsent-entries: ${unsentCount}`,
    "---",
  ].join("\n");

  const markdown = text ? `${frontmatter}\n\n${text}` : frontmatter;

  app
    .updateModelContext({
      content: [{ type: "text", text: markdown }],
    })
    .catch((e: unknown) => {
      log.warn("Failed to update model context:", e);
    });
}

// ============================================================================
// Controls
// ============================================================================

async function startListening() {
  isListening = true;
  startBtn.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="6" y="4" width="4" height="16"/>
      <rect x="14" y="4" width="4" height="16"/>
    </svg>
    Stop
  `;
  startBtn.classList.add("recording");
  levelBarEl.classList.add("active");
  startTimer();

  const micOk = await startAudioCapture();
  if (!micOk) {
    addTranscriptEntry("Microphone access denied", true);
    stopListening();
    return;
  }

  if (!startSpeechRecognition()) {
    addTranscriptEntry("Speech recognition not available", true);
    stopListening();
  }
}

function stopListening() {
  isListening = false;
  startBtn.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Start
  `;
  startBtn.classList.remove("recording");
  levelBarEl.classList.remove("active");
  stopTimer();

  stopSpeechRecognition();
  stopAudioCapture();
}

startBtn.addEventListener("click", () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

copyBtn.addEventListener("click", async () => {
  const text = getAllTranscriptText();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    // Brief visual feedback
    copyBtn.classList.add("copied");
    setTimeout(() => copyBtn.classList.remove("copied"), 1000);
    log.info("Transcript copied to clipboard");
  } catch (e) {
    log.error("Failed to copy:", e);
  }
});

clearBtn.addEventListener("click", () => {
  transcriptEl.innerHTML =
    '<p class="transcript-placeholder">Your speech will appear here...</p>';
  lastSentIndex = 0;
  updateSendButton();
  updateModelContext();
});

sendBtn.addEventListener("click", async () => {
  const unsentEntries = getUnsentEntries();
  if (unsentEntries.length === 0) return;

  const transcriptText = getUnsentText();
  if (!transcriptText) return;

  log.info("Sending transcript:", transcriptText);

  try {
    const { isError } = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: transcriptText }],
    });

    if (isError) {
      log.warn("Message was rejected");
    } else {
      log.info("Message sent successfully");

      // Mark entries as sent
      unsentEntries.forEach((entry) => entry.classList.add("sent"));

      // Remove any existing divider
      transcriptEl.querySelector(".sent-divider")?.remove();

      // Add divider after the last sent entry
      const lastEntry = unsentEntries[unsentEntries.length - 1];
      const divider = document.createElement("div");
      divider.className = "sent-divider";
      divider.innerHTML = `<span>sent ${new Date().toLocaleTimeString()}</span>`;
      lastEntry.insertAdjacentElement("afterend", divider);

      // Update sent index
      const allEntries = transcriptEl.querySelectorAll(
        ".transcript-entry:not(.interim)",
      );
      lastSentIndex = allEntries.length;

      updateSendButton();
      updateModelContext(); // Clear context since we just sent
    }
  } catch (e) {
    log.error("Failed to send message:", e);
  }
});

// ============================================================================
// Initialize
// ============================================================================

app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
