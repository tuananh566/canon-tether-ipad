/**
 * Canon CCAPI (Camera Control API) service.
 *
 * Provides typed wrappers around every CCAPI REST endpoint
 * the tether app needs.
 */

import {
  DeviceInformation,
  DirectoryListResponse,
  EventPollingResponse,
  StorageListResponse,
} from '../types/ccapi';

const CCAPI_VERSION = 'ver100';
const DEFAULT_PORT = '8080';
const REQUEST_TIMEOUT_MS = 10_000;
const LONG_POLL_TIMEOUT_MS = 65_000; // event/polling can block up to 60 s

// ── Helpers ─────────────────────────────────────────────────────────

function buildBaseUrl(ip: string, port: string = DEFAULT_PORT): string {
  return `http://${ip}:${port}/ccapi/${CCAPI_VERSION}`;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ──────────────────────────────────────────────────────

export class CcapiService {
  private baseUrl: string;

  constructor(
    public ip: string,
    public port: string = DEFAULT_PORT,
  ) {
    this.baseUrl = buildBaseUrl(ip, port);
  }

  /** Update connection parameters. */
  setConnection(ip: string, port: string = DEFAULT_PORT): void {
    this.ip = ip;
    this.port = port;
    this.baseUrl = buildBaseUrl(ip, port);
  }

  // ── Device ──────────────────────────────────────────────────────

  async getDeviceInfo(): Promise<DeviceInformation> {
    const res = await fetchWithTimeout(`${this.baseUrl}/deviceinformation`);
    if (!res.ok) throw new Error(`Device info request failed: ${res.status}`);
    return res.json();
  }

  /** Quick connectivity check. Resolves true when the camera answers. */
  async ping(): Promise<boolean> {
    try {
      await this.getDeviceInfo();
      return true;
    } catch {
      return false;
    }
  }

  // ── Storage ─────────────────────────────────────────────────────

  async getStorageList(): Promise<string[]> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/devicestatus/storage`,
    );
    if (!res.ok) throw new Error(`Storage list request failed: ${res.status}`);
    const data: StorageListResponse = await res.json();
    return data.storagelist ?? [];
  }

  // ── Contents / Directory Browsing ─────────────────────────────

  /**
   * List entries in a directory.
   * `path` is relative, e.g. `"sd/DCIM/100CANON"`.
   */
  async listDirectory(path: string): Promise<string[]> {
    const url = `${this.baseUrl}/contents/${path}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Directory listing failed (${path}): ${res.status}`);
    const data: DirectoryListResponse = await res.json();
    return data.contentlist ?? [];
  }

  /**
   * Return the URL that can be used to download / fetch a file directly.
   * Handles full URL, absolute path with /ccapi/, or relative path.
   * Supports kind: 'main' (full resolution 26MP) or 'display' (embedded fast preview JPEG).
   */
  getContentUrl(pathOrUrl: string, kind?: 'main' | 'display' | 'thumbnail'): string {
    let url = pathOrUrl;
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      url = pathOrUrl;
    } else if (pathOrUrl.startsWith('/ccapi/')) {
      url = `http://${this.ip}:${this.port}${pathOrUrl}`;
    } else {
      const cleanPath = pathOrUrl.replace(/^\/?(contents\/)?/, '');
      url = `${this.baseUrl}/contents/${cleanPath}`;
    }

    if (kind && kind !== 'main' && !url.includes('kind=')) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}kind=${kind}`;
    }
    return url;
  }

  /**
   * Download raw bytes of a content item.
   * Returns the Response so the caller can stream it to disk.
   */
  async downloadContent(path: string): Promise<Response> {
    const url = this.getContentUrl(path);
    const res = await fetchWithTimeout(url, 120_000); // large files
    if (!res.ok) throw new Error(`Download failed (${path}): ${res.status}`);
    return res;
  }

  // ── Event Polling ─────────────────────────────────────────────

  /**
   * Long-poll for camera events.
   *
   * The camera keeps the connection open for up to ~60 s, then returns
   * an empty body if nothing happened.  When new content is written to
   * the card the response includes an `addedcontents` array with the
   * full CCAPI paths.
   */
  async pollEvents(abortSignal?: AbortSignal): Promise<EventPollingResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LONG_POLL_TIMEOUT_MS);

    // Forward external abort to our internal controller.
    const onExternalAbort = () => controller.abort();
    abortSignal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(`${this.baseUrl}/event/polling`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Event polling failed: ${res.status}`);

      const text = await res.text();
      if (!text || text.trim().length === 0) {
        return {};
      }
      return JSON.parse(text) as EventPollingResponse;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Timeout or deliberate cancellation – not an error.
        return {};
      }
      throw err;
    } finally {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // ── Convenience ───────────────────────────────────────────────

  /**
   * Walk all DCIM sub-directories on the first storage and return
   * every content path, sorted newest-first.
   */
  async listAllPhotos(): Promise<string[]> {
    const storages = await this.getStorageList();
    if (storages.length === 0) return [];

    // storages[0] is something like "/ccapi/ver100/contents/sd"
    const storagePath = storages[0].replace(`/ccapi/${CCAPI_VERSION}/contents/`, '');

    const dcimPath = `${storagePath}/DCIM`;
    let folders: string[];
    try {
      folders = await this.listDirectory(dcimPath);
    } catch {
      return [];
    }

    const allFiles: string[] = [];
    for (const folderUrl of folders) {
      const folderRelative = folderUrl.replace(`/ccapi/${CCAPI_VERSION}/contents/`, '');
      try {
        const files = await this.listDirectory(folderRelative);
        for (const f of files) {
          allFiles.push(f.replace(`/ccapi/${CCAPI_VERSION}/contents/`, ''));
        }
      } catch {
        // skip inaccessible folders
      }
    }

    return allFiles.reverse();
  }
}

/** Singleton – consumers can import and reconfigure. */
export const ccapi = new CcapiService('192.168.1.2');
