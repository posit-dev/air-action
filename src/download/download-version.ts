import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { OWNER, REPO, TOOL_CACHE_NAME } from "../utils/constants";
import type { Architecture, Platform } from "../utils/platforms";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";

const PaginatingOctokit = Octokit.plugin(paginateRest, restEndpointMethods);

export function tryGetFromToolCache(
  arch: Architecture,
  version: string,
): { version: string; installedPath: string | undefined } {
  core.debug(`Trying to get Air from tool cache for ${version}...`);
  const cachedVersions = tc.findAllVersions(TOOL_CACHE_NAME, arch);
  core.debug(`Cached versions: ${cachedVersions}`);
  let resolvedVersion = tc.evaluateVersions(cachedVersions, version);
  if (resolvedVersion === "") {
    resolvedVersion = version;
  }
  const installedPath = tc.find(TOOL_CACHE_NAME, resolvedVersion, arch);
  return { version: resolvedVersion, installedPath };
}

export async function downloadVersion(
  platform: Platform,
  arch: Architecture,
  version: string,
  githubToken: string,
): Promise<{ version: string; cachedToolDir: string }> {
  const artifact = `air-${arch}-${platform}`;
  const extension = platform === "pc-windows-msvc" ? ".zip" : ".tar.gz";
  const downloadUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${version}/${artifact}${extension}`;
  core.info(`Downloading Air from "${downloadUrl}" ...`);

  const downloadPath = await tc.downloadTool(
    downloadUrl,
    undefined,
    githubToken,
  );

  let airDir: string;
  if (platform === "pc-windows-msvc") {
    const fullPathWithExtension = `${downloadPath}${extension}`;
    await fs.copyFile(downloadPath, fullPathWithExtension);
    airDir = await tc.extractZip(fullPathWithExtension);
    // On windows extracting the zip does not create an intermediate directory
  } else {
    const extractedDir = await tc.extractTar(downloadPath);
    airDir = path.join(extractedDir, artifact);
  }

  const cachedToolDir = await tc.cacheDir(
    airDir,
    TOOL_CACHE_NAME,
    version,
    arch,
  );

  return { version: version, cachedToolDir };
}

export async function resolveVersion(
  versionInput: string,
  githubToken: string,
): Promise<string> {
  core.debug(`Resolving ${versionInput}...`);
  const version =
    versionInput === "latest"
      ? await getLatestVersion(githubToken)
      : versionInput;
  if (tc.isExplicitVersion(version)) {
    core.debug(`Version ${version} is an explicit version.`);
    return version;
  }
  const availableVersions = await getAvailableVersions(githubToken);
  const resolvedVersion = tc.evaluateVersions(availableVersions, version);
  if (resolvedVersion === "") {
    throw new Error(`No version found for ${version}`);
  }
  core.debug(`Resolved version: ${resolvedVersion}`);
  return resolvedVersion;
}

async function getAvailableVersions(githubToken: string): Promise<string[]> {
  const octokit = new PaginatingOctokit({
    auth: githubToken,
  });

  const response = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner: OWNER,
    repo: REPO,
  });

  return response.map((release) => release.tag_name);
}

async function getLatestVersion(githubToken: string) {
  const octokit = new PaginatingOctokit({
    auth: githubToken,
  });

  const { data: latestRelease } = await octokit.rest.repos.getLatestRelease({
    owner: OWNER,
    repo: REPO,
  });

  return latestRelease.tag_name;
}
