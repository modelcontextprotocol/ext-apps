# Companion Views (experimental)

This prototype adds a nonmodal surface for the selected item's detail while the
source View remains mounted and interactive. It is not a display mode. Inline,
fullscreen, and picture-in-picture still place the same View; split placement
and reusable Views are not part of this experiment.

## Negotiation and routing

The source tool advertises `_meta.ui.companionResourceUri`, a distinct `ui://`
resource served by the same MCP server as the source View. The host resolves the
declaration through that connection, checks its resource MIME type, and applies
the normal sandbox, CSP, and permission policy. The basic host requires that the
URI be listed by that server. In the basic host, the source View keeps its
normal sandbox; the detail uses an opaque-origin sandbox behind a separate proxy
origin. Neither the resource URI nor the connection is chosen by the View.
Only the bridge associated with the source tool can operate its companion.

The parent and detail each advertise `experimental["io.modelcontextprotocol/companion-view"]`
as `{ "version": 1, "role": "parent" }` or `{ "version": 1, "role": "detail" }`
in `ui/initialize`. On an eligible bridge with a matching role, the host
acknowledges with `{ "version": 1, "generation": 0 }` for the first parent
session, or `{ "version": 1 }` for the detail. Without a matching acknowledgment
the source View can show details inline without sending requests.

The host starts a separate detail sandbox and bridge on the same connection.
Only `{ "itemId": "..." }` is passed as `hostContext.companionView`; the host
does not manufacture tool context, call a tool, or emit tool input or result
events on the detail bridge. These UI operations do not update model context,
send chat messages, or trigger a model turn.

## Request and lifecycle

The negotiated parent sends `ui/set-companion-view` with `{ generation, seq, itemId }`.
`itemId` is an opaque 1–128 character token (`A-Z`, `a-z`, `0-9`, `_`, `-`)
or `null` to close. URIs, selectors, and additional parameters are not accepted.
`seq` is a strictly increasing positive safe integer for that parent session.
`generation` is a nonnegative safe integer set by the host. The parent starts
with the generation from the acknowledgment and updates it when the host
dismisses the companion. Each new initialization, including a reload on the
same bridge, closes any old detail, invalidates pending work, and starts a fresh
generation with a new sequence counter. The parent must complete initialization
again before sending companion requests.

The response is `{ status, generation, itemId }`, with the **actual** generation
and currently visible item (or `null`):

- `shown`: the requested item is visible.
- `closed`: the companion was closed or already absent.
- `unavailable`, `denied`, `failed`: this request did not open a companion. The
  basic host denies opens while another parent owns the surface. The source View
  should fall back inline for a current selection.
- `stale`: a newer request, a different generation, or parent teardown superseded
  the request. The source View should not reopen or fall back on a stale response.

The host rechecks both fences before showing a prepared pane. Host dismissal
invalidates pending work, increments the generation, and sends
`ui/notifications/companion-view-closed` with `{ generation }` to the parent.
Parent teardown invalidates work and removes both surfaces. A normal switch or
companion close tears down only the detail. The source View preserves its
selection, list scroll, and filter even when its detail is dismissed.
