import * as httpUtils from "./httpUtils";
import { PackageInfo } from "./PackageInfo";
export declare class NpmRegistryClient {
    defaultHeaders: httpUtils.Headers;
    scopes?: Record<string, NpmRegistryScope>;
    defaultScope: NpmRegistryScope;
    constructor(npmUrl: string, config: NpmRegistryConfig);
    get(name: string, versionOrTag?: string | null): Promise<PackageInfo>;
    download(destinationDirectory: string, packageInfo: PackageInfo): Promise<string>;
    private getNpmConfig;
    private getNpmData;
}
export interface NpmRegistryConfig {
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
