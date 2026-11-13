/**
 * Main tether screen — Studio Pro Layout with Side-by-Side Comparison.
 *
 * Layout:
 *  • Top bar: Back, Camera Name, Compare Toggle (⚖️), Gallery shortcut & Settings button (⚙️)
 *  • Center Stage (flex: 1):
 *      - Single View: Immersive Large Photo Preview with metadata overlay
 *      - Compare Mode: 50/50 Side-by-Side comparison of Photo A vs Photo B with Swap (⇄)
 *  • Bottom Bar: Horizontal thumbnails filmstrip with A/B badges
 *  • Settings Modal: Connection details, Event polling, Auto-download toggle & Reconnect
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Alert,
  Modal,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCameraConnection } from '../src/hooks/useCameraConnection';
import { useEventPoller } from '../src/hooks/useEventPoller';
import { ccapi } from '../src/services/ccapi';
import {
  downloadAndSavePhoto,
  filenameFromPath,
  isJpeg,
  requestMediaLibraryPermission,
  clearLocalCache,
  DOWNLOAD_DIR,
} from '../src/services/photoDownloader';
import { DownloadedPhoto, PhotoExif } from '../src/types/ccapi';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../src/constants/theme';

export default function TetherScreen() {
  const router = useRouter();
  const {
    status: connStatus,
    cameraIp,
    cameraPort,
    deviceInfo,
    errorMessage,
    connect,
    disconnect,
  } = useCameraConnection();

  const [autoDownload, setAutoDownload] = useState(true);
  const [photos, setPhotos] = useState<DownloadedPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<DownloadedPhoto | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [fastMode, setFastMode] = useState(true); // Tải ảnh xem nhanh tối ưu hiển thị (~0.5s)

  // ── Tính năng So sánh 2 ảnh (Side-by-Side Compare) ─────────────
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [comparePhotoA, setComparePhotoA] = useState<DownloadedPhoto | null>(null);
  const [comparePhotoB, setComparePhotoB] = useState<DownloadedPhoto | null>(null);
  const [activeCompareSlot, setActiveCompareSlot] = useState<'A' | 'B'>('A');
  const [isLockB, setIsLockB] = useState(true); // Khóa hiển thị 1 ảnh duy nhất ở Khung B

  // Track processed URLs to avoid double-downloads.
  const processedUrls = useRef(new Set<string>());
  // Queue tải ảnh tuần tự tránh nghẽn chip Wi-Fi máy ảnh khi chụp liên tục
  const downloadQueue = useRef<string[]>([]);
  const isDownloadingRef = useRef(false);

  // ── Đồng bộ & Tải tất cả ảnh đã chụp từ thư mục máy về danh sách ──
  const loadSavedPhotos = useCallback(async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(DOWNLOAD_DIR);
      const imageFiles = files.filter((f) => {
        const lower = f.toLowerCase();
        return (
          lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.png') ||
          lower.endsWith('.heic')
        );
      });

      const loaded: DownloadedPhoto[] = imageFiles
        .map((name) => {
          const parts = name.split('_');
          let ts = 0;
          let cleanName = name;
          if (parts.length >= 2 && !isNaN(Number(parts[0]))) {
            ts = Number(parts[0]);
            cleanName = parts.slice(1).join('_');
          }

          // Đánh dấu để không tải lại khi camera gửi event
          processedUrls.current.add(cleanName);
          processedUrls.current.add(name);

          return {
            id: name,
            filename: cleanName,
            localUri: `${DOWNLOAD_DIR}${name}`,
            timestamp: ts || Date.now(),
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp); // Ảnh mới nhất lên đầu

      if (loaded.length > 0) {
        setPhotos((prev) => {
          // Gộp các ảnh mới chụp trong phiên với ảnh đã có trong thư viện
          const map = new Map<string, DownloadedPhoto>();
          for (const p of loaded) map.set(p.filename, p);
          for (const p of prev) map.set(p.filename, p); // Ưu tiên ảnh session vì có thể đã parse Exif
          return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
        });

        setSelectedPhoto((curr) => curr ?? loaded[0]);
      }
    } catch (err) {
      console.error('[Tether] loadSavedPhotos error:', err);
    }
  }, []);

  // ── Auto-connect & load saved photos on mount ───────────────────

  useEffect(() => {
    loadSavedPhotos();
  }, [loadSavedPhotos]);

  // ── Auto-connect on mount ───────────────────────────────────────

  useEffect(() => {
    if (cameraIp && connStatus === 'disconnected') {
      connect(cameraIp, cameraPort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraIp]);

  // ── Request media permission early ──────────────────────────────

  useEffect(() => {
    requestMediaLibraryPermission();
  }, []);

  // ── Queue processor: Xử lý tuần tự từng ảnh ─────────────────────

  const processQueue = useCallback(async () => {
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setDownloading(true);

    while (downloadQueue.current.length > 0) {
      const rawUrl = downloadQueue.current.shift()!;
      setQueueCount(downloadQueue.current.length);

      const filename = filenameFromPath(rawUrl);
      const contentUrl = ccapi.getContentUrl(rawUrl);

      // Thử tải với cơ chế retry (nếu máy ảnh đang bận ghi thẻ SD khi chụp burst)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const photo = await downloadAndSavePhoto(contentUrl, filename, 5, fastMode);
          setPhotos((prev) => [photo, ...prev]);
          setSelectedPhoto(photo); // Tự động hiển thị ảnh mới nhất vừa chụp

          // Nếu đang ở chế độ so sánh: Mỗi bức ảnh mới chụp sẽ tự động xuất hiện ở Ảnh A
          if (isCompareMode) {
            setComparePhotoA(photo);
          }

          processedUrls.current.add(rawUrl);
          setLastError(null);
          break;
        } catch (err: unknown) {
          if (attempt < 2) {
            // Chờ 350ms cho chip máy ảnh hoàn tất ghi thẻ nhớ
            await new Promise((r) => setTimeout(r, 350));
          } else {
            const msg = err instanceof Error ? err.message : 'Tải ảnh thất bại';
            setLastError(`Lỗi ${filename}: ${msg}`);
            console.error('[Tether] download error:', err);
          }
        }
      }

      // Nghỉ nhẹ 100ms giữa các ảnh liên tiếp để giảm tải bộ nhớ đệm của Canon RP
      if (downloadQueue.current.length > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    isDownloadingRef.current = false;
    setDownloading(false);
    setQueueCount(0);
  }, [isCompareMode, fastMode]);

  // ── New-content handler ─────────────────────────────────────────

  const handleNewContent = useCallback(
    (urls: string[]) => {
      if (!autoDownload) return;

      let hasNew = false;
      for (const rawUrl of urls) {
        const filename = filenameFromPath(rawUrl);

        // Bỏ qua nếu không phải JPEG hoặc đã tải rồi
        if (!isJpeg(filename)) continue;
        if (processedUrls.current.has(rawUrl)) continue;
        if (downloadQueue.current.includes(rawUrl)) continue;

        downloadQueue.current.push(rawUrl);
        hasNew = true;
      }

      if (hasNew) {
        setQueueCount(downloadQueue.current.length);
        processQueue();
      }
    },
    [autoDownload, processQueue],
  );

  // ── Event poller ────────────────────────────────────────────────

  const { pollerStatus } = useEventPoller(
    connStatus === 'connected',
    handleNewContent,
  );

  // ── Derived state ───────────────────────────────────────────────

  const isConnected = connStatus === 'connected';
  const displayPhoto = selectedPhoto ?? photos[0] ?? null;

  // ── Compare Mode Handlers ───────────────────────────────────────

  const toggleCompareMode = () => {
    if (!isCompareMode) {
      setIsCompareMode(true);
      // Ảnh A là ảnh mới nhất (mỗi lần chụp mới sẽ xuất hiện ở đây)
      setComparePhotoA(selectedPhoto ?? photos[0] ?? null);
      // Ảnh B là ảnh mẫu tham chiếu cố định
      if (!comparePhotoB) {
        setComparePhotoB(photos[1] ?? photos[0] ?? null);
      }
      setIsLockB(true); // Mặc định khóa hiển thị cố định ở Ảnh B
      setActiveCompareSlot('A');
    } else {
      setIsCompareMode(false);
    }
  };

  const swapComparePhotos = () => {
    const temp = comparePhotoA;
    setComparePhotoA(comparePhotoB);
    setComparePhotoB(temp);
  };

  // ── Chọn ảnh tham chiếu từ iPad (không qua máy ảnh) ──────────────
  const handlePickExternalImage = async (targetSlot?: 'A' | 'B') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Quyền truy cập',
          'Vui lòng cấp quyền truy cập Ảnh trong Cài đặt iPad để chọn ảnh tham chiếu.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const name = asset.fileName || `Tham chiếu iPad (${asset.width ?? ''}x${asset.height ?? ''})`;
        const externalPhoto: DownloadedPhoto = {
          id: `ref_${Date.now()}`,
          filename: name,
          localUri: asset.uri,
          timestamp: Date.now(),
          exif: {
            lens: 'Ảnh tham chiếu (iPad)',
          },
        };

        // Thêm vào danh sách để hiển thị ở filmstrip
        setPhotos((prev) => [externalPhoto, ...prev]);

        if (isCompareMode) {
          const slot = targetSlot || (isLockB ? 'B' : activeCompareSlot);
          if (slot === 'A') {
            setComparePhotoA(externalPhoto);
          } else {
            setComparePhotoB(externalPhoto);
            setIsLockB(true); // Tự động khóa Ảnh B vào bức tham chiếu này
          }
        } else {
          // Tự động mở chế độ so sánh với ảnh này đặt ở Khung B
          setIsCompareMode(true);
          setComparePhotoA(selectedPhoto ?? photos[0] ?? null);
          setComparePhotoB(externalPhoto);
          setIsLockB(true);
          setActiveCompareSlot('A');
        }
      }
    } catch (err) {
      console.error('[PickExternal] error:', err);
      Alert.alert('Lỗi', 'Không thể mở thư viện ảnh iPad.');
    }
  };

  // ── Manual reconnect ────────────────────────────────────────────

  const handleReconnect = () => {
    if (cameraIp) connect(cameraIp, cameraPort);
  };

  // ── Disconnect & go back ────────────────────────────────────────

  const handleDisconnect = () => {
    Alert.alert('Ngắt kết nối', 'Bạn có muốn ngắt kết nối máy ảnh?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Ngắt kết nối',
        style: 'destructive',
        onPress: () => {
          disconnect();
          router.back();
        },
      },
    ]);
  };

  // ── Xoá bộ nhớ đệm ảnh ──────────────────────────────────────────
  const handleClearCache = () => {
    Alert.alert(
      'Xoá bộ nhớ đệm',
      'Bạn có chắc chắn muốn xoá tất cả ảnh đã tải trong phiên này? (Ảnh đã lưu vào iPad Photos sẽ không bị ảnh hưởng)',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá tất cả',
          style: 'destructive',
          onPress: async () => {
            await clearLocalCache();
            setPhotos([]);
            setSelectedPhoto(null);
            setComparePhotoA(null);
            setComparePhotoB(null);
            processedUrls.current.clear();
            setIsGalleryOpen(false);
          },
        },
      ],
    );
  };

  // ── Render Exif Badge Helper ───────────────────────────────────

  const renderExifBadge = (exif?: PhotoExif) => {
    if (!exif) return null;
    const parts = [
      exif.iso,
      exif.aperture,
      exif.shutterSpeed,
      exif.focalLength,
    ].filter(Boolean);

    if (parts.length === 0) return null;

    return (
      <View style={styles.exifBadgeContainer}>
        <Text style={styles.exifBadgeText}>{parts.join('   •   ')}</Text>
      </View>
    );
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <TouchableOpacity onPress={handleDisconnect} style={styles.topBarBtn}>
            <Text style={styles.topBarBtnText}>← Thoát</Text>
          </TouchableOpacity>

          {/* Nút Reconnect nhanh góc trên bên trái khi mất kết nối */}
          {!isConnected && (
            <TouchableOpacity
              onPress={handleReconnect}
              style={[
                styles.topReconnectBtn,
                connStatus === 'connecting' && styles.topReconnectBtnDisabled,
              ]}
              disabled={connStatus === 'connecting'}
            >
              <Text style={styles.topReconnectBtnText}>
                {connStatus === 'connecting' ? '⏳ Đang kết nối...' : '🔄 Kết nối lại'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.topBarCenter}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isConnected
                  ? COLORS.success
                  : connStatus === 'connecting'
                    ? COLORS.warning
                    : COLORS.error,
              },
            ]}
          />
          <Text style={styles.topBarTitle}>
            {deviceInfo?.productname ?? 'Canon EOS RP'}
          </Text>
        </View>

        <View style={styles.topBarRight}>
          {/* Nút chuyển đổi Tốc độ truyền ảnh */}
          <TouchableOpacity
            onPress={() => setFastMode(!fastMode)}
            style={[
              styles.speedToggleBtn,
              fastMode && styles.speedToggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.speedToggleBtnText,
                fastMode && styles.speedToggleBtnTextActive,
              ]}
            >
              {fastMode ? '⚡ Siêu tốc (~0.5s)' : '🖼 Ảnh gốc (~4s)'}
            </Text>
          </TouchableOpacity>

          {/* Nút bật/tắt Chế độ So sánh 2 ảnh */}
          <TouchableOpacity
            onPress={toggleCompareMode}
            style={[
              styles.compareToggleBtn,
              isCompareMode && styles.compareToggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.compareToggleBtnText,
                isCompareMode && styles.compareToggleBtnTextActive,
              ]}
            >
              ⚖️ {isCompareMode ? 'Đóng so sánh' : 'So sánh 2 ảnh'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              loadSavedPhotos();
              setIsGalleryOpen(true);
            }}
            style={styles.topBarBtn}
          >
            <Text style={styles.topBarBtnText}>
              🖼 Thư viện ({photos.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setIsSettingsOpen(true)}
            style={styles.settingsBtn}
          >
            <Text style={styles.settingsBtnText}>⚙️ Cài đặt</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main Stage (Immersive Preview / Side-by-Side Compare) ─ */}
      <View style={styles.stage}>
        {isCompareMode ? (
          /* ── CHẾ ĐỘ SO SÁNH 2 ẢNH SIDE-BY-SIDE ── */
          <View style={styles.compareContainer}>
            {/* Khung Ảnh A (Trái - Ảnh mới chụp) */}
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => setActiveCompareSlot('A')}
              style={[
                styles.comparePane,
                activeCompareSlot === 'A' && styles.comparePaneActiveA,
              ]}
            >
              <View style={[styles.compareBadge, styles.compareBadgeA]}>
                <Text style={styles.compareBadgeText}>Ảnh A (Ảnh mới chụp 📸)</Text>
              </View>

              {/* Nút chọn ảnh từ iPad cho Khung A */}
              <TouchableOpacity
                onPress={() => handlePickExternalImage('A')}
                style={styles.panePickExternalBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.panePickExternalBtnText}>📁 Chọn ảnh từ iPad</Text>
              </TouchableOpacity>

              {comparePhotoA ? (
                <ScrollView
                  style={styles.zoomContainer}
                  contentContainerStyle={styles.zoomContent}
                  maximumZoomScale={5.0}
                  minimumZoomScale={1.0}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  centerContent={true}
                  bouncesZoom={true}
                >
                  <Image
                    source={{ uri: comparePhotoA.localUri }}
                    style={styles.compareImage}
                    resizeMode="contain"
                  />
                </ScrollView>
              ) : (
                <View style={styles.previewPlaceholder}>
                  <Text style={styles.previewPlaceholderText}>Chưa có ảnh mới chụp</Text>
                </View>
              )}
              {comparePhotoA && (
                <View style={styles.compareMetaOverlay}>
                  <Text style={styles.compareMetaText}>{comparePhotoA.filename}</Text>
                  {renderExifBadge(comparePhotoA.exif)}
                </View>
              )}
            </TouchableOpacity>

            {/* Nút Đổi Chỗ ⇄ Giữa 2 Ảnh */}
            <TouchableOpacity
              onPress={swapComparePhotos}
              style={styles.swapBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.swapBtnText}>⇄</Text>
            </TouchableOpacity>

            {/* Khung Ảnh B (Phải - Khóa hiển thị 1 bức duy nhất) */}
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => setActiveCompareSlot('B')}
              style={[
                styles.comparePane,
                activeCompareSlot === 'B' && styles.comparePaneActiveB,
                isLockB && styles.comparePaneLockedB,
              ]}
            >
              <View style={[styles.compareBadge, styles.compareBadgeB]}>
                <Text style={styles.compareBadgeText}>
                  {isLockB ? 'Ảnh B (🔒 Đã khóa cố định)' : 'Ảnh B (Tham chiếu)'}
                </Text>
              </View>

              <View style={styles.paneControlsRight}>
                {/* Nút Khóa / Mở khóa hiển thị cố định ở Ảnh B */}
                <TouchableOpacity
                  onPress={() => setIsLockB(!isLockB)}
                  style={[
                    styles.paneLockBtn,
                    isLockB && styles.paneLockBtnActive,
                  ]}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.paneLockBtnText,
                      isLockB && styles.paneLockBtnTextActive,
                    ]}
                  >
                    {isLockB ? '🔒 Đã khóa B' : '🔓 Mở khóa'}
                  </Text>
                </TouchableOpacity>

                {/* Nút chọn ảnh từ iPad cho Khung B */}
                <TouchableOpacity
                  onPress={() => handlePickExternalImage('B')}
                  style={styles.panePickExternalBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.panePickExternalBtnText}>📁 Chọn ảnh từ iPad</Text>
                </TouchableOpacity>
              </View>

              {comparePhotoB ? (
                <ScrollView
                  style={styles.zoomContainer}
                  contentContainerStyle={styles.zoomContent}
                  maximumZoomScale={5.0}
                  minimumZoomScale={1.0}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  centerContent={true}
                  bouncesZoom={true}
                >
                  <Image
                    source={{ uri: comparePhotoB.localUri }}
                    style={styles.compareImage}
                    resizeMode="contain"
                  />
                </ScrollView>
              ) : (
                <View style={styles.previewPlaceholder}>
                  <Text style={styles.previewPlaceholderText}>Chưa chọn Ảnh B</Text>
                </View>
              )}
              {comparePhotoB && (
                <View style={styles.compareMetaOverlay}>
                  <Text style={styles.compareMetaText}>{comparePhotoB.filename}</Text>
                  {renderExifBadge(comparePhotoB.exif)}
                </View>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* ── CHẾ ĐỘ XEM ĐƠN TOÀN MÀN HÌNH (CÓ PHÓNG TO THU NHỎ PINCH-TO-ZOOM) ── */
          <>
            {displayPhoto ? (
              <ScrollView
                style={styles.zoomContainer}
                contentContainerStyle={styles.zoomContent}
                maximumZoomScale={5.0}
                minimumZoomScale={1.0}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                centerContent={true}
                bouncesZoom={true}
              >
                <Image
                  source={{ uri: displayPhoto.localUri }}
                  style={styles.mainPreviewImage}
                  resizeMode="contain"
                />
              </ScrollView>
            ) : (
              <View style={styles.previewPlaceholder}>
                <Text style={styles.previewPlaceholderIcon}>📷</Text>
                <Text style={styles.previewPlaceholderText}>
                  {isConnected
                    ? 'Bấm chụp trên máy ảnh — ảnh sẽ tự động hiển thị ở đây'
                    : 'Đang kết nối tới máy ảnh Canon RP...'}
                </Text>
              </View>
            )}

            {/* Thông tin ảnh đè nhẹ góc dưới của Stage */}
            {displayPhoto && (
              <View style={styles.metaOverlay}>
                <Text style={styles.metaFilename}>{displayPhoto.filename}</Text>
                {renderExifBadge(displayPhoto.exif)}
              </View>
            )}

            {/* Gợi ý Zoom & Phóng to thu nhỏ */}
            {displayPhoto && (
              <View style={styles.zoomHintBadge}>
                <Text style={styles.zoomHintBadgeText}>🔍 Dùng 2 ngón tay phóng to / thu nhỏ chi tiết (1x - 5x)</Text>
              </View>
            )}
          </>
        )}

        {/* Loading Overlay khi đang tải ảnh */}
        {downloading && (
          <View style={styles.downloadingOverlay}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.downloadingText}>
              {queueCount > 0
                ? `Đang đồng bộ (còn ${queueCount + 1} ảnh)...`
                : 'Đang tải ảnh...'}
            </Text>
          </View>
        )}

        {/* Banner báo lỗi nổi */}
        {(lastError || errorMessage) && (
          <View style={styles.errorFloating}>
            <Text style={styles.errorText}>⚠️ {lastError || errorMessage}</Text>
          </View>
        )}
      </View>

      {/* ── Bottom Filmstrip (Ảnh gần đây) ──────────────────── */}
      <View style={styles.filmstripContainer}>
        <View style={styles.filmstripHeader}>
          <Text style={styles.filmstripTitle}>
            {isCompareMode
              ? isLockB
                ? '🔒 Ảnh B đã khóa • Chạm ảnh để xem trên [Ảnh A]'
                : `Chạm ảnh để đổi cho khung [Ảnh ${activeCompareSlot}]`
              : 'Ảnh gần đây'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
            {isCompareMode && (
              <TouchableOpacity
                onPress={() => setIsLockB(!isLockB)}
                style={[
                  styles.pickExternalStripBtn,
                  isLockB && { borderColor: '#FF9500', backgroundColor: 'rgba(255, 149, 0, 0.2)' },
                ]}
                activeOpacity={0.8}
              >
                <Text style={[styles.pickExternalStripBtnText, isLockB && { color: '#FF9500' }]}>
                  {isLockB ? '🔒 Đang khóa Ảnh B' : '🔓 Mở khóa B'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => handlePickExternalImage(isLockB ? 'B' : activeCompareSlot)}
              style={styles.pickExternalStripBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.pickExternalStripBtnText}>
                📁 Chọn ảnh từ iPad
              </Text>
            </TouchableOpacity>

            <Text style={styles.filmstripCounter}>{photos.length} ảnh</Text>
          </View>
        </View>

        {photos.length === 0 ? (
          <View style={styles.emptyStrip}>
            <Text style={styles.emptyStripText}>Chưa có ảnh nào được tải về</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filmstripContent}
          >
            {photos.map((p) => {
              const isSelected = displayPhoto?.id === p.id;
              const isA = comparePhotoA?.id === p.id;
              const isB = comparePhotoB?.id === p.id;

              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (isCompareMode) {
                      if (isLockB) {
                        // Khóa Ảnh B cố định: Bấm ảnh nào cũng chỉ gán vào Ảnh A
                        setComparePhotoA(p);
                        setActiveCompareSlot('A');
                      } else {
                        if (activeCompareSlot === 'A') {
                          setComparePhotoA(p);
                          setActiveCompareSlot('B');
                        } else {
                          setComparePhotoB(p);
                          setActiveCompareSlot('A');
                        }
                      }
                    } else {
                      setSelectedPhoto(p);
                    }
                  }}
                  style={[
                    styles.thumbWrapper,
                    !isCompareMode && isSelected && styles.thumbWrapperActive,
                    isCompareMode && isA && styles.thumbWrapperCompareA,
                    isCompareMode && isB && styles.thumbWrapperCompareB,
                  ]}
                >
                  <Image
                    source={{ uri: p.localUri }}
                    style={styles.thumbImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.thumbLabel} numberOfLines={1}>
                    {p.filename.replace('.JPG', '')}
                  </Text>

                  {/* Badge đánh dấu ảnh tham chiếu từ iPad */}
                  {p.id.startsWith('ref_') && (
                    <View style={styles.thumbRefBadge}>
                      <Text style={styles.thumbRefBadgeText}>📁 iPad</Text>
                    </View>
                  )}

                  {/* Badge đánh dấu A hoặc B trên thumbnail */}
                  {isCompareMode && isA && (
                    <View style={[styles.thumbSlotBadge, { backgroundColor: '#34C759' }]}>
                      <Text style={styles.thumbSlotBadgeText}>A</Text>
                    </View>
                  )}
                  {isCompareMode && isB && (
                    <View style={[styles.thumbSlotBadge, { backgroundColor: '#FF9500' }]}>
                      <Text style={styles.thumbSlotBadgeText}>B</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* ── Settings Modal ──────────────────────────────────── */}
      <Modal
        visible={isSettingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSettingsOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚙️ Cài đặt Tether</Text>
              <TouchableOpacity
                onPress={() => setIsSettingsOpen(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Toggle Tự động tải */}
            <View style={styles.settingItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Tự động tải ảnh</Text>
                <Text style={styles.settingDesc}>
                  Tự động tải ảnh về iPad ngay sau khi bấm chụp trên máy ảnh
                </Text>
              </View>
              <Switch
                value={autoDownload}
                onValueChange={setAutoDownload}
                trackColor={{ false: COLORS.bgTertiary, true: COLORS.accentLight }}
                thumbColor={autoDownload ? COLORS.accent : COLORS.textMuted}
              />
            </View>

            {/* Toggle Chế độ truyền ảnh siêu tốc */}
            <View style={styles.settingItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>⚡ Truyền ảnh siêu tốc (~0.5s)</Text>
                <Text style={styles.settingDesc}>
                  Tải ảnh xem nhanh chuẩn HD (~500KB), truyền qua Wi-Fi tức thì trong ~0.5s thay vì tải toàn bộ file 26MP (~15MB)
                </Text>
              </View>
              <Switch
                value={fastMode}
                onValueChange={setFastMode}
                trackColor={{ false: COLORS.bgTertiary, true: '#FFCC00' }}
                thumbColor={fastMode ? '#FFCC00' : COLORS.textMuted}
              />
            </View>

            {/* Trạng thái kết nối */}
            <View style={styles.settingCard}>
              <Text style={styles.settingCardTitle}>Trạng thái máy ảnh</Text>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>Kết nối Wi-Fi:</Text>
                <Text
                  style={[
                    styles.settingVal,
                    { color: isConnected ? COLORS.success : COLORS.error },
                  ]}
                >
                  {isConnected ? '🟢 Đã kết nối' : '🔴 Mất kết nối'}
                </Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>IP Máy ảnh:</Text>
                <Text style={styles.settingVal}>{cameraIp || 'Chưa có'}</Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>Event Polling:</Text>
                <Text
                  style={[
                    styles.settingVal,
                    {
                      color:
                        pollerStatus === 'polling'
                          ? COLORS.success
                          : pollerStatus === 'reconnecting'
                            ? COLORS.warning
                            : COLORS.textMuted,
                    },
                  ]}
                >
                  {pollerStatus === 'polling'
                    ? '🟢 Đang lắng nghe'
                    : pollerStatus === 'reconnecting'
                      ? '🟡 Đang kết nối lại'
                      : '⚪ Dừng'}
                </Text>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingKey}>Tổng số ảnh:</Text>
                <Text style={[styles.settingVal, { fontWeight: '700' }]}>
                  {photos.length} tấm
                </Text>
              </View>

              {!isConnected && (
                <TouchableOpacity
                  style={styles.reconnectModalBtn}
                  onPress={handleReconnect}
                >
                  <Text style={styles.reconnectModalText}>🔄 Thử kết nối lại</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Nút thoát */}
            <TouchableOpacity
              style={styles.disconnectModalBtn}
              onPress={() => {
                setIsSettingsOpen(false);
                handleDisconnect();
              }}
            >
              <Text style={styles.disconnectModalText}>Ngắt kết nối máy ảnh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Gallery Modal (Đồng bộ trực tiếp với ảnh gần đây & chọn ảnh xem) ── */}
      <Modal
        visible={isGalleryOpen}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setIsGalleryOpen(false)}
      >
        <SafeAreaView style={styles.galleryModalContainer}>
          <View style={styles.galleryModalHeader}>
            <View>
              <Text style={styles.galleryModalTitle}>
                🖼 Thư viện ảnh ({photos.length})
              </Text>
              <Text style={styles.galleryModalSubtitle}>
                {isCompareMode
                  ? `Đang chọn cho [Khung ảnh ${activeCompareSlot}] • Chạm ảnh để so sánh`
                  : 'Chạm ảnh để xem trên màn hình lớn'}
              </Text>
            </View>

            <View style={styles.galleryModalActions}>
              <TouchableOpacity
                onPress={() => {
                  setIsGalleryOpen(false);
                  handlePickExternalImage(isCompareMode ? activeCompareSlot : 'B');
                }}
                style={styles.galleryHeaderBtn}
              >
                <Text style={styles.galleryHeaderBtnText}>📁 Chọn ảnh từ iPad</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={loadSavedPhotos}
                style={styles.galleryHeaderBtn}
              >
                <Text style={styles.galleryHeaderBtnText}>🔄 Làm mới</Text>
              </TouchableOpacity>

              {photos.length > 0 && (
                <TouchableOpacity
                  onPress={handleClearCache}
                  style={[styles.galleryHeaderBtn, { borderColor: COLORS.error }]}
                >
                  <Text style={[styles.galleryHeaderBtnText, { color: COLORS.error }]}>
                    🗑 Xoá đệm
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => setIsGalleryOpen(false)}
                style={styles.galleryCloseBtn}
              >
                <Text style={styles.galleryCloseText}>✕ Đóng</Text>
              </TouchableOpacity>
            </View>
          </View>

          {photos.length === 0 ? (
            <View style={styles.galleryEmptyContainer}>
              <Text style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>📂</Text>
              <Text style={styles.galleryEmptyText}>Thư viện trống</Text>
              <Text style={styles.galleryEmptySubtext}>
                Ảnh sẽ tự động xuất hiện ở đây ngay khi bạn bấm chụp trên máy ảnh
              </Text>
            </View>
          ) : (
            <FlatList
              data={photos}
              keyExtractor={(item) => item.id}
              numColumns={4}
              contentContainerStyle={styles.galleryGrid}
              columnWrapperStyle={styles.galleryGridRow}
              showsVerticalScrollIndicator={true}
              renderItem={({ item }) => {
                const isSelected = displayPhoto?.id === item.id;
                const isA = comparePhotoA?.id === item.id;
                const isB = comparePhotoB?.id === item.id;

                return (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      if (isCompareMode) {
                        if (isLockB) {
                          setComparePhotoA(item);
                          setActiveCompareSlot('A');
                        } else {
                          if (activeCompareSlot === 'A') {
                            setComparePhotoA(item);
                            setActiveCompareSlot('B');
                          } else {
                            setComparePhotoB(item);
                            setActiveCompareSlot('A');
                          }
                        }
                      } else {
                        setSelectedPhoto(item);
                      }
                      setIsGalleryOpen(false);
                    }}
                    style={[
                      styles.galleryCard,
                      !isCompareMode && isSelected && styles.galleryCardActive,
                      isCompareMode && isA && styles.galleryCardCompareA,
                      isCompareMode && isB && styles.galleryCardCompareB,
                    ]}
                  >
                    <Image
                      source={{ uri: item.localUri }}
                      style={styles.galleryCardImage}
                      resizeMode="cover"
                    />

                    {/* Badge trạng thái */}
                    {!isCompareMode && isSelected && (
                      <View style={styles.gallerySelectedBadge}>
                        <Text style={styles.gallerySelectedBadgeText}>✓ Đang xem</Text>
                      </View>
                    )}
                    {isCompareMode && isA && (
                      <View style={[styles.gallerySlotBadge, { backgroundColor: '#34C759' }]}>
                        <Text style={styles.gallerySlotBadgeText}>Ảnh A</Text>
                      </View>
                    )}
                    {isCompareMode && isB && (
                      <View style={[styles.gallerySlotBadge, { backgroundColor: '#FF9500' }]}>
                        <Text style={styles.gallerySlotBadgeText}>Ảnh B</Text>
                      </View>
                    )}

                    <View style={styles.galleryCardFooter}>
                      <Text style={styles.galleryCardName} numberOfLines={1}>
                        {item.filename}
                      </Text>
                      {item.exif && (
                        <Text style={styles.galleryCardExif} numberOfLines={1}>
                          {[item.exif.aperture, item.exif.shutterSpeed, item.exif.iso]
                            .filter(Boolean)
                            .join(' • ')}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  topReconnectBtn: {
    backgroundColor: 'rgba(255, 149, 0, 0.2)',
    borderWidth: 1,
    borderColor: '#FF9500',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  topReconnectBtnDisabled: {
    opacity: 0.6,
  },
  topReconnectBtnText: {
    color: '#FF9500',
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  topBarBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  topBarBtnText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  topBarCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  topBarTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  speedToggleBtn: {
    backgroundColor: 'rgba(255, 204, 0, 0.15)',
    borderWidth: 1,
    borderColor: '#FFCC00',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  speedToggleBtnActive: {
    backgroundColor: '#FFCC00',
  },
  speedToggleBtnText: {
    color: '#FFCC00',
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  speedToggleBtnTextActive: {
    color: '#000',
    fontWeight: '800',
  },
  compareToggleBtn: {
    backgroundColor: COLORS.bgTertiary,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compareToggleBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accentLight,
  },
  compareToggleBtnText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  compareToggleBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  settingsBtn: {
    backgroundColor: COLORS.bgTertiary,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsBtnText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },

  // Main Stage (Preview)
  stage: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  mainPreviewImage: {
    width: '100%',
    height: '100%',
  },
  zoomContainer: {
    width: '100%',
    height: '100%',
  },
  zoomContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomHintBadge: {
    position: 'absolute',
    bottom: SPACING.md,
    right: SPACING.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 15,
  },
  zoomHintBadgeText: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: '600',
  },
  previewPlaceholder: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  previewPlaceholderIcon: {
    fontSize: 56,
    marginBottom: SPACING.md,
    opacity: 0.3,
  },
  previewPlaceholderText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    maxWidth: 360,
  },

  // ── Compare Side-by-Side Styles ─────────────────────────────────
  compareContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    position: 'relative',
    padding: SPACING.xs,
    gap: SPACING.xs,
  },
  comparePane: {
    flex: 1,
    height: '100%',
    backgroundColor: '#111',
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#222',
  },
  comparePaneActiveA: {
    borderColor: '#34C759',
  },
  comparePaneActiveB: {
    borderColor: '#FF9500',
  },
  comparePaneLockedB: {
    borderColor: '#FF9500',
    backgroundColor: '#14120e',
  },
  paneControlsRight: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    zIndex: 10,
  },
  paneLockBtn: {
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingVertical: 3,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  paneLockBtnActive: {
    backgroundColor: 'rgba(255, 149, 0, 0.25)',
    borderColor: '#FF9500',
  },
  paneLockBtnText: {
    color: '#ccc',
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  paneLockBtnTextActive: {
    color: '#FF9500',
    fontWeight: '800',
  },
  compareImage: {
    width: '100%',
    height: '100%',
  },
  compareBadge: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    paddingVertical: 3,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    zIndex: 10,
  },
  compareBadgeA: {
    backgroundColor: 'rgba(52, 199, 89, 0.9)',
  },
  compareBadgeB: {
    backgroundColor: 'rgba(255, 149, 0, 0.9)',
  },
  compareBadgeText: {
    color: '#000',
    fontSize: FONT_SIZE.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  panePickExternalBtn: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingVertical: 3,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    zIndex: 10,
  },
  panePickExternalBtnText: {
    color: '#fff',
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  compareMetaOverlay: {
    position: 'absolute',
    bottom: SPACING.sm,
    left: SPACING.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 2,
    paddingHorizontal: SPACING.sm,
    borderRadius: 4,
    zIndex: 10,
  },
  compareMetaText: {
    color: '#fff',
    fontSize: FONT_SIZE.xs,
    fontFamily: 'monospace',
  },
  swapBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 20, 20, 0.9)',
    borderWidth: 1.5,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  swapBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Overlays
  downloadingOverlay: {
    position: 'absolute',
    top: SPACING.lg,
    right: SPACING.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: SPACING.sm,
    zIndex: 20,
  },
  downloadingText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  metaOverlay: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  metaFilename: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  exifBadgeContainer: {
    marginTop: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 3,
    paddingHorizontal: SPACING.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.4)',
    alignSelf: 'flex-start',
  },
  exifBadgeText: {
    color: '#34C759',
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  errorFloating: {
    position: 'absolute',
    top: SPACING.lg,
    left: SPACING.lg,
    backgroundColor: 'rgba(255, 59, 48, 0.85)',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    zIndex: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
  },

  // Bottom Filmstrip
  filmstripContainer: {
    height: 125,
    backgroundColor: COLORS.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  filmstripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  filmstripTitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filmstripCounter: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  pickExternalStripBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    paddingVertical: 2,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  pickExternalStripBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  filmstripContent: {
    gap: SPACING.sm,
    alignItems: 'center',
  },
  thumbWrapper: {
    width: 100,
    height: 70,
    borderRadius: BORDER_RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: COLORS.bgTertiary,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  thumbWrapperActive: {
    borderColor: COLORS.accent,
  },
  thumbWrapperCompareA: {
    borderColor: '#34C759',
  },
  thumbWrapperCompareB: {
    borderColor: '#FF9500',
  },
  thumbSlotBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbSlotBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
  },
  thumbRefBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: '#007AFF',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    zIndex: 6,
  },
  thumbRefBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbLabel: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    right: 2,
    fontSize: 9,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 2,
    borderRadius: 2,
    textAlign: 'center',
  },
  emptyStrip: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStripText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },

  // Modal Settings
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.sm,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: SPACING.xs,
  },
  modalCloseText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgTertiary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  settingLabel: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  settingDesc: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  settingCard: {
    backgroundColor: COLORS.bgTertiary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  settingCardTitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  settingKey: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  settingVal: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
  },
  reconnectModalBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.accent,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    alignItems: 'center',
  },
  reconnectModalText: {
    color: '#fff',
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  disconnectModalBtn: {
    borderWidth: 1,
    borderColor: COLORS.error,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  disconnectModalText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },

  // ── Gallery Modal Styles ─────────────────────────────────────────
  galleryModalContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  galleryModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bgSecondary,
  },
  galleryModalTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  galleryModalSubtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  galleryModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  galleryHeaderBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgTertiary,
  },
  galleryHeaderBtnText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  galleryCloseBtn: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  galleryCloseText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  galleryEmptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  galleryEmptyText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  galleryEmptySubtext: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    maxWidth: 320,
  },
  galleryGrid: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  galleryGridRow: {
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  galleryCard: {
    flex: 1,
    backgroundColor: COLORS.bgTertiary,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.border,
    position: 'relative',
  },
  galleryCardActive: {
    borderColor: COLORS.accent,
  },
  galleryCardCompareA: {
    borderColor: '#34C759',
  },
  galleryCardCompareB: {
    borderColor: '#FF9500',
  },
  galleryCardImage: {
    width: '100%',
    aspectRatio: 3 / 2,
  },
  gallerySelectedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: COLORS.accent,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    zIndex: 5,
  },
  gallerySelectedBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
  },
  gallerySlotBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    zIndex: 5,
  },
  gallerySlotBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
  },
  galleryCardFooter: {
    padding: SPACING.xs,
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
  },
  galleryCardName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  galleryCardExif: {
    color: '#34C759',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
