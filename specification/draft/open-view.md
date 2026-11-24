# Open View (experimental)

An MCP App can ask its host to open a second View without replacing or disabling
the source View. Trail Catalog uses this to show a selected trail in a separate
pane. The target and launch data are not specific to lists or items.

## Declaration and negotiation

The source tool declares named launch targets in its tool metadata, outside the
stable `_meta.ui` object. A host that does not support Open View can ignore the
namespaced entry and render the source as usual.

```json
{
  "_meta": {
    "ui": { "resourceUri": "ui://trail-catalog/list.html" },
    "io.modelcontextprotocol/open-view": {
      "targets": { "trail-detail": "ui://trail-catalog/detail.html" }
    }
  }
}
```

In `ui/initialize`, the source and opened Views advertise
`experimental["io.modelcontextprotocol/open-view"]` as
`{ "version": 1, "role": "source" }` and `{ "version": 1, "role": "opened" }`,
respectively. The host acknowledges only when the View's advertised role
matches its host-assigned role. The acknowledgment is `{ "version": 1, "generation": 0 }`
for the first source session and `{ "version": 1 }` for an opened View.
An opened View cannot use this operation to launch another View in this
prototype.

## Open and placement

Apps call `app.openView({ target, input?, preferredDisplayMode? })`. The SDK
supplies the wire counters and an empty input object if omitted. The negotiated
source sends `ui/open-view` with `{ target, input, preferredDisplayMode?, generation, seq }`.
A target is a 1-128 character identifier (`A-Z`, `a-z`, `0-9`, `_`, `-`), not a
URI. `input` is a JSON object limited to 4096 bytes when serialized as UTF-8.
The host treats it as data, not as instructions for routing or placement.

The host only resolves targets declared for the source on the same connection.
The reference host requires a distinct, listed `ui://` resource and checks
the returned URI and UI MIME type. It keeps the source's normal sandbox and
loads the target in a separate sandbox and bridge. The host passes `{ target, input }`
under `hostContext["io.modelcontextprotocol/open-view"]` to the opened View.
It does not fabricate a tool call, tool input or result, chat message, model
context update, or model turn.

`preferredDisplayMode` uses the existing display-mode values and applies only
to the new View. The host may choose another mode supported by the opened View
and returns the actual `displayMode` on success. It must not move, rerender,
cover, or disable the source to satisfy a preference. If no suitable placement
exists, it declines the open. The reference host uses an inline secondary pane
and does not reinterpret `fullscreen` as a side pane. `ui/request-display-mode`
still changes the presentation of a View that already exists.

## Outcome and lifecycle

- `opened`: the target is visible, with its actual `displayMode`.
- `unavailable`: the feature or surface is unavailable. The SDK returns this
  locally without sending a request if the host did not negotiate the capability.
- `denied`: the host declined the request, for example because it could not keep
  the source usable or the target was not declared.
- `failed`: the target could not be loaded or initialized.
- `stale`: a newer open, dismissal, or reinitialization superseded the request.

Apps can fall back inline for `unavailable`, `denied`, and `failed`; they should
ignore `stale`. For this prototype a new open replaces the previous secondary
View, and the host owns dismissal. There is no update-in-place operation.

On the wire every result carries `generation`. The host checks both the source's
generation and its strictly increasing positive `seq` before starting work and
again before showing the View. Dismissal invalidates pending work and sends
`ui/notifications/view-closed` with the new generation. Reinitialization clears
the previous pane and starts a fresh generation and sequence counter. Source
teardown closes both surfaces. The source stays mounted during ordinary opens,
switches, and secondary-pane dismissal.

[#847](https://github.com/modelcontextprotocol/ext-apps/pull/847) is precedent
for declared targets and host-owned launch. [#739](https://github.com/modelcontextprotocol/ext-apps/pull/739)
is related placement work. Neither is required by this prototype.
