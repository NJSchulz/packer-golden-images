var githubToken = githubConfig.getAttributeWithKey("githubToken").value;
var githubOwner = githubConfig.getAttributeWithKey("githubOwner").value;
var githubRepository = githubConfig.getAttributeWithKey("githubRepository").value;
var workflowFile = githubConfig.getAttributeWithKey("workflowFile").value;

if (requestId == null || requestId === "") {
    throw "requestId is empty";
}

var ref = (workflowRef == null || workflowRef === "") ? "main" : workflowRef;

// List recent dispatch runs on the dispatched ref. The fixed findRun REST
// operation filters on branch=main, so build the request on the host instead.
var url = "/repos/" + githubOwner + "/" + githubRepository +
    "/actions/workflows/" + workflowFile +
    "/runs?event=workflow_dispatch&per_page=20&branch=" + encodeURIComponent(ref);

var maxAttempts = 20;
var retryDelayMs = 3000;   // 3 seconds

var run = null;

for (var attempt = 1; attempt <= maxAttempts; attempt++) {

    System.log(
        "Searching for GitHub run with request ID " + requestId +
        ". Attempt " + attempt + " of " + maxAttempts
    );

    var request = githubHost.createRequest("GET", url, null);

    request.setHeader("Authorization", "Bearer " + githubToken);
    request.setHeader("Accept", "application/vnd.github+json");
    request.setHeader("X-GitHub-Api-Version", "2022-11-28");
    request.setHeader("User-Agent", "VCF-Operations-Orchestrator-goldRush");

    var response = request.execute();

    if (response.statusCode != 200) {
        System.error(response.contentAsString);
        throw "GitHub API returned HTTP " + response.statusCode;
    }

    var data = JSON.parse(response.contentAsString);
    var runs = data.workflow_runs || [];

    for (var i = 0; i < runs.length; i++) {
        var title = runs[i].display_title || runs[i].name || "";
        if (title.indexOf(requestId) >= 0) {
            run = runs[i];
            break;
        }
    }

    if (run != null) {
        break;
    }

    if (attempt < maxAttempts) {
        System.sleep(retryDelayMs);
    }
}

if (run == null) {
    throw (
        "No GitHub Actions run with request ID " + requestId +
        " found on ref " + ref + " after " + maxAttempts + " attempts"
    );
}

// Populate workflow outputs.
runId = String(run.id);
runNumber = String(run.run_number);
runStatus = run.status == null ? "" : String(run.status);
runConclusion = run.conclusion == null ? "" : String(run.conclusion);
runUrl = run.html_url == null ? "" : String(run.html_url);

System.log("Matched GitHub Actions run");
System.log("Run name: " + (run.display_title || ""));
System.log("Run ID: " + runId);
System.log("Run number: " + runNumber);
System.log("Status: " + runStatus);
System.log("Conclusion: " + runConclusion);
System.log("URL: " + runUrl);
