import urlJoin = require("url-join");
import * as path from "path";
import * as fs from "./fileSystem";
import { downloadTarball, extractTarball } from "./tarballUtils";
import * as semVer from "semver";
import * as httpUtils from "./httpUtils";
import { PackageInfo } from "./PackageInfo";
import Debug from "debug";
const debug = Debug("live-plugin-manager.NpmRegistryClient");

export class NpmRegistryClient {
	defaultHeaders: httpUtils.Headers;
	scopes?: Record<string, NpmRegistryScope>;
	defaultScope: NpmRegistryScope;
	constructor(npmUrl: string, config: NpmRegistryConfig) {
		this.defaultHeaders = {
			// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md
			"accept-encoding": "gzip",
			"accept": "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
			"user-agent": config.userAgent || "live-plugin-manager"
		};

		this.defaultScope = {
			registry: npmUrl,
			auth: config.auth
		}
		this.scopes = config.scopes;
	}

	async get(name: string, versionOrTag: string | null = "latest"): Promise<PackageInfo> {
		debug(`Getting npm info for ${name}:${versionOrTag}...`);

		if (typeof versionOrTag !== "string") {
			versionOrTag = "";
		}
		if (typeof name !== "string") {
			throw new Error("Invalid package name");
		}

		const data = await this.getNpmData(name);
		versionOrTag = versionOrTag.trim();

		// check if there is a tag (es. latest)
		const distTags = data["dist-tags"];
		let version = distTags && distTags[versionOrTag];

		if (!version) {
			version = semVer.clean(versionOrTag) || versionOrTag;
		}

		// find correct version
		let pInfo = data.versions[version];
		if (!pInfo) {
			// find compatible version
			for (const pVersion in data.versions) {
				if (!data.versions.hasOwnProperty(pVersion)) {
					continue;
				}
				const pVersionInfo = data.versions[pVersion];

				if (!semVer.satisfies(pVersionInfo.version, version)) {
					continue;
				}

				if (!pInfo || semVer.gt(pVersionInfo.version, pInfo.version)) {
					pInfo = pVersionInfo;
				}
			}
		}

		if (!pInfo) {
			throw new Error(`Version '${versionOrTag} not found`);
		}

		return {
			dist: pInfo.dist,
			name: pInfo.name,
			version: pInfo.version
		};
	}

	async download(
		destinationDirectory: string,
		packageInfo: PackageInfo): Promise<string> {

		if (!packageInfo.dist || !packageInfo.dist.tarball) {
			throw new Error("Invalid dist.tarball property");
		}

		const npmConfig = this.getNpmConfig(packageInfo.name);
		const headers = { ...this.defaultHeaders, ...createAuthHeader(npmConfig.auth) }
		const tgzFile = await downloadTarball(packageInfo.dist.tarball, headers);

		const pluginDirectory = path.join(destinationDirectory, packageInfo.name);
		try {
			await extractTarball(tgzFile, pluginDirectory);
		} finally {
			await fs.remove(tgzFile);
		}

		return pluginDirectory;
	}

  private getNpmConfig(name: string): NpmRegistryScope {
		const nameParts: string[] = name.split('/');
		let npmConfig: NpmRegistryScope = this.defaultScope;

		// Scoped packages will contain /'s so they will have multiple parts
		if (nameParts.length > 1) {
			// Pop off the package name to get the scope
			nameParts.pop();

			// Put together the remaining scope parts (in case of nested scopes)
			const scope: string = nameParts.join("/");

			// Only try to lookup the scope if any are configured.
			if (this.scopes && scope in this.scopes) {
				npmConfig = this.scopes[scope];
			}
		}

		return npmConfig;
	}

	private async getNpmData(name: string): Promise<NpmData> {
		const npmConfig = this.getNpmConfig(name);
		const regUrl = urlJoin(npmConfig.registry, encodeNpmName(name));
		const headers = { ...this.defaultHeaders, ...createAuthHeader(npmConfig.auth) };
		try {
			const result = await httpUtils.httpJsonGet<NpmData>(regUrl, headers);
			if (!result) {
				throw new Error("Response is empty");
			}
			if (!result.versions || !result.name) {
				throw new Error("Invalid json format");
			}

			return result;
		} catch (err: any) {
			if (err.message) {
				err.message = `Failed to get package '${name}' ${err.message}`;
			}
			throw err;
		}
	}
}

// example: https://registry.npmjs.org/lodash/
// or https://registry.npmjs.org/@types%2Fnode (for scoped)
interface NpmData {
	name: string;
	"dist-tags"?: {
		// "latest": "1.0.0";
		[tag: string]: string;
	};
	versions: {
		[version: string]: {
			dist: {
				tarball: string;
			},
			name: string,
			version: string
		}
	};
}

function encodeNpmName(name: string) {
	return name.replace("/", "%2F");
}

export interface NpmRegistryConfig {
	// actually this is used in the params
	auth?: NpmRegistryAuthToken | NpmRegistryAuthBasic;

	userAgent?: string;

	scopes?: Record<string, NpmRegistryScope>;
}

export interface NpmRegistryScope {
	registry: string;
	auth?: NpmRegistryAuthToken | NpmRegistryAuthBasic;
}

export interface NpmRegistryAuthToken {
	token: string;
	header: string;
}

export interface NpmRegistryAuthBasic {
	username: string;
	password: string;
}

function createAuthHeader(auth?: NpmRegistryAuthToken | NpmRegistryAuthBasic): httpUtils.Headers {
	if (!auth) {
		return {};
	}

	if (isTokenAuth(auth)) {
		return httpUtils.headersBearerAuth(auth.token, auth.header); // this should be a JWT I think...
	} else if (isBasicAuth(auth)) {
		return httpUtils.headersBasicAuth(auth.username, auth.password);
	} else {
		return {};
	}
}

function isTokenAuth(arg: NpmRegistryAuthToken | NpmRegistryAuthBasic): arg is NpmRegistryAuthToken {
	return (arg as NpmRegistryAuthToken).token !== undefined;
}

function isBasicAuth(arg: NpmRegistryAuthToken | NpmRegistryAuthBasic): arg is NpmRegistryAuthBasic {
	return (arg as NpmRegistryAuthBasic).username !== undefined;
}
