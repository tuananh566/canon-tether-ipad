/**
 * Main tether screen — Studio Pro Layout.
 *
 * Layout:
 *  • Top bar: Back, Camera Name, Gallery shortcut & Settings button (⚙️)
 *  • Center Stage (flex: 1): Immersive Large Photo Preview with metadata overlay
 *  • Bottom Bar: Horizontal thumbnails filmstrip of recent shots
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
  Alert,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCameraConnection } from '../src/hooks/useCameraConnection';
import { useEventPoller } from '../src/hooks/useEventPoller';
import { ccapi } from '../src/services/ccapi';
import {
  downloadAndSavePhoto,
  filenameFromPath,
  isJpeg,
  requestMediaLibraryPermission,
} from '../src/services/photoDownloader';
import { DownloadedPhoto } from '../src/types/ccapi';
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

  // Track processed URLs to avoid double-downloads.
  const processedUrls = useRef(new Set<string>());
  // Queue tải ảnh tuần tự tránh nghẽn chip Wi-Fi máy ảnh khi chụp liên tục
  const downloadQueue = useRef<string[]>([]);
  const isDownloadingRef = useRef(false);

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
          const photo = await downloadAndSavePhoto(contentUrl, filename);
          setPhotos((prev) => [photo, ...prev]);
          setSelectedPhoto(photo); // Tự động hiển thị ảnh mới nhất vừa chụp
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
  }, []);

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

  // ── Render ──────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleDisconnect} style={styles.topBarBtn}>
          <Text style={styles.topBarBtnText}>← Thoát</Text>
        </TouchableOpacity>

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
          <TouchableOpacity
            onPress={() => router.push('/gallery')}
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

      {/* ── Main Stage (Immersive Preview) ───────────────────── */}
      <View style={styles.stage}>
        {displayPhoto ? (
          <Image
            source={{ uri: displayPhoto.localUri }}
            style={styles.mainPreviewImage}
            resizeMode="contain"
          />
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

        {/* Thông tin ảnh đè nhẹ góc dưới của Stage */}
        {displayPhoto && (
          <View style={styles.metaOverlay}>
            <Text style={styles.metaFilename}>{displayPhoto.filename}</Text>
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
          <Text style={styles.filmstripTitle}>Ảnh gần đây</Text>
          <Text style={styles.filmstripCounter}>{photos.length} ảnh đã chụp</Text>
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
              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.8}
                  onPress={() => setSelectedPhoto(p)}
                  style={[
                    styles.thumbWrapper,
                    isSelected && styles.thumbWrapperActive,
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
  errorFloating: {
    position: 'absolute',
    top: SPACING.lg,
    left: SPACING.lg,
    backgroundColor: 'rgba(255, 59, 48, 0.85)',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
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
});
