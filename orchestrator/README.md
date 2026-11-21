# VCF Operations Orchestrator workflows

This is the caller side of goldRush. **VCF Operations Orchestrator** kicks off
the GitHub Actions build, follows it until it finishes, and reports started,
succeeded and failed events to **VCF Operations**. Those events raise the alerts
in [`../vcf-operations/`](../vcf-operations/). Tested on **Orchestrator 9.1.1**.

## What's in here

```text
workflows/
  goldrush-oracle-linux-9-image-build.xml   # main workflow (os: oracle-9)
  goldrush-rhel-9-image-build.xml           # thin copy (os: rhel-9)
  goldrush-post-vcf-operations-event.xml    # subworkflow that posts the event
scripts/
  image-build/*.js                          # every scriptable task / decision, readable
  post-vcf-operations-event/*.js
config-elements/*.example.json              # names + types only, no values
rest/rest-hosts.example.json                # REST hosts + operations to create
```

- **The RHEL 9 workflow is a copy of the Oracle Linux 9 one.** Only three
  things differ: the `os` value it dispatches (`rhel-9`) and two log or error
  strings. The scripts under `scripts/image-build/` are the Oracle Linux 9
  versions.
- **Three test workflows are not included.** "VCFOps Integration",
  "findLatest - Image Build" and "Test GitHub API" were scaffolding I used
  while building this, and none of the three workflows above calls them.
- **No Orchestrator actions are involved.** All the logic lives in inline
  scriptable tasks, and nothing calls `System.getModule`.

### Heads-up: these are content dumps, not a `.package`

The XML files are each workflow's **schema content**, as returned by the
Orchestrator REST API (`/vco/api/workflows/{id}/content`). The scripts are
pulled out of that XML. This is **not** an official package export, because I
didn't run an export job. All IDs are obvious placeholders such as
`11111111-1111-4111-8111-000000000001`. They match each other across the
workflow XML, the config element examples and the REST examples. The `href`
links are removed.

The most reliable way to bring these into your own Orchestrator is to
recreate them:

1. Create the two **REST hosts** and five **REST operations** from
   [`rest/rest-hosts.example.json`](rest/rest-hosts.example.json).
2. Create the two **config elements**, `goldRush-GitHub` and
   `goldRush-VCFOps`, and fill in your own values.
3. Create the **Post VCF Operations Event** workflow first, then the two image
   build workflows. For each scriptable task, paste in the matching file from
   `scripts/`. Then bind the attributes to your config elements and REST
   objects.

You can also try importing the XML as workflow content and then re-binding the
config element and REST attributes. Expect to fix those bindings, because the
placeholder IDs won't exist on your server. If you want a one-click import
later, export your working copy as a package from the client.

## How a build runs

Inputs (all strings): `imageName`, `sourceLibrary`, `subscribedLibrary`,
`configPath`, `mode` (default `build`) and `workflowRef` (default `main`).

```text
Trigger build -> Find dispatched run -> [Post STARTED] -> Check run status -> complete or timed out?
                                                              ^                  | no
                                                              +---- Sleep 60s <--+
                                                                                 | yes
                                                    successful? -- yes -> [Post SUCCEEDED] -> end
                                                                \- no  -> [Post FAILED] -> Report failure -> throw
```

1. **Trigger.** It builds `request_id = "vro-" + workflow.id`. That's this
   Orchestrator run's ID, so it's unique per run. It then POSTs a
   `workflow_dispatch` to
   `/repos/{owner}/{repo}/actions/workflows/{workflowFile}/dispatches` and
   expects **HTTP 204**. The inputs are `mode`, `os`, `request_id`,
   `image_name`, `source_library`, `subscribed_library` and `config_path`.
2. **Find the run.** It lists recent `workflow_dispatch` runs on the ref and
   picks the one whose `display_title` contains the `request_id`. The
   workflow's `run-name` puts it there. It tries **20 times, 3 seconds
   apart**, then gives up with an error.
3. **Post STARTED.** This happens only after the run is found, so the event
   already carries the run ID, number and URL.
4. **Poll.** It calls `GET /repos/{owner}/{repo}/actions/runs/{run_id}` every
   **60 seconds** until `status == "completed"`, or until the poll timeout
   (`timeoutMinutes`, default **90**) runs out. On timeout it cancels the
   GitHub run. See [Poll timeout](#poll-timeout).
5. **Finish.** If `conclusion == "success"`, it posts **SUCCEEDED** and ends.
   Anything else (failure, cancelled, timed_out and so on) posts **FAILED**,
   logs a summary and ends the workflow with an error.

Every GitHub call sends `Authorization: Bearer <githubToken>`,
`Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.

## Poll timeout

Both image build workflows stop polling after **`timeoutMinutes`** (a workflow
attribute, default **90**). Change it in the workflow's **Variables** tab; no
code edit is needed. A value of 0, a negative value or an empty value falls back
to 90. There are no new inputs, so callers and the request form don't change.

| Attribute | Type | Default | What |
|---|---|---|---|
| `timeoutMinutes` | number | `90` | How long to keep polling the GitHub run |
| `pollStartMs` | number | `0` | Runtime only: epoch ms of the first status check. Leave the default at 0 |
| `cancelHttpStatus` | number | `0` | Runtime only: HTTP status of the cancel call |

How it works:

1. **The clock starts on the first status check,** after the run is found
   and STARTED is posted. The find step's own 20 x 3 s limit is unchanged.
2. After each status read, if the run isn't `completed` and the time is up,
   "Check run status" sends
   `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel` on the
   `GitHub API` REST host, with the same headers as every other GitHub call.
   - **202:** `runStatus = timed_out`, `runConclusion = cancelled`.
   - **409** (the run finished in the meantime): it re-reads the run once and
     uses the real result. If the run is now `completed`, the normal
     SUCCEEDED or FAILED path applies.
   - **Anything else:** it logs the response body and sets
     `runStatus = timed_out`, `runConclusion = cancel_failed`.
3. "Is GitHub run complete?" treats `timed_out` as done, so the run takes the
   existing FAILED branch. That posts **`GOLDRUSH_BUILD_FAILED`** to VCF
   Operations with `Status: timed_out`, and the workflow ends with
   `goldRush build timed out after <N> minutes; GitHub run <run_id> cancel requested (HTTP <code>). ...`.

Things to know:

- **Granularity is about 60 seconds.** The check runs once per sleep cycle, so
  the worst case is `timeoutMinutes` plus about a minute.
- **The token needs Actions write** for the cancel. The dispatch already needs
  it. Without it the cancel returns 403 (`cancel_failed`), but the FAILED event
  and the error still fire.
- **GitHub cancels asynchronously.** The workflow doesn't wait for the run to
  reach `cancelled`. Packer gets a cancel signal and normally cleans up its VM,
  but after the first real timeout, check vCenter for a leftover Packer VM.
- Pick a value comfortably above a normal build. The Actions job's own
  `timeout-minutes: 180` still applies on the GitHub side.

## The config elements (no values here)

| Element | Attribute | Type | What |
|---|---|---|---|
| `goldRush-GitHub` | `githubOwner` | string | Repo owner, such as `<OWNER>` |
| | `githubRepository` | string | Repo name, such as `packer-golden-images` |
| | `workflowFile` | string | `golden-image.yml` |
| | `githubApiBaseUrl` | string | `https://api.github.com` (informational; the REST host URL is what's actually called) |
| | `githubToken` | SecureString | Fine-grained token with Actions read/write on the repo |
| `goldRush-VCFOps` | `opsHost` | string | VCF Operations FQDN (informational) |
| | `opsUsername` | string | Service account for posting events |
| | `opsAuthSource` | string | Auth source name, such as Local or your SSO source |
| | `opsPassword` | SecureString | Its password |
| | **`vCenterName`** | string | **New:** the vCenter adapter instance name in VCF Operations (usually the vCenter FQDN) |

## How events reach VCF Operations

The **Post VCF Operations Event** subworkflow makes three calls each time it
runs:

1. **Sign in.** It sends `POST /suite-api/api/auth/token/acquire` with
   `{username, password, authSource}`, expects HTTP 200, and reads `.token`.
   The token stays inside the task and is never logged. Later calls send
   `Authorization: OpsToken <token>`.
2. **Find the vCenter adapter instance.** It sends
   `GET /suite-api/api/resources?name={vCenterName}`, then picks the entry
   whose `resourceKey.name` equals `vCenterName`, whose `adapterKindKey` is
   `VMWARE` and whose `resourceKindKey` is `VMwareAdapter Instance`. Its
   `identifier` becomes the event's `resourceId`.
3. **Post the event.** It sends `POST /suite-api/api/events` and accepts HTTP
   200 or 201. The body is:

```json
{
  "eventType": "NOTIFICATION",
  "resourceId": "<vCenter adapter instance id>",
  "startTimeUTC": 1767225600000,
  "message": "GOLDRUSH_BUILD_SUCCEEDED\nImage: <image_name>\nRun Number: <n>\nRun ID: <run_id>\nStatus: completed\nConclusion: success\nSource Library: <SOURCE_CONTENT_LIBRARY>\nSubscriber Library: <SUBSCRIBER_LIBRARY>\nGitHub URL: https://github.com/<OWNER>/<REPO>/actions/runs/<run_id>",
  "severity": "INFORMATION",
  "managedExternally": true
}
```

**All three events are posted as `INFORMATION`, FAILED included.** The Failed
alert shows up as critical only because its **symptom definition** in VCF
Operations is set to Critical.

## Gotchas

- **The poll times out after `timeoutMinutes` (default 90).** Earlier
  versions had no maximum, so a stuck GitHub run (for example, an offline
  self-hosted runner) kept the Orchestrator run polling forever and never
  posted FAILED. It now cancels the GitHub run and posts FAILED with
  `Status: timed_out`. See [Poll timeout](#poll-timeout).
- **STARTED means "found," not "dispatched."** If GitHub never schedules the
  run, the find step fails after about a minute, and no event is posted.
- **Every event signs in and looks up the resource again,** so each one takes
  three VCF Operations calls. That's simple and stateless, and it's fine at
  this volume.
- **What changed from the lab version for portability:**
  - The vCenter name moved into `goldRush-VCFOps.vCenterName`. In the lab it
    was hardcoded in both the script and the REST operation URL.
  - The GitHub REST operations now take `{owner}`, `{repo}` and
    `{workflowFile}` from `goldRush-GitHub` instead of having them hardcoded
    in the URL.
  - The dispatch no longer sends `packer_ref`. This repo keeps Packer in
    `packer/`, so that input doesn't exist here.
  Every change is marked with a comment in the scripts.
