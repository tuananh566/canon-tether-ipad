/**
 * Photo downloader service.
 *
 * Downloads an image from the Canon camera via CCAPI, saves it to
 * the local file system, and then copies it into the iPad Photo Library
 * using expo-media-library.
 */

import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { DownloadedPhoto, PhotoExif } from '../types/ccapi';

export const DOWNLOAD_DIR = `${FileSystem.documentDirectory}canon-tether/`;

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
 * @param maxRetries  Number of retry attempts if camera is busy.
 * @param fastMode    If true, downloads the lightweight embedded display JPEG (~500KB) for 10x-20x faster Wi-Fi speed.
 * @returns           Metadata about the downloaded photo.
 */
export async function downloadAndSavePhoto(
  contentUrl: string,
  filename: string,
  maxRetries: number = 5,
  fastMode: boolean = true,
): Promise<DownloadedPhoto> {
  await ensureDirectory();

  // Unique local path to avoid collisions on burst shots.
  const uniqueName = `${Date.now()}_${filename}`;
  const localUri = `${DOWNLOAD_DIR}${uniqueName}`;

  // Chuẩn bị URL: nếu fastMode = true và URL chưa có tham số kind, dùng kind=display
  let targetUrl = contentUrl;
  if (fastMode && !targetUrl.includes('kind=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}kind=display`;
  }

  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Download to local file system.
      const downloadResult = await FileSystem.downloadAsync(targetUrl, localUri);
      lastStatus = downloadResult.status;

      if (downloadResult.status === 200) {
        break;
      }

      // Nếu camera không hỗ trợ kind=display (trả về 400/404), fallback về ảnh gốc full
      if ((downloadResult.status === 400 || downloadResult.status === 404) && targetUrl.includes('kind=display')) {
        targetUrl = contentUrl;
        continue;
      }
    } catch {
      /* retry */
    }

    // Clean up partial file.
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      /* ignore */
    }

    // HTTP 503 = Máy ảnh Canon đang bận ghi thẻ nhớ / xử lý ảnh burst
    if (lastStatus === 503 || lastStatus === 404) {
      if (attempt < maxRetries) {
        // Tăng dần thời gian chờ: 300ms, 550ms, 800ms...
        const waitMs = 300 + attempt * 250;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }

    if (attempt === maxRetries) {
      throw new Error(
        `Download failed for ${filename}: HTTP ${lastStatus}`,
      );
    }
  }

  if (lastStatus !== 200) {
    throw new Error(
      `Download failed for ${filename}: HTTP ${lastStatus} (Máy ảnh bận)`,
    );
  }

  // Save to the iPad Photo Library.
  let assetUri = localUri;
  let parsedExif: PhotoExif | undefined;
  let createdAssetId: string | undefined;
  try {
    const hasPermission = await requestMediaLibraryPermission();
    if (hasPermission) {
      const asset = await MediaLibrary.createAssetAsync(localUri);
      assetUri = asset.uri;
      createdAssetId = asset.id;

      // Trích xuất thông số Exif (Khẩu độ, Tốc độ, ISO, Tiêu cự)
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset, {
          shouldDownloadFromNetwork: false,
        });
        if (info && info.exif) {
          parsedExif = formatExif(info.exif);
        }
      } catch (exifErr) {
        console.warn('[PhotoDownloader] Could not read Exif:', exifErr);
      }
    }
  } catch (err) {
    console.warn('[PhotoDownloader] Could not save to Photo Library:', err);
    // The file is still in the app sandbox – not a fatal error.
  }

  const photo: DownloadedPhoto = {
    id: uniqueName,
    filename,
    localUri: assetUri,
    assetId: createdAssetId,
    timestamp: Date.now(),
    exif: parsedExif,
  };

  return photo;
}

/**
 * Xoá một bức ảnh khỏi cả bộ nhớ đệm app và Thư viện Ảnh của iPad.
 */
export async function deletePhotoEverywhere(photo: DownloadedPhoto): Promise<boolean> {
  let deletedFromLibrary = false;
  let deletedLocally = false;

  // 1. Xoá khỏi Thư viện Ảnh của iPad (MediaLibrary)
  try {
    const hasPermission = await requestMediaLibraryPermission();
    if (hasPermission) {
      let targetAssetId = photo.assetId;

      // Nếu chưa có assetId (ảnh tải từ phiên trước), tìm kiếm asset trong iPad Photos
      if (!targetAssetId) {
        try {
          const assets = await MediaLibrary.getAssetsAsync({
            first: 30,
            mediaType: ['photo'],
            sortBy: [MediaLibrary.SortBy.creationTime],
          });
          const match = assets.assets.find(
            (a) => a.filename === photo.filename || a.uri === photo.localUri,
          );
          if (match) {
            targetAssetId = match.id;
          }
        } catch (findErr) {
          console.warn('[Delete] Could not search asset in library:', findErr);
        }
      }

      if (targetAssetId) {
        // iOS sẽ hiện thông báo xác nhận xoá của hệ thống
        deletedFromLibrary = await MediaLibrary.deleteAssetsAsync([targetAssetId]);
      } else if (photo.localUri.startsWith('ph://')) {
        deletedFromLibrary = await MediaLibrary.deleteAssetsAsync([photo.localUri]);
      }
    }
  } catch (libErr) {
    console.warn('[Delete] Error deleting from iPad Photo Library:', libErr);
  }

  // 2. Xoá file lưu trữ cục bộ trong sandbox app
  try {
    const localFilePath = `${DOWNLOAD_DIR}${photo.id}`;
    const fileInfo = await FileSystem.getInfoAsync(localFilePath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(localFilePath, { idempotent: true });
      deletedLocally = true;
    } else if (photo.localUri.startsWith('file://')) {
      await FileSystem.deleteAsync(photo.localUri, { idempotent: true });
      deletedLocally = true;
    }
  } catch (fsErr) {
    console.warn('[Delete] Error deleting local file:', fsErr);
  }

  return deletedFromLibrary || deletedLocally;
}

/**
 * Trích xuất và định dạng các thông số chụp ảnh từ raw EXIF của camera
 */
export function formatExif(raw: any): PhotoExif | undefined {
  if (!raw) return undefined;
  const exif = raw['{Exif}'] || raw;

  let aperture: string | undefined;
  const fnum = exif.FNumber || raw.FNumber;
  if (fnum) {
    aperture = `f/${Number(fnum).toFixed(1).replace('.0', '')}`;
  }

  let shutterSpeed: string | undefined;
  const exp = exif.ExposureTime || raw.ExposureTime;
  if (exp) {
    const expNum = Number(exp);
    if (expNum < 1 && expNum > 0) {
      shutterSpeed = `1/${Math.round(1 / expNum)}s`;
    } else {
      shutterSpeed = `${expNum}s`;
    }
  }

  let iso: string | undefined;
  const rawIso = exif.ISOSpeedRatings || raw.ISOSpeedRatings || exif.ISO;
  if (rawIso) {
    const isoVal = Array.isArray(rawIso) ? rawIso[0] : rawIso;
    iso = `ISO ${isoVal}`;
  }

  let focalLength: string | undefined;
  const focal = exif.FocalLength || raw.FocalLength;
  if (focal) {
    focalLength = `${Math.round(Number(focal))}mm`;
  }

  let lens: string | undefined;
  const rawLens = exif.LensModel || raw.LensModel;
  if (rawLens) {
    lens = String(rawLens);
  }

  if (!aperture && !shutterSpeed && !iso) return undefined;

  return { aperture, shutterSpeed, iso, focalLength, lens };
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
