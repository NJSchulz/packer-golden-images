# VCF Operations alerts for goldRush builds

Three small alert definitions that make every golden-image build show up in
**VCF Operations**: started, succeeded and failed. Tested on **VCF Operations
9.1.1**.

| Alert | Symptom fires when a notification event's message CONTAINS | Symptom severity |
|---|---|---|
| Golden Image Build Started | `GOLDRUSH_BUILD_STARTED` | Information |
| Golden Image Build Succeeded | `GOLDRUSH_BUILD_SUCCEEDED` | Information |
| Golden Image Build Failed | `GOLDRUSH_BUILD_FAILED` | Critical |

## What's in here

```text
symptom-definitions/{started,succeeded,failed}.json|.xml
alert-definitions/{started,succeeded,failed}.json|.xml
```

All six use the same settings:

- **Adapter kind** `VMWARE`, **resource kind** `VMwareAdapter Instance`. The
  events attach to the **vCenter adapter instance**, not to a VM.
- **Symptoms:** condition `CONDITION_MESSAGE_EVENT`, event type `NOTIFICATION`,
  operator `CONTAINS`, wait cycles 1, cancel cycles 1.
- **Alerts:** type 15 / subtype 21 (**Application / Compliance**), severity
  `AUTO` (it inherits the symptom's criticality), impact **Health** badge,
  symptom set relation `SELF`, operator `AND`, one symptom each, and an empty
  description.

### Heads-up: these are API representations, not a UI export

These files show how the definitions look in the **suite-api**
(`/suite-api/api/symptomdefinitions` and `/suite-api/api/alertdefinitions`),
with every real ID removed. They are **not** the official UI **Export**
package. That export runs as a server-side job, and I didn't run it for this
repo. If you want a one-click import, build the definitions once (below), then
use **Export** in the UI to get a package you can import anywhere.

The `id` values are obviously fake placeholders, such as
`SymptomDefinition-goldrush-build-failed`. They only keep the files
consistent with each other. VCF Operations assigns its own IDs when you
create the definitions.

## Recreate them

### In the UI (easiest)

1. **Configure > Alerts > Symptom Definitions > Add.** Choose the vCenter
   adapter's **vCenter Adapter Instance** object type, pick a **Message Event**
   symptom with event type **Notification**, set it to **contains**
   `GOLDRUSH_BUILD_STARTED`, and set the severity. Repeat for SUCCEEDED and
   FAILED.
2. **Configure > Alerts > Alert Definitions > Add.** Use the same object type,
   set Impact to Health, set Criticality to Symptom Based, and add the matching
   symptom. Do this once for each of the three alerts.

### With the API

1. `POST /suite-api/api/symptomdefinitions` with each file from
   `symptom-definitions/`, leaving out the `id` field. Write down the
   `SymptomDefinition-...` ID each call returns.
2. In each file from `alert-definitions/`, replace the placeholder in
   `symptomDefinitionIds` with the real ID **of the symptom with the same
   name**. Remove the `id` field, then
   `POST /suite-api/api/alertdefinitions`.

## The event message

The symptoms only need the token somewhere in the message (`CONTAINS`). The rest of
the message is free text for whoever reads the alert. This is the format the
flow uses:

```text
GOLDRUSH_BUILD_SUCCEEDED Image: <image_name> Run Number: <n> Run ID: <run_id> Status: completed Conclusion: success Source Library: <SOURCE_CONTENT_LIBRARY> Subscriber Library: <SUBSCRIBER_LIBRARY> GitHub URL: https://github.com/<OWNER>/<REPO>/actions/runs/<run_id>
```

The event is posted with `POST /suite-api/api/events` against the vCenter
adapter instance's resource ID.

## Who posts the events?

**Not** the GitHub Actions workflow in this repo, which has no VCF Operations
code at all. The **VCF Operations Orchestrator** side of the flow posts them.
That's a workflow that dispatches the GitHub run, polls it until it finishes,
and POSTs the started and finished events to `/suite-api/api/events`. That
Orchestrator workflow isn't in this repo yet.

## Good to know

- **These alerts don't clear on their own.** Message-event symptoms never
  cancel by themselves, so after the first event each alert stays active and
  simply refreshes on every new matching event. `cancelCycles` is 1, but it
  only matters once a cancel condition is met, and nothing here meets one.
  Cancel the alert by hand, or treat the alert's update time as the signal.
- **No recommendations and no notification rules** are tied to these alerts.
  Posting the event is enough to raise the alert. Add a notification rule if
  you want a ping in chat or email.
