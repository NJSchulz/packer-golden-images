//
// GOLD RUSH -> VCF OPERATIONS EVENT
//

// ------------------------------------------------------------
// STEP 1 - Validate input
// ------------------------------------------------------------

if (
    eventStage == null ||
    eventStage === ""
) {
    throw "eventStage is empty";
}

eventStage = String(eventStage).toUpperCase();

if (
    eventStage != "STARTED" &&
    eventStage != "SUCCEEDED" &&
    eventStage != "FAILED"
) {
    throw "Unsupported eventStage: " + eventStage;
}


// ------------------------------------------------------------
// STEP 2 - Read VCF Operations credentials
// ------------------------------------------------------------

var opsUsername =
    opsConfig.getAttributeWithKey("opsUsername").value;

var opsPassword =
    opsConfig.getAttributeWithKey("opsPassword").value;

var opsAuthSource =
    opsConfig.getAttributeWithKey("opsAuthSource").value;

// vCenter (adapter instance) name as it appears in VCF Operations, e.g. the
// vCenter FQDN. The lab version hardcoded this twice (here and in the REST
// operation URL); it now comes from the config element.
var vCenterName =
    opsConfig.getAttributeWithKey("vCenterName").value;

if (vCenterName == null || vCenterName === "") {
    throw "goldRush-VCFOps attribute vCenterName is empty";
}


// ------------------------------------------------------------
// STEP 3 - Authenticate locally
// ------------------------------------------------------------

var authPayload = {
    username: opsUsername,
    password: opsPassword,
    authSource: opsAuthSource
};

var authBody = JSON.stringify(authPayload);

var authRequest =
    tokenOperation.createRequest([], authBody);

authRequest.setHeader(
    "Accept",
    "application/json"
);

authRequest.setHeader(
    "Content-Type",
    "application/json"
);

System.log(
    "Authenticating to VCF Operations for goldRush event..."
);

var authResponse =
    authRequest.execute();

System.log(
    "Authentication HTTP status: " +
    authResponse.statusCode
);

if (authResponse.statusCode != 200) {

    System.error(
        "VCF Operations authentication failed."
    );

    System.error(
        authResponse.contentAsString
    );

    throw "VCF Operations token request returned HTTP " +
        authResponse.statusCode;
}

var authData =
    JSON.parse(authResponse.contentAsString);

if (!authData.token) {
    throw "VCF Operations token response did not contain a token";
}

var localOpsToken =
    String(authData.token);

System.log(
    "VCF Operations authentication succeeded."
);


// ------------------------------------------------------------
// STEP 4 - Find target vCenter resource
// ------------------------------------------------------------

// URL template: /suite-api/api/resources?name={name}
var resourceRequest =
    findResourceOperation.createRequest([vCenterName], null);

resourceRequest.setHeader(
    "Authorization",
    "OpsToken " + localOpsToken
);

resourceRequest.setHeader(
    "Accept",
    "application/json"
);

System.log(
    "Looking up VCF Operations target resource..."
);

var resourceResponse =
    resourceRequest.execute();

System.log(
    "Resource lookup HTTP status: " +
    resourceResponse.statusCode
);

if (resourceResponse.statusCode != 200) {

    System.error(
        resourceResponse.contentAsString
    );

    throw "VCF Operations resource lookup returned HTTP " +
        resourceResponse.statusCode;
}

var resourceData =
    JSON.parse(resourceResponse.contentAsString);

if (
    !resourceData.resourceList ||
    resourceData.resourceList.length === 0
) {
    throw "No matching VCF Operations resources found";
}

var matchedResource = null;

for (
    var i = 0;
    i < resourceData.resourceList.length;
    i++
) {

    var candidate =
        resourceData.resourceList[i];

    if (
        candidate.resourceKey &&
        candidate.resourceKey.name ==
            vCenterName &&
        candidate.resourceKey.adapterKindKey ==
            "VMWARE" &&
        candidate.resourceKey.resourceKindKey ==
            "VMwareAdapter Instance"
    ) {
        matchedResource = candidate;
        break;
    }
}

if (matchedResource == null) {
    throw "Target vCenter resource was not found: " + vCenterName;
}

var opsResourceId =
    String(matchedResource.identifier);

System.log(
    "Matched resource ID: " +
    opsResourceId
);


// ------------------------------------------------------------
// STEP 5 - Build deterministic goldRush event marker
// ------------------------------------------------------------

var eventMarker =
    "GOLDRUSH_BUILD_" + eventStage;


// ------------------------------------------------------------
// STEP 6 - Normalize optional values
// ------------------------------------------------------------

var safeRunStatus =
    runStatus == null ? "" : String(runStatus);

var safeRunConclusion =
    runConclusion == null ? "" : String(runConclusion);

var safeRunUrl =
    runUrl == null ? "" : String(runUrl);

var safeRunId =
    runId == null ? "" : String(runId);

var safeRunNumber =
    runNumber == null ? "" : String(runNumber);


// ------------------------------------------------------------
// STEP 7 - Build message
// ------------------------------------------------------------

var message =
    eventMarker + "\n" +
    "Image: " + imageName + "\n" +
    "Run Number: " + safeRunNumber + "\n" +
    "Run ID: " + safeRunId + "\n" +
    "Status: " + safeRunStatus + "\n" +
    "Conclusion: " + safeRunConclusion + "\n" +
    "Source Library: " + sourceLibrary + "\n" +
    "Subscriber Library: " + subscribedLibrary + "\n" +
    "GitHub URL: " + safeRunUrl;


// ------------------------------------------------------------
// STEP 8 - Build event payload
// ------------------------------------------------------------

var eventPayload = {
    eventType: "NOTIFICATION",
    resourceId: opsResourceId,
    startTimeUTC: new Date().getTime(),
    message: message,
    severity: "INFORMATION",
    managedExternally: true
};

var eventBody =
    JSON.stringify(eventPayload);


// ------------------------------------------------------------
// STEP 9 - Post event
// ------------------------------------------------------------

var eventRequest =
    eventOperation.createRequest([], eventBody);

eventRequest.setHeader(
    "Authorization",
    "OpsToken " + localOpsToken
);

eventRequest.setHeader(
    "Accept",
    "application/json"
);

eventRequest.setHeader(
    "Content-Type",
    "application/json"
);

System.log(
    "Posting VCF Operations event: " +
    eventMarker
);

var eventResponse =
    eventRequest.execute();

System.log(
    "Event HTTP status: " +
    eventResponse.statusCode
);

if (
    eventResponse.statusCode != 200 &&
    eventResponse.statusCode != 201
) {

    System.error(
        eventResponse.contentAsString
    );

    throw "VCF Operations event request returned HTTP " +
        eventResponse.statusCode;
}

System.log(
    "VCF Operations event posted successfully: " +
    eventMarker
);
