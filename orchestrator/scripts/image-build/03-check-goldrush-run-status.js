if (runId == null || runId === "") {
    throw "runId is empty";
}

var githubToken = githubConfig.getAttributeWithKey("githubToken").value;
var githubOwner = githubConfig.getAttributeWithKey("githubOwner").value;
var githubRepository = githubConfig.getAttributeWithKey("githubRepository").value;

// Poll timeout: start the clock on the first status check
// (after the run was found and STARTED was posted).
var nowMs = new Date().getTime();
if (pollStartMs == null || pollStartMs <= 0) {
    pollStartMs = nowMs;
    System.log("Polling started: " + new Date(pollStartMs).toISOString());
}
var limitMinutes = (timeoutMinutes == null || timeoutMinutes <= 0) ? 90 : timeoutMinutes;

System.log("Checking GitHub run ID: " + runId);

// URL template: /repos/{owner}/{repo}/actions/runs/{run_id}
// (the original operation had owner/repo hardcoded in the URL).
var request = getRunOperation.createRequest(
    [githubOwner, githubRepository, String(runId)],
    null
);

request.setHeader("Authorization", "Bearer " + githubToken);
request.setHeader("Accept", "application/vnd.github+json");
request.setHeader("X-GitHub-Api-Version", "2022-11-28");
request.setHeader("User-Agent", "VCF-Operations-Orchestrator-goldRush");

var response = request.execute();

System.log("HTTP status: " + response.statusCode);

if (response.statusCode != 200) {
    var errorBody = response.contentAsString;
    System.error(errorBody);
    throw "GitHub API returned HTTP " + response.statusCode;
}

var run = JSON.parse(response.contentAsString);

runStatus = run.status == null ? "" : String(run.status);
runConclusion = run.conclusion == null ? "" : String(run.conclusion);
runUrl = run.html_url == null ? "" : String(run.html_url);

System.log("Run ID: " + run.id);
System.log("Status: " + runStatus);
System.log("Conclusion: " + runConclusion);
System.log("URL: " + runUrl);

// ------------------------------------------------------------
// Timeout: cancel the GitHub run and take the FAILED path.
// ------------------------------------------------------------
var elapsedMinutes = (nowMs - pollStartMs) / 60000;

if (runStatus != "completed" && elapsedMinutes >= limitMinutes) {

    System.warn(
        "GitHub run " + runId + " still '" + runStatus + "' after " +
        Math.floor(elapsedMinutes) + " minutes (timeout " + limitMinutes +
        "). Requesting cancel."
    );

    // POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel, built on the
    // GitHub API REST host (no extra REST operation needed).
    var cancelUrl = "/repos/" + githubOwner + "/" + githubRepository +
        "/actions/runs/" + runId + "/cancel";

    var cancelRequest = githubHost.createRequest("POST", cancelUrl, null);
    cancelRequest.setHeader("Authorization", "Bearer " + githubToken);
    cancelRequest.setHeader("Accept", "application/vnd.github+json");
    cancelRequest.setHeader("X-GitHub-Api-Version", "2022-11-28");
    cancelRequest.setHeader("User-Agent", "VCF-Operations-Orchestrator-goldRush");

    var cancelResponse = cancelRequest.execute();
    cancelHttpStatus = cancelResponse.statusCode;

    System.log("Cancel HTTP status: " + cancelHttpStatus);

    if (cancelHttpStatus == 202) {
        System.log("GitHub accepted the cancel request for run " + runId + ".");
        runStatus = "timed_out";
        runConclusion = "cancelled";
    } else if (cancelHttpStatus == 409) {
        // Run already finished between the status check and the cancel:
        // re-read it once and use its real result.
        System.log("Cancel returned 409 (run already finished). Re-reading run " + runId + ".");

        var reRequest = getRunOperation.createRequest(
            [githubOwner, githubRepository, String(runId)],
            null
        );
        reRequest.setHeader("Authorization", "Bearer " + githubToken);
        reRequest.setHeader("Accept", "application/vnd.github+json");
        reRequest.setHeader("X-GitHub-Api-Version", "2022-11-28");
        reRequest.setHeader("User-Agent", "VCF-Operations-Orchestrator-goldRush");

        var reResponse = reRequest.execute();

        if (reResponse.statusCode == 200) {
            var reRun = JSON.parse(reResponse.contentAsString);
            runStatus = reRun.status == null ? "" : String(reRun.status);
            runConclusion = reRun.conclusion == null ? "" : String(reRun.conclusion);
            runUrl = reRun.html_url == null ? runUrl : String(reRun.html_url);
            System.log("Re-read status: " + runStatus + ", conclusion: " + runConclusion);
        } else {
            System.error("Re-read of run " + runId + " returned HTTP " + reResponse.statusCode);
        }

        if (runStatus != "completed") {
            runStatus = "timed_out";
            if (runConclusion === "") {
                runConclusion = "cancelled";
            }
        }
    } else {
        System.error(cancelResponse.contentAsString);
        System.error("GitHub cancel request for run " + runId + " was not accepted.");
        runStatus = "timed_out";
        if (runConclusion === "") {
            runConclusion = "cancel_failed";
        }
    }
}
