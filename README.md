# KUC carbon compliance review

A single-page Aramco hackathon demo for reviewing fertilizer shipment documents with the Upstage Studio agent.

## Run locally

Use Node.js 22 LTS (22.13 or later) or Node.js 24 LTS.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Put the real key in the ignored `.env.local` file and restart the server after changing the environment. If the file is missing, copy `.env.example` to `.env.local` first.

Create an account on the sign-in page, then sign in to run reviews. Accounts, password hashes, sessions, and workflow results are stored in the ignored `local-data/store.json` file. New runs retain their source documents in `local-data/sources` so signed-in owners can reopen them from Evidence. Keep this directory private. The store is intended for a single Node.js server with a persistent disk.
Set `CBAM_DATA_DIR` before starting the server to use a different directory for records and source documents.

| Variable | Server-side value |
| --- | --- |
| `UPSTAGE_API_KEY` | Required. Get your key in [Upstage Studio](https://console.upstage.ai/api-keys). |
| `UPSTAGE_AGENT_ID` | Optional. Defaults to the agent ID in [workflow-doc.md](workflow-doc.md). |
| `UPSTAGE_CONFIG_ID` | Optional. Defaults to config 7, as shown in the cURL example in [workflow-doc.md](workflow-doc.md). |

If you deployed the previous workflow with explicit agent or config overrides, clear those overrides to use the new defaults or update them to the current agent and config 7.

The API base URL is fixed at `https://api.upstage.ai/v2`. Upload one file per review. The app checks its extension, nonzero size, and 500 MB limit in the browser and on the server. Upstage checks the document contents, the 1,000-page limit and the 10-minute video limit.

## Workflow

The app uploads the document to `/files`, starts a job through `/responses`, and polls the original job about every 2.5 seconds. Polling backs off on transient failures and can be resumed from History. Results appear below the review steps. Open a result to see the Markdown case record and source pages, or reopen the same result from History. The dashboard also displays structured findings from earlier workflows. Terminal failures are recorded in History.

When a known job ends with a transient workflow failure, the app enables a manual rerun after a backoff. If a create request loses its response or returns an ambiguous error, check Studio before enabling another submission. The contract supplies neither a job-creation idempotency key nor a way to recover a lost job ID from the upload alone.

The app keeps document bytes in memory during transfer. Upstage retains uploads until explicitly deleted. Manage retained files in Upstage according to your document-handling requirements.

## Checks and deployment

```sh
npm run typecheck
npm run lint
npm run build
npm start
```

Deploy with a Node.js server using HTTPS and restricted access for demo participants. Configure deployment secrets server-side. Proxies and hosts must allow multipart bodies of at least 500,065,536 bytes, up to 10 minutes for the upstream file transfer, and up to 60 seconds for job creation, in addition to the time for the browser transfer. The browser allows 20 minutes for the initial submission. Poll requests have a 20-second upstream deadline and jobs can run across requests. Hosts with smaller hard upload or execution limits require a different deployment configuration.

The server bounds multipart parsing and accepts one concurrent upload per route process. Multipart parsing can hold several copies of the document in memory. Provision multiple GB of RAM per process for maximum-size uploads and test the full upload path through your hosting stack before the demo.
