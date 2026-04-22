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

### Contact
- Create, Get, Get Many, Update, Delete
- Create/Update support core fields (name, optin status, owner), meta fields (phone, address, company, birthday, lead source, notes), tag application/removal, and Groundhogg custom fields via n8n's Resource Mapper.
- Create is an **upsert** — if a contact with the email already exists it is updated.

### Contact Tag
- Apply Tags, Remove Tags, Get Tags
- Accepts comma-separated tag IDs or tag names. Unknown tag names on `Apply` are auto-created by Groundhogg.

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
