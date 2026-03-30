/**
 * Minimal DOM polyfills for pdfjs-dist on serverless runtimes (Vercel, etc.)
 * that don't provide browser globals.
 *
 * Must be imported BEFORE any pdfjs-dist import.
 */

if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[] | string) {
      if (Array.isArray(init)) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    get isIdentity() {
      return (
        this.a === 1 &&
        this.b === 0 &&
        this.c === 0 &&
        this.d === 1 &&
        this.e === 0 &&
        this.f === 0
      );
    }
    translate() {
      return new DOMMatrix();
    }
    scale() {
      return new DOMMatrix();
    }
    inverse() {
      return new DOMMatrix();
    }
    multiply() {
      return new DOMMatrix();
    }
    transformPoint(p?: { x: number; y: number }) {
      return p ?? { x: 0, y: 0 };
    }
    static fromMatrix() {
      return new DOMMatrix();
    }
  } as unknown as typeof DOMMatrix;
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  } as unknown as typeof ImageData;
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    closePath() {}
  } as unknown as typeof Path2D;
}
