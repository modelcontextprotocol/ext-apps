/**
 * Type declarations for ShaderToyLite.js
 * https://github.com/chipweinberger/ShaderToyLite.js
 */

/** Valid buffer keys for channel inputs */
type BufferKey = "A" | "B" | "C" | "D";

/** Configuration for shader passes (buffers and image) */
interface ShaderConfig {
  /** GLSL fragment shader source code */
  source?: string;
  /** Buffer to use as iChannel0 input */
  iChannel0?: BufferKey;
  /** Buffer to use as iChannel1 input */
  iChannel1?: BufferKey;
  /** Buffer to use as iChannel2 input */
  iChannel2?: BufferKey;
  /** Buffer to use as iChannel3 input */
  iChannel3?: BufferKey;
}

/** ShaderToyLite instance methods */
interface ShaderToyLiteInstance {
  /**
   * Set common shader code shared across all passes.
   * @param source - GLSL source code to prepend to all shaders
   */
  setCommon(source?: string | null): void;

  /**
   * Set Buffer A shader pass.
   * @param config - Shader configuration or falsy to clear
   */
  setBufferA(config?: ShaderConfig | null): void;

  /**
   * Set Buffer B shader pass.
   * @param config - Shader configuration or falsy to clear
   */
  setBufferB(config?: ShaderConfig | null): void;

  /**
   * Set Buffer C shader pass.
   * @param config - Shader configuration or falsy to clear
   */
  setBufferC(config?: ShaderConfig | null): void;

  /**
   * Set Buffer D shader pass.
   * @param config - Shader configuration or falsy to clear
   */
  setBufferD(config?: ShaderConfig | null): void;

  /**
   * Set the main Image shader pass (renders to screen).
   * @param config - Shader configuration or falsy to clear
   */
  setImage(config?: ShaderConfig | null): void;

  /**
   * Set a callback to be called on each draw frame.
   * @param callback - Function to call each frame
   */
  setOnDraw(callback?: (() => void) | null): void;

  /**
   * Add a custom texture that can be used as a channel input.
   * @param texture - WebGL texture object
   * @param key - Buffer key to reference this texture (only A/B/C/D are recognized by iChannel bindings)
   */
  addTexture(texture: WebGLTexture, key: BufferKey): void;

  /**
   * Get the current playback time in seconds.
   * @returns Time elapsed since first draw
   */
  time(): number;

  /**
   * Check if the shader is currently playing.
   * @returns True if playing, false if paused
   */
  isPlaying(): boolean;

  /**
   * Reset playback to the beginning (time = 0, frame = 0).
   */
  reset(): void;

  /**
   * Pause shader playback.
   */
  pause(): void;

  /**
   * Start or resume shader playback.
   */
  play(): void;
}

/** ShaderToyLite constructor interface */
interface ShaderToyLiteConstructor {
  /**
   * Create a new ShaderToyLite instance.
   * @param canvasId - ID of the canvas element to render to
   */
  new (canvasId: string): ShaderToyLiteInstance;
}

declare const ShaderToyLite: ShaderToyLiteConstructor;
export default ShaderToyLite;
export type { ShaderToyLiteInstance, ShaderConfig, BufferKey };
