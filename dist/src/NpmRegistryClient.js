"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NpmRegistryClient = void 0;
const urlJoin = require("url-join");
const path = __importStar(require("path"));
const fs = __importStar(require("./fileSystem"));
const tarballUtils_1 = require("./tarballUtils");
const semVer = __importStar(require("semver"));
const httpUtils = __importStar(require("./httpUtils"));
const debug_1 = __importDefault(require("debug"));
const debug = (0, debug_1.default)("live-plugin-manager.NpmRegistryClient");
class NpmRegistryClient {
    constructor(npmUrl, config) {
        this.defaultHeaders = {
            // https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md
            "accept-encoding": "gzip",
            "accept": "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
            "user-agent": config.userAgent || "live-plugin-manager"
        };
        this.defaultScope = {
            registry: npmUrl,
            auth: config.auth
        };
        this.scopes = config.scopes;
    }
    get(name, versionOrTag = "latest") {
        return __awaiter(this, void 0, void 0, function* () {
            debug(`Getting npm info for ${name}:${versionOrTag}...`);
            if (typeof versionOrTag !== "string") {
                versionOrTag = "";
            }
            if (typeof name !== "string") {
                throw new Error("Invalid package name");
            }
            const data = yield this.getNpmData(name);
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
        });
    }
    download(destinationDirectory, packageInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!packageInfo.dist || !packageInfo.dist.tarball) {
                throw new Error("Invalid dist.tarball property");
            }
            const npmConfig = this.getNpmConfig(packageInfo.name);
            const headers = Object.assign(Object.assign({}, this.defaultHeaders), createAuthHeader(npmConfig.auth));
            const tgzFile = yield (0, tarballUtils_1.downloadTarball)(packageInfo.dist.tarball, headers);
            const pluginDirectory = path.join(destinationDirectory, packageInfo.name);
            try {
                yield (0, tarballUtils_1.extractTarball)(tgzFile, pluginDirectory);
            }
            finally {
                yield fs.remove(tgzFile);
            }
            return pluginDirectory;
        });
    }
    getNpmConfig(name) {
        const nameParts = name.split('/');
        let npmConfig = this.defaultScope;
        // Scoped packages will contain /'s so they will have multiple parts
        if (nameParts.length > 1) {
            // Pop off the package name to get the scope
            nameParts.pop();
            // Put together the remaining scope parts (in case of nested scopes)
            const scope = nameParts.join("/");
            // Only try to lookup the scope if any are configured.
            if (this.scopes && scope in this.scopes) {
                npmConfig = this.scopes[scope];
            }
        }
        return npmConfig;
    }
    getNpmData(name) {
        return __awaiter(this, void 0, void 0, function* () {
            const npmConfig = this.getNpmConfig(name);
            const regUrl = urlJoin(npmConfig.registry, encodeNpmName(name));
            const headers = Object.assign(Object.assign({}, this.defaultHeaders), createAuthHeader(npmConfig.auth));
            try {
                const result = yield httpUtils.httpJsonGet(regUrl, headers);
                if (!result) {
                    throw new Error("Response is empty");
                }
                if (!result.versions || !result.name) {
                    throw new Error("Invalid json format");
                }
                return result;
            }
            catch (err) {
                if (err.message) {
                    err.message = `Failed to get package '${name}' ${err.message}`;
                }
                throw err;
            }
        });
    }
}
exports.NpmRegistryClient = NpmRegistryClient;
function encodeNpmName(name) {
    return name.replace("/", "%2F");
}
function createAuthHeader(auth) {
    if (!auth) {
        return {};
    }
    if (isTokenAuth(auth)) {
        return httpUtils.headersBearerAuth(auth.token, auth.header); // this should be a JWT I think...
    }
    else if (isBasicAuth(auth)) {
        return httpUtils.headersBasicAuth(auth.username, auth.password);
    }
    else {
        return {};
    }
}
function isTokenAuth(arg) {
    return arg.token !== undefined;
}
function isBasicAuth(arg) {
    return arg.username !== undefined;
}
//# sourceMappingURL=NpmRegistryClient.js.map