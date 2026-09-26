# n8n-nodes-groundhogg

An [n8n](https://n8n.io) community node for the [Groundhogg](https://groundhogg.io) CRM REST API (v4).

Groundhogg is a WordPress-based marketing-automation / CRM plugin. This node lets your n8n workflows read and write contacts, tags, notes, tasks and activity from a Groundhogg install.

## Installation

In n8n:

1. Go to **Settings → Community Nodes**.
2. Click **Install**.
3. Enter the package name: `n8n-nodes-groundhogg`
4. Agree to the risks and install.

Or install manually:

```bash
npm install n8n-nodes-groundhogg
```

## Credentials

Create a credential of type **Groundhogg API** with:

| Field | Value |
|---|---|
| Site URL | Your WordPress site URL, e.g. `https://example.com` |
| Public Key | From **Groundhogg → Settings → API Keys** |
| Secret Key | From **Groundhogg → Settings → API Keys** |

The node signs requests using the `Gh-Public-Key` + `Gh-Token` headers. `Gh-Token` is computed as `md5(secretKey + publicKey)` — never exposing the secret on the wire.

Requires Groundhogg **3.x+** (REST API v4).

## Supported resources

Every **Get Many** operation has a **Return All** toggle. Left off (the default) it returns up to **Limit**; switched on, the node pages through the whole result set 100 at a time.

### Contact
- Create, Get, Get Many, Update, Delete
- Create/Update support core fields (name, optin status, owner), meta fields (phone, address, company, birthday, lead source, notes), tag application/removal, and Groundhogg custom fields (pick the meta key from a dropdown, or pass your own via an expression).
- Create is an **upsert** — if a contact with the email already exists it is updated.

### Contact Tag
- Apply Tags, Remove Tags, Get Tags
- Accepts comma-separated tag IDs or tag names. Unknown tag names on `Apply` are auto-created by Groundhogg.

### Flow
- **Add Contact** — enter one contact into an active flow (what Groundhogg's UI calls a Flow and the API still calls a funnel).
- **Add Segment** — enter a whole audience, which Groundhogg processes as a background batch job.
- Contacts enter at the flow's **first action step** unless an **Entry Step** is given, so any benchmark step ahead of it is skipped. This is not identical to starting a flow by applying a tag, and it leaves no tag on the contact.
- The flow must be **active**; the node checks first and says so rather than passing on the API's bare `401`.
- Flow, Contact and Entry Step are pickers that also accept an ID, a title/email, or an expression. Names and titles are resolved against Groundhogg and an unknown one fails the run, listing what does exist.
- **Add Segment** guardrails: an empty audience is refused (an empty request body would enter *every* contact on the site), the audience is counted before anything is sent, and an audience that matches every contact is refused unless **Add ALL Contacts** is on — Groundhogg silently ignores contact-query filters it does not recognise, which looks exactly like "everyone". Optional scheduling: batching (amount + interval) and a delayed start date/time in the site's time zone.
- There is no reverse operation — Groundhogg has no "remove from flow" endpoint. Queued steps can only be cancelled individually from the event queue.
- Requires the `start_flows` capability on the API key's WordPress user (which maps to `view_funnels` + `send_emails`), plus `edit_contact` on the contact. **Add Segment** additionally needs `schedule_flows` (`view_funnels` + `schedule_broadcasts`).

### Event Queue
- **Get Many** — inspect pending (and cancelled / failed / skipped) events, filtered by contact, flow, or status.
- **Cancel** — stop queued steps. Cancel every pending event for a contact (optionally scoped to one flow), or one specific event by ID.
- This is the nearest thing to "remove from flow": Groundhogg has no such endpoint. It stops steps the contact is still waiting on; it does not rewind anything a flow already did, and it does not remove tags the flow applied.
- Cancelled events stay in the queue marked `cancelled`, so the output reports `remaining_waiting` — what is still pending for that contact after the cancel.
- Every filter is re-checked client-side before anything is cancelled, so an ignored server-side filter can never cause someone else's events to be cancelled.

### Tag
- Create, Get, Get Many, Update, Delete

### Note
- Create, Get, Get Many, Update, Delete
- Notes are attached to a contact via the **Contact ID** field.

### Task
- Create, Get, Get Many, Update, Delete
- **Complete** and **Incomplete** — toggle a task's completion state.

### Activity
- Get Many — read engagement events (opens, clicks, page views, form submissions, bounces, etc.) optionally filtered by contact ID and activity type.

## A note on filters

Groundhogg's v4 API does not take filters the same way everywhere. `/contacts` overrides
`read()` and expects them nested under `query[...]`; every other object endpoint hands the
raw request params to its database query, so filters belong at the **top level** and a
`query[...]` wrapper is silently discarded — the endpoint then answers with *unfiltered*
rows rather than an error. Node versions before 0.4.0 sent `query[...]` everywhere, which
meant the Tag, Note, Task and Activity filters returned everything. Fixed in 0.4.0.

## Development

```bash
# install
npm install

# build (compiles TS + copies icons/JSON into dist/)
npm run build

# live rebuild during development
npm run dev
```

### Local testing against n8n

The easiest path is to link the built package into your local n8n:

```bash
# from this repo
npm run build
npm link

# in your n8n custom-nodes directory
# (typically ~/.n8n/custom on Linux/macOS; %USERPROFILE%\.n8n\custom on Windows)
npm link n8n-nodes-groundhogg
```

Then restart n8n and the **Groundhogg** node should appear in the node picker.

## Endpoints reference

All endpoints are under `<site>/wp-json/gh/v4/`.

| Node operation | HTTP | Path |
|---|---|---|
| Contact: Create | POST | `/contacts` |
| Contact: Get | GET | `/contacts/{id}` |
| Contact: Get Many | GET | `/contacts` |
| Contact: Update | PUT | `/contacts/{id}` |
| Contact: Delete | DELETE | `/contacts/{id}` |
| Contact Tag: Apply | POST | `/contacts/{id}/tags` |
| Contact Tag: Remove | DELETE | `/contacts/{id}/tags` |
| Contact Tag: Get | GET | `/contacts/{id}/tags` |
| Event Queue: Get Many | GET | `/event_queue` |
| Event Queue: Cancel | POST | `/event_queue/{id}/cancel` |
| Flow: Add Contact | POST | `/funnels/{id}/start` |
| Flow: Add Segment | POST | `/funnels/{id}/start` |
| Tag: Create | POST | `/tags` |
| Tag: Get | GET | `/tags/{id}` |
| Tag: Get Many | GET | `/tags` |
| Tag: Update | PUT | `/tags/{id}` |
| Tag: Delete | DELETE | `/tags/{id}` |
| Note: Create | POST | `/notes` |
| Note: Get | GET | `/notes/{id}` |
| Note: Get Many | GET | `/notes` |
| Note: Update | PUT | `/notes/{id}` |
| Note: Delete | DELETE | `/notes/{id}` |
| Task: Create | POST | `/tasks` |
| Task: Get | GET | `/tasks/{id}` |
| Task: Get Many | GET | `/tasks` |
| Task: Update | PUT | `/tasks/{id}` |
| Task: Delete | DELETE | `/tasks/{id}` |
| Task: Complete | PUT | `/tasks/{id}/complete` |
| Task: Incomplete | PUT | `/tasks/{id}/incomplete` |
| Activity: Get Many | GET | `/activity` |

## License

[MIT](./LICENSE.md)
