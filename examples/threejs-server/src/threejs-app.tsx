/**
 * Three.js App Component
 *
 * Renders interactive 3D scenes using Three.js with streaming code preview.
 * Receives all MCP App props from the wrapper.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { ViewProps } from "./mcp-app-wrapper.tsx";

// =============================================================================
// Types
// =============================================================================

interface ThreeJSToolInput {
  code?: string;
  height?: number;
}

type ThreeJSAppProps = ViewProps<ThreeJSToolInput>;

// =============================================================================
// Constants
// =============================================================================

// Default demo code shown when no code is provided
const DEFAULT_THREEJS_CODE = `const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(width, height);
// Transparent background - scene composites over host UI
renderer.setClearColor(0x000000, 0);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x00ff88 })
);
// Start with an isometric-ish rotation to show 3 faces
cube.rotation.x = 0.5;
cube.rotation.y = 0.7;
scene.add(cube);

// Better lighting: key light + fill light + ambient
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(1, 1, 2);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
fillLight.position.set(-1, 0, -1);
scene.add(fillLight);
scene.add(new THREE.AmbientLight(0x404040, 0.5));

camera.position.z = 3;

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();`;

// =============================================================================
// Streaming Preview
// =============================================================================

function LoadingShimmer({ height, code }: { height: number; code?: string }) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [code]);

  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: "var(--border-radius-lg, 8px)",
        padding: 16,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, var(--color-background-secondary, light-dark(#f0f0f5, #2a2a3c)) 0%, var(--color-background-tertiary, light-dark(#e5e5ed, #1e1e2e)) 100%)",
      }}
    >
      <div
        style={{
          color: "var(--color-text-tertiary, light-dark(#666, #888))",
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        Three.js
      </div>
      {code && (
        <pre
          ref={preRef}
          style={{
            margin: 0,
            padding: 0,
            flex: 1,
            overflow: "auto",
            color: "var(--color-text-ghost, light-dark(#777, #aaa))",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "var(--font-text-xs-size, 11px)",
            lineHeight: "var(--font-text-xs-line-height, 1.4)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
}

// =============================================================================
// Three.js Execution
// =============================================================================

// Visibility-aware animation controller
function createAnimationController() {
  let isVisible = true;
  let pendingCallbacks: FrameRequestCallback[] = [];
  let rafIds: number[] = [];

  const visibilityAwareRAF = (callback: FrameRequestCallback): number => {
    if (isVisible) {
      const id = requestAnimationFrame(callback);
      rafIds.push(id);
      return id;
    } else {
      // Queue callback for when visible again
      pendingCallbacks.push(callback);
      return -1;
    }
  };

  const setVisible = (visible: boolean) => {
    isVisible = visible;
    if (visible && pendingCallbacks.length > 0) {
      // Resume queued animations
      const callbacks = pendingCallbacks;
      pendingCallbacks = [];
      callbacks.forEach((cb) => visibilityAwareRAF(cb));
    }
  };

  const cleanup = () => {
    rafIds.forEach((id) => cancelAnimationFrame(id));
    rafIds = [];
    pendingCallbacks = [];
  };

  return { visibilityAwareRAF, setVisible, cleanup };
}

const threeContext = {
  THREE,
  OrbitControls,
  EffectComposer,
  RenderPass,
  UnrealBloomPass,
};

async function executeThreeCode(
  code: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  visibilityAwareRAF: (callback: FrameRequestCallback) => number,
): Promise<void> {
  const fn = new Function(
    "ctx",
    "canvas",
    "width",
    "height",
    "requestAnimationFrame",
    `const { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass } = ctx;
     return (async () => { ${code} })();`,
  );
  await fn(threeContext, canvas, width, height, visibilityAwareRAF);
}

// =============================================================================
// Main Component
// =============================================================================

export default function ThreeJSApp({
  app,
  toolInputs,
  toolInputsPartial,
  hostContext,
}: ThreeJSAppProps) {
  const [error, setError] = useState<string | null>(null);
  const [currentDisplayMode, setCurrentDisplayMode] = useState<
    "inline" | "fullscreen"
  >("inline");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animControllerRef = useRef<ReturnType<
    typeof createAnimationController
  > | null>(null);

  const height = toolInputs?.height ?? toolInputsPartial?.height ?? 400;
  const code = toolInputs?.code || DEFAULT_THREEJS_CODE;
  const partialCode = toolInputsPartial?.code;
  const isStreaming = !toolInputs && !!toolInputsPartial;

  const safeAreaInsets = hostContext?.safeAreaInsets;
  const containerStyle = {
    paddingTop: safeAreaInsets?.top,
    paddingRight: safeAreaInsets?.right,
    paddingBottom: safeAreaInsets?.bottom,
    paddingLeft: safeAreaInsets?.left,
  };

  const canFullscreen =
    hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;
  const isFullscreen = currentDisplayMode === "fullscreen";

  // Sync display mode from host context
  useEffect(() => {
    if (
      hostContext?.displayMode === "inline" ||
      hostContext?.displayMode === "fullscreen"
    ) {
      setCurrentDisplayMode(hostContext.displayMode);
    }
  }, [hostContext?.displayMode]);

  const toggleFullscreen = useCallback(async () => {
    const newMode = isFullscreen ? "inline" : "fullscreen";
    try {
      const result = await app.requestDisplayMode({ mode: newMode });
      if (result.mode === newMode) {
        setCurrentDisplayMode(result.mode);
      }
    } catch {
      // ignore
    }
  }, [isFullscreen, app]);

  // Escape key exits fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) toggleFullscreen();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, toggleFullscreen]);

  // Visibility-based pause/play
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        animControllerRef.current?.setVisible(entry.isIntersecting);
      });
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!code || !canvasRef.current || !containerRef.current) return;

    // Cleanup previous animation
    animControllerRef.current?.cleanup();
    animControllerRef.current = createAnimationController();

    setError(null);
    const width = containerRef.current.offsetWidth || 800;
    executeThreeCode(
      code,
      canvasRef.current,
      width,
      height,
      animControllerRef.current.visibilityAwareRAF,
    ).catch((e) => setError(e instanceof Error ? e.message : "Unknown error"));

    return () => animControllerRef.current?.cleanup();
  }, [code, height]);

  if (isStreaming || !code) {
    return (
      <div style={containerStyle}>
        <LoadingShimmer height={height} code={partialCode} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`threejs-container${isFullscreen ? " fullscreen" : ""}`}
      style={containerStyle}
    >
      <canvas
        id="threejs-canvas"
        ref={canvasRef}
        style={{
          width: "100%",
          height,
          borderRadius: "var(--border-radius-lg, 8px)",
          display: "block",
        }}
      />
      {error && <div className="error-overlay">Error: {error}</div>}
      <button
        className={`fullscreen-btn${canFullscreen ? " available" : ""}`}
        title={isFullscreen ? "Exit fullscreen" : "Toggle fullscreen"}
        onClick={toggleFullscreen}
      >
        <svg
          className="expand-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
        <svg
          className="collapse-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
        </svg>
      </button>
    </div>
  );
}
