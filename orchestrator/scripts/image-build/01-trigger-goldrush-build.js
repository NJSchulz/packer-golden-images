// Read GitHub integration settings.
var githubOwner      = githubConfig.getAttributeWithKey("githubOwner").value;
var githubRepository = githubConfig.getAttributeWithKey("githubRepository").value;
var workflowFile     = githubConfig.getAttributeWithKey("workflowFile").value;
var githubToken      = githubConfig.getAttributeWithKey("githubToken").value;

// Correlation ID: shown in the GitHub run name so the next step finds this run.
requestId = "vro-" + workflow.id;

var ref = (workflowRef == null || workflowRef === "") ? "main" : workflowRef;
var runMode = (mode == null || mode === "") ? "build" : mode;

// Build the workflow_dispatch payload.
var payload = {
    ref: ref,
    inputs: {
        mode: runMode,
        os: "oracle-9",
        request_id: requestId,
        image_name: imageName,
        source_library: sourceLibrary,
        subscribed_library: subscribedLibrary,
        config_path: configPath
        // The lab version also sent packer_ref, for a second (private) Packer
        // repo. This repo keeps Packer in packer/, so the input no longer exists
        // and GitHub would reject the dispatch (HTTP 422) if it were sent.
    }
};

var body = JSON.stringify(payload);

// Create request from the configured POST REST operation.
// URL template: /repos/{owner}/{repo}/actions/workflows/{workflowFile}/dispatches
// (the lab operation had owner/repo/file hardcoded in the URL).
var request = dispatchOperation.createRequest(
    [githubOwner, githubRepository, workflowFile],
    body
);

// GitHub API headers.
request.setHeader("Authorization", "Bearer " + githubToken);
request.setHeader("Accept", "application/vnd.github+json");
request.setHeader("X-GitHub-Api-Version", "2022-11-28");
request.setHeader("Content-Type", "application/json");
request.setHeader("User-Agent", "VCF-Operations-Orchestrator-goldRush");

System.log(
    "Dispatching Oracle Linux 9 golden image " + runMode + " for " +
    githubOwner + "/" + githubRepository + " at ref " + ref
);
System.log("Request ID: " + requestId);

dispatchTime = new Date().toISOString();
System.log("Dispatch time: " + dispatchTime);

var response = request.execute();

System.log("HTTP status: " + response.statusCode);

if (response.statusCode != 204) {
    var responseBody = response.contentAsString;
    System.error("GitHub workflow dispatch failed.");
    System.error(responseBody);
    throw "GitHub API returned HTTP " + response.statusCode;
}

System.log("goldRush workflow dispatch accepted.");
