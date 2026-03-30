// Polyfill DOMMatrix/ImageData/Path2D before pdfjs-dist loads.
// Uses dynamic import() so polyfills execute before pdfjs-dist initializes.
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
      if (Array.isArray(init))
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
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
    transformPoint(p) {
      return p ?? { x: 0, y: 0 };
    }
    static fromMatrix() {
      return new DOMMatrix();
    }
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  };
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
  };
}

// Dynamic import so polyfills above execute first.
const { default: handler } = await import("../dist/http.js");
export default handler;
