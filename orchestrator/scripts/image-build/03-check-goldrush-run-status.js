if (runId == null || runId === "") {
    throw "runId is empty";
}

var githubToken = githubConfig.getAttributeWithKey("githubToken").value;
var githubOwner = githubConfig.getAttributeWithKey("githubOwner").value;
var githubRepository = githubConfig.getAttributeWithKey("githubRepository").value;

System.log("Checking GitHub run ID: " + runId);

// URL template: /repos/{owner}/{repo}/actions/runs/{run_id}
// (the lab operation had owner/repo hardcoded in the URL).
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
