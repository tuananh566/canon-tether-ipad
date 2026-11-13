/**
 * TypeScript types for Canon CCAPI (Camera Control API) responses.
 */

// ── Device Information ──────────────────────────────────────────────

export interface DeviceInformation {
  manufacturer: string;
  productname: string;
  guid: string;
  serialnumber: string;
  macaddress: string;
  firmwareversion: string;
}

// ── Storage ─────────────────────────────────────────────────────────

export interface StorageInfo {
  name: string;
  path: string;
  maxsize?: number;
  spacesize?: number;
  contentsnumber?: number;
}

export interface StorageListResponse {
  storagelist: string[];
}

export interface StorageStatusResponse {
  name: string;
  path: string;
  accesscapability: string;
  maxsize: number;
  spacesize: number;
  contentsnumber: number;
}

// ── Contents / Directory Browsing ───────────────────────────────────

export interface DirectoryContent {
  name: string;
  path: string;
}

export interface DirectoryListResponse {
  path: string;
  contentlist?: string[];
}

export interface FileInfo {
  name: string;
  url: string;
}

// ── Event Polling ───────────────────────────────────────────────────

export interface EventPollingResponse {
  addedcontents?: string[];
  updatedcontents?: string[];
  removedcontents?: string[];
}

// ── Connection State ────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CameraConnectionState {
  status: ConnectionStatus;
  cameraIp: string;
  cameraPort: string;
  deviceInfo: DeviceInformation | null;
  errorMessage: string | null;
}

// ── Downloaded Photo ────────────────────────────────────────────────

export interface PhotoExif {
  aperture?: string;     // e.g. "f/2.8"
  shutterSpeed?: string; // e.g. "1/160s"
  iso?: string;          // e.g. "ISO 6400"
  focalLength?: string;  // e.g. "24mm"
  lens?: string;         // e.g. "RF24-105mm F4-7.1 IS STM"
}

export interface DownloadedPhoto {
  id: string;
  filename: string;
  localUri: string;
  assetId?: string;
  timestamp: number;
  width?: number;
  height?: number;
  exif?: PhotoExif;
  isFastPreview?: boolean;
  isOriginal?: boolean;
  contentUrl?: string;
}

// ── Poller State ────────────────────────────────────────────────────

export type PollerStatus = 'idle' | 'polling' | 'paused' | 'error';

export interface PollerState {
  status: PollerStatus;
  lastPollTime: number | null;
  errorCount: number;
  totalEventsReceived: number;
}
