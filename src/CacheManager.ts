// @flow
import * as _ from "lodash";
import * as FileSystem from "expo-file-system";
import SHA1 from "crypto-js/sha1";

export interface DownloadOptions {
  md5?: boolean;
  headers?: { [name: string]: string };
}

const BASE_DIR = `${FileSystem.cacheDirectory}expo-image-cache/`;

export class CacheEntry {
  uri: string;

  options: DownloadOptions;

  constructor(uri: string, options: DownloadOptions) {
    this.uri = uri;
    this.options = options;
  }

  async getPath(): Promise<string | undefined> {
    const { uri, options } = this;
    const { path, exists, tmpPath } = await getCacheEntry(uri);
    if (exists) {
      return path;
    }
    const result = await FileSystem.createDownloadResumable(uri, tmpPath, options).downloadAsync();
    // If the image download failed, we don't cache anything
    if (result && result.status !== 200) {
      return undefined;
    }
    await FileSystem.moveAsync({ from: tmpPath, to: path });
    return path;
  }
}

export default class CacheManager {
  static entries: { [uri: string]: CacheEntry } = {};

  static get(uri: string, options: DownloadOptions): CacheEntry {
    if (!CacheManager.entries[uri]) {
      CacheManager.entries[uri] = new CacheEntry(uri, options);
    }
    return CacheManager.entries[uri];
  }

  static async clearCache(): Promise<void> {
    await FileSystem.deleteAsync(BASE_DIR, { idempotent: true });
    await FileSystem.makeDirectoryAsync(BASE_DIR);
  }

  static getMultiple(uriArray: Array<string>, options: DownloadOptions): Array<string> {
    let resultArray = new Array();

    uriArray.forEach(async (uri) => {
      if (!CacheManager.entries[uri]) {
        CacheManager.entries[uri] = new CacheEntry(uri, options);
      }
      resultArray.push(CacheManager.entries[uri]);
    });
    return resultArray;
  }

  static async clearCacheBefore(days: number): Promise<void> {
    const daysInSeconds = days * 24 * 60 * 60;
    const currentDay = new Date().getTime() / 1000;
    const files = await FileSystem.readDirectoryAsync(BASE_DIR);
    files.forEach(async (file) => {
      const path = `${BASE_DIR}${file}`;
      const { modificationTime } = await FileSystem.getInfoAsync(path);
      if (modificationTime && modificationTime + daysInSeconds < currentDay) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    });
  }

  static async getCacheSize(): Promise<number> {
    const result = await FileSystem.getInfoAsync(BASE_DIR);
    if (!result.exists) {
      throw new Error(`${BASE_DIR} not found`);
    }
    return result.size;
  }
}

const getCacheEntry = async (uri: string): Promise<{ exists: boolean; path: string; tmpPath: string }> => {
  const filename = uri.substring(uri.lastIndexOf("/"), uri.indexOf("?") === -1 ? uri.length : uri.indexOf("?"));
  const ext = filename.indexOf(".") === -1 ? ".jpg" : filename.substring(filename.lastIndexOf("."));
  const path = `${BASE_DIR}${SHA1(uri)}${ext}`;
  const tmpPath = `${BASE_DIR}${SHA1(uri)}-${_.uniqueId()}${ext}`;
  // TODO: maybe we don't have to do this every time
  try {
    await FileSystem.makeDirectoryAsync(BASE_DIR);
  } catch (e) {
    // do nothing
  }
  const info = await FileSystem.getInfoAsync(path);
  const { exists } = info;
  return { exists, path, tmpPath };
};
