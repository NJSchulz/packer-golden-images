if (runStatus == "timed_out") {
    errorMessage =
        "goldRush build timed out after " + timeoutMinutes + " minutes; " +
        "GitHub run " + runId + " cancel requested (HTTP " + cancelHttpStatus + "). " +
        "Run number: " + runNumber +
        ", Conclusion: " + runConclusion +
        ", URL: " + runUrl;
} else {
    errorMessage =
        "goldRush Oracle Linux 9 Golden Image Build failed. " +
        "Run ID: " + runId +
        ", Run number: " + runNumber +
        ", Conclusion: " + runConclusion +
        ", URL: " + runUrl;
}

System.error(errorMessage);
