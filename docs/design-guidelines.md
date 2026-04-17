---
title: Design Guidelines
group: Getting Started
description: UX guidance for MCP Apps, covering host-provided chrome, content sizing, and visual consistency with the surrounding chat.
---

# Design Guidelines

An MCP App is part of a conversation. It should read as a continuation of the chat, not as a separate application embedded inside it.

## Host chrome

Hosts render a frame around your App that typically includes:

- A title bar showing the App name (from tool or server metadata)
- Display-mode controls (expand, collapse, close)
- Attribution indicating which connector or server provided the App

Do not duplicate these elements. Your App does not need its own close button, header bar, or "powered by" footer. Begin the layout with content.

A title inside the content area (for example, "Q3 Revenue by Region" above a chart) is acceptable. The App's brand name is not.

## Scope

An MCP App answers one question or supports one task. Avoid building a full dashboard with tabs, sidebars, and settings panels.

- Inline content can be tall, but it must scroll with the surrounding conversation. Do not introduce nested scroll containers in inline mode; a scrollable region inside a scrollable chat is difficult to use on every input device.
- Design the inline layout to remain usable at narrow widths. Chat columns can be as narrow as a mobile message bubble, so dense toolbars and side-by-side panels should collapse or move to fullscreen mode rather than overflow.
- Avoid multi-page navigation (routes, wizards, tab stacks) in inline mode. The conversation already provides history and back-navigation. In-App search or filtering over the current data set is fine; navigating to a different document or view is better handled by a follow-up tool call, or reserved for fullscreen mode.

## Host UI imitation

Use host-provided styles so your App matches the surrounding theme, but keep the boundary between App content and host UI unambiguous. Do not render:

- Chat bubbles or message threads
- Anything that resembles the host's text input or send button
- System notifications or permission dialogs

A user must never mistake App-rendered surfaces for host controls. Most hosts prohibit these patterns in their submission guidelines.

## Host styling

Hosts provide CSS custom properties for colors, fonts, spacing, and border radius (see [Adapting to host context](./patterns.md#adapting-to-host-context-theme-styling-fonts-and-safe-areas)). Using them keeps your App consistent across light mode, dark mode, and different host themes.

Brand colors are appropriate for content elements such as chart series or status badges. Backgrounds, text, and borders should use host variables. Always provide fallback values so the App renders correctly on hosts that omit some variables.

## Display modes

Design for inline mode first. It is the default, and it is narrow (often the width of a chat message). Inline height is effectively unconstrained: hosts apply only a high safety cap, so the iframe will grow to whatever content height the App reports.

Treat fullscreen as a progressive enhancement for Apps that benefit from more space: editors, maps, large datasets. Check `hostContext.availableDisplayModes` before rendering a fullscreen toggle, since not every host supports it.

When the display mode changes, update your layout: remove edge border radius and expand to fill the viewport. To size the App to the space the host provides, subscribe to `hostContext.containerDimensions` via {@link app!App.onhostcontextchanged `onhostcontextchanged`} and apply the reported width and height to your root element.

## Loading and empty states

The App mounts before the tool result arrives, and even before the tool inputs are sent. Between `ui/initialize` and `ontoolresult`, render a loading indicator such as a skeleton, spinner, or neutral background. A blank rectangle looks broken.

If the tool result can be empty (no search results, empty cart), design an explicit empty state rather than rendering nothing.
