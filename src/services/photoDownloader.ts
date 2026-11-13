/**
 * Photo downloader service.
 *
 * Downloads an image from the Canon camera via CCAPI, saves it to
 * the local file system, and then copies it into the iPad Photo Library
 * using expo-media-library.
 */

import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { DownloadedPhoto } from '../types/ccapi';

const DOWNLOAD_DIR = `${FileSystem.documentDirectory}canon-tether/`;

/** Ensure the local download directory exists. */
async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
  }
}

/**
 * Request the media-library write permission.
 * Returns `true` when the user has granted access.
 */
export async function requestMediaLibraryPermission(): Promise<boolean> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Download a single photo from the camera and save it to the Photo Library.
 *
 * @param contentUrl  The full CCAPI URL to the image file.
 * @param filename    The original filename, e.g. `"IMG_0001.JPG"`.
 * @returns           Metadata about the downloaded photo.
 */
export async function downloadAndSavePhoto(
  contentUrl: string,
  filename: string,
): Promise<DownloadedPhoto> {
  await ensureDirectory();

  // Unique local path to avoid collisions on burst shots.
  const uniqueName = `${Date.now()}_${filename}`;
  const localUri = `${DOWNLOAD_DIR}${uniqueName}`;

  // Download to local file system.
  const downloadResult = await FileSystem.downloadAsync(contentUrl, localUri);
  if (downloadResult.status !== 200) {
    // Clean up partial file.
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    throw new Error(
      `Download failed for ${filename}: HTTP ${downloadResult.status}`,
    );
  }

  // Save to the iPad Photo Library.
  let assetUri = localUri;
  try {
    const hasPermission = await requestMediaLibraryPermission();
    if (hasPermission) {
      const asset = await MediaLibrary.createAssetAsync(localUri);
      assetUri = asset.uri;
    }
  } catch (err) {
    console.warn('[PhotoDownloader] Could not save to Photo Library:', err);
    // The file is still in the app sandbox – not a fatal error.
  }

  const photo: DownloadedPhoto = {
    id: uniqueName,
    filename,
    localUri: assetUri,
    timestamp: Date.now(),
  };

  return photo;
}

/**
 * Extract the filename from a CCAPI content path.
 * e.g. `"sd/DCIM/100CANON/IMG_0001.JPG"` → `"IMG_0001.JPG"`
 */
export function filenameFromPath(ccapiPath: string): string {
  const segments = ccapiPath.split('/');
  return segments[segments.length - 1] ?? ccapiPath;
}

/**
 * Determine whether a CCAPI path points to a JPEG (the format we
 * auto-download by default).  CR3 / CR2 raw files are skipped unless
 * the user explicitly enables raw download later.
 */
export function isJpeg(ccapiPath: string): boolean {
  const lower = ccapiPath.toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

/**
 * Purge local cached downloads (does NOT remove from the Photo Library).
 */
export async function clearLocalCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(DOWNLOAD_DIR, { idempotent: true });
  } catch {
    /* ignore */
  }
}
