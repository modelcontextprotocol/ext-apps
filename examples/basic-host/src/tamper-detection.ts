/**
 * Tamper Detection Module for MCP-UI Sandbox
 *
 * Generates a script that monitors security-sensitive JavaScript APIs
 * and emits notifications when guest code accesses them.
 */

export type TamperRuleTarget =
  | "window"
  | "Element.prototype"
  | "Document.prototype"
  | "Node.prototype"
  | "HTMLElement.prototype"
  | "EventTarget.prototype"
  | "History.prototype"
  | "Location.prototype";

export type TamperRuleType = "getter" | "method" | "both";
export type TamperSeverity = "low" | "medium" | "high" | "critical";

export interface TamperRule {
  target: TamperRuleTarget;
  property: string;
  type: TamperRuleType;
  severity: TamperSeverity;
}

export const TAMPER_DETECTED_NOTIFICATION =
  "ui/notifications/tamper-detected" as const;

/**
 * Default rules for security-sensitive APIs.
 * - critical: Access is blocked (returns undefined / throws)
 * - high/medium/low: Access is allowed but an alert is emitted
 */
export const DEFAULT_TAMPER_RULES: TamperRule[] = [
  // === CRITICAL (blocked) ===
  // Escape attempts
  { target: "window", property: "top", type: "getter", severity: "critical" },
  {
    target: "window",
    property: "parent",
    type: "getter",
    severity: "critical",
  },
  {
    target: "window",
    property: "opener",
    type: "getter",
    severity: "critical",
  },
  {
    target: "window",
    property: "frameElement",
    type: "getter",
    severity: "critical",
  },
  // Code execution
  { target: "window", property: "eval", type: "method", severity: "critical" },

  // === HIGH (allowed with alert) ===
  { target: "window", property: "Function", type: "getter", severity: "high" },
  // Network/data exfiltration
  { target: "window", property: "fetch", type: "method", severity: "high" },
  {
    target: "window",
    property: "XMLHttpRequest",
    type: "getter",
    severity: "high",
  },
  { target: "window", property: "WebSocket", type: "getter", severity: "high" },
  {
    target: "window",
    property: "EventSource",
    type: "getter",
    severity: "high",
  },
  // DOM injection (high-risk methods)
  {
    target: "Document.prototype",
    property: "write",
    type: "method",
    severity: "high",
  },
  {
    target: "Document.prototype",
    property: "writeln",
    type: "method",
    severity: "high",
  },
  {
    target: "Element.prototype",
    property: "insertAdjacentHTML",
    type: "method",
    severity: "high",
  },

  // === MEDIUM (allowed with alert) ===
  // Storage access
  {
    target: "window",
    property: "localStorage",
    type: "getter",
    severity: "medium",
  },
  {
    target: "window",
    property: "sessionStorage",
    type: "getter",
    severity: "medium",
  },
  {
    target: "window",
    property: "indexedDB",
    type: "getter",
    severity: "medium",
  },
  { target: "window", property: "caches", type: "getter", severity: "medium" },
  // DOM injection (property-based)
  {
    target: "Element.prototype",
    property: "innerHTML",
    type: "both",
    severity: "medium",
  },
  {
    target: "Element.prototype",
    property: "outerHTML",
    type: "both",
    severity: "medium",
  },
  // DOM traversal
  {
    target: "Node.prototype",
    property: "parentNode",
    type: "getter",
    severity: "medium",
  },
  {
    target: "Node.prototype",
    property: "parentElement",
    type: "getter",
    severity: "medium",
  },
  {
    target: "Element.prototype",
    property: "closest",
    type: "method",
    severity: "medium",
  },
  // History manipulation
  { target: "window", property: "history", type: "getter", severity: "medium" },
  {
    target: "window",
    property: "location",
    type: "getter",
    severity: "medium",
  },

  // === LOW (allowed with alert) ===
  // Message passing
  {
    target: "window",
    property: "postMessage",
    type: "method",
    severity: "low",
  },
  // DOM queries
  {
    target: "Document.prototype",
    property: "querySelector",
    type: "method",
    severity: "low",
  },
  {
    target: "Document.prototype",
    property: "querySelectorAll",
    type: "method",
    severity: "low",
  },
  {
    target: "Document.prototype",
    property: "getElementById",
    type: "method",
    severity: "low",
  },
];

/**
 * Generates the tamper detection script as a string.
 * This script should be injected into guest HTML before any other scripts run.
 */
export function generateTamperDetectionScript(
  rules: TamperRule[] = DEFAULT_TAMPER_RULES,
): string {
  const rulesJson = JSON.stringify(rules);

  return `(function() {
  'use strict';

  var NOTIFICATION_METHOD = '${TAMPER_DETECTED_NOTIFICATION}';
  var rules = ${rulesJson};

  function emitTamperAlert(rule, accessType, stackTrace) {
    try {
      window.parent.postMessage({
        jsonrpc: '2.0',
        method: NOTIFICATION_METHOD,
        params: {
          property: rule.target + '.' + rule.property,
          accessType: accessType,
          severity: rule.severity,
          blocked: rule.severity === 'critical',
          timestamp: Date.now(),
          stack: stackTrace
        }
      }, '*');
    } catch (e) {
      // Silently fail if postMessage is unavailable
    }
  }

  function shouldBlock(rule) {
    return rule.severity === 'critical';
  }

  function wrapProperty(target, prop, rule) {
    var descriptor = Object.getOwnPropertyDescriptor(target, prop);
    if (!descriptor) return false;

    var newDescriptor = {
      configurable: false,
      enumerable: descriptor.enumerable
    };

    var wrapped = false;

    if (rule.type === 'getter' || rule.type === 'both') {
      var originalGetter = descriptor.get || (function() { return descriptor.value; });
      newDescriptor.get = function() {
        emitTamperAlert(rule, 'read', new Error().stack);
        if (shouldBlock(rule)) {
          return undefined;
        }
        return originalGetter.call(this);
      };
      wrapped = true;
    }

    if (rule.type === 'method' && typeof descriptor.value === 'function') {
      var originalMethod = descriptor.value;
      newDescriptor.value = function() {
        emitTamperAlert(rule, 'call', new Error().stack);
        if (shouldBlock(rule)) {
          throw new Error('Access to ' + rule.target + '.' + rule.property + ' is blocked');
        }
        return originalMethod.apply(this, arguments);
      };
      wrapped = true;
    }

    if (rule.type === 'both' && descriptor.set) {
      var originalSetter = descriptor.set;
      newDescriptor.set = function(value) {
        emitTamperAlert(rule, 'write', new Error().stack);
        if (shouldBlock(rule)) {
          return;
        }
        return originalSetter.call(this, value);
      };
    }

    if (wrapped) {
      try {
        Object.defineProperty(target, prop, newDescriptor);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function getTargetObject(targetName) {
    switch (targetName) {
      case 'window': return window;
      case 'Element.prototype': return Element.prototype;
      case 'Document.prototype': return Document.prototype;
      case 'Node.prototype': return Node.prototype;
      case 'HTMLElement.prototype': return HTMLElement.prototype;
      case 'EventTarget.prototype': return EventTarget.prototype;
      case 'History.prototype': return History.prototype;
      case 'Location.prototype': return Location.prototype;
      default: return null;
    }
  }

  // Install monitoring
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var target = getTargetObject(rule.target);
    if (target) {
      wrapProperty(target, rule.property, rule);
    }
  }
})();`;
}

/**
 * Injects a script into HTML content, ensuring it runs before any other scripts.
 */
export function injectScriptIntoHtml(html: string, script: string): string {
  const scriptTag = `<script>${script}</script>`;

  // Try <head> first
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${scriptTag}`);
  }
  // Try <body>
  if (html.includes("<body>")) {
    return html.replace("<body>", `<body>${scriptTag}`);
  }
  // Fallback: prepend
  return scriptTag + html;
}
