/**
 * Main tether screen.
 *
 * Shows:
 *  • Connection status badge
 *  • Large preview of the last downloaded photo
 *  • Photo counter
 *  • Auto-download toggle
 *  • Gallery shortcut
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
  Dimensions,
  ScrollView,
  Alert,
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

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_SIZE = Math.min(SCREEN_W * 0.55, 800);

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
  const [downloading, setDownloading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Track processed URLs to avoid double-downloads.
  const processedUrls = useRef(new Set<string>());

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

  // ── New-content handler ─────────────────────────────────────────

  const handleNewContent = useCallback(
    async (urls: string[]) => {
      if (!autoDownload) return;

      for (const rawUrl of urls) {
        const filename = filenameFromPath(rawUrl);

        // Skip non-JPEG and already-processed files.
        if (!isJpeg(filename)) continue;
        if (processedUrls.current.has(rawUrl)) continue;
        processedUrls.current.add(rawUrl);

        const contentUrl = ccapi.getContentUrl(rawUrl);

        setDownloading(true);
        setLastError(null);

        try {
          const photo = await downloadAndSavePhoto(contentUrl, filename);
          setPhotos((prev) => [photo, ...prev]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Tải ảnh thất bại';
          setLastError(msg);
          console.error('[Tether] download error:', err);
        } finally {
          setDownloading(false);
        }
      }
    },
    [autoDownload],
  );

  // ── Event poller ────────────────────────────────────────────────

  const { pollerStatus } = useEventPoller(
    connStatus === 'connected',
    handleNewContent,
  );

  // ── Derived state ───────────────────────────────────────────────

  const isConnected = connStatus === 'connected';
  const latestPhoto = photos[0] ?? null;

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
    <View style={styles.container}>
      {/* ── Top bar ─────────────────────────────────────────── */}
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
            {deviceInfo?.productname ?? 'Canon Camera'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/gallery')}
          style={styles.topBarBtn}
        >
          <Text style={styles.topBarBtnText}>
            🖼 Thư viện ({photos.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Main content ────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview */}
        <View style={styles.previewContainer}>
          {latestPhoto ? (
            <Image
              source={{ uri: latestPhoto.localUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.previewPlaceholderIcon}>📷</Text>
              <Text style={styles.previewPlaceholderText}>
                {isConnected
                  ? 'Chụp ảnh trên máy ảnh — ảnh sẽ tự động hiển thị ở đây'
                  : 'Đang chờ kết nối...'}
              </Text>
            </View>
          )}

          {downloading && (
            <View style={styles.downloadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.accent} />
              <Text style={styles.downloadingText}>Đang tải ảnh...</Text>
            </View>
          )}
        </View>

        {/* Latest photo info */}
        {latestPhoto && (
          <Text style={styles.latestFilename}>{latestPhoto.filename}</Text>
        )}

        {/* Status cards row */}
        <View style={styles.cardsRow}>
          {/* Connection status */}
          <View style={styles.statusCard}>
            <Text style={styles.cardLabel}>Kết nối</Text>
            <Text
              style={[
                styles.cardValue,
                { color: isConnected ? COLORS.success : COLORS.error },
              ]}
            >
              {isConnected
                ? 'Đã kết nối'
                : connStatus === 'connecting'
                  ? 'Đang kết nối...'
                  : 'Mất kết nối'}
            </Text>
            {!isConnected && connStatus !== 'connecting' && (
              <TouchableOpacity
                style={styles.reconnectBtn}
                onPress={handleReconnect}
              >
                <Text style={styles.reconnectBtnText}>Kết nối lại</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Poller status */}
          <View style={styles.statusCard}>
            <Text style={styles.cardLabel}>Event Polling</Text>
            <Text
              style={[
                styles.cardValue,
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

          {/* Counter */}
          <View style={styles.statusCard}>
            <Text style={styles.cardLabel}>Số ảnh</Text>
            <Text style={[styles.cardValue, styles.counterValue]}>
              {photos.length}
            </Text>
          </View>

          {/* Auto-download toggle */}
          <View style={styles.statusCard}>
            <Text style={styles.cardLabel}>Tự động tải</Text>
            <Switch
              value={autoDownload}
              onValueChange={setAutoDownload}
              trackColor={{ false: COLORS.bgTertiary, true: COLORS.accentLight }}
              thumbColor={autoDownload ? COLORS.accent : COLORS.textMuted}
              ios_backgroundColor={COLORS.bgTertiary}
              style={{ marginTop: SPACING.xs }}
            />
          </View>
        </View>

        {/* Error banner */}
        {(lastError || errorMessage) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              ⚠️ {lastError || errorMessage}
            </Text>
          </View>
        )}

        {/* Recent thumbnails strip */}
        {photos.length > 1 && (
          <View style={styles.stripContainer}>
            <Text style={styles.stripTitle}>Ảnh gần đây</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
            >
              {photos.slice(0, 20).map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: p.localUri }}
                  style={styles.stripThumb}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topBarBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
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

  // Content
  content: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },

  // Preview
  previewContainer: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE * 0.66,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  previewPlaceholderIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
    opacity: 0.4,
  },
  previewPlaceholderText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    maxWidth: 300,
  },
  downloadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  downloadingText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  latestFilename: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.lg,
    fontVariant: ['tabular-nums'],
  },

  // Cards row
  cardsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    width: '100%',
    maxWidth: 900,
    marginBottom: SPACING.lg,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  cardValue: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  counterValue: {
    fontSize: FONT_SIZE.xxl,
    color: COLORS.accent,
  },
  reconnectBtn: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  reconnectBtnText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
  },

  // Error
  errorBanner: {
    width: '100%',
    maxWidth: 900,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.sm,
  },

  // Recent strip
  stripContainer: {
    width: '100%',
    maxWidth: 900,
  },
  stripTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  strip: {
    gap: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  stripThumb: {
    width: 120,
    height: 80,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.bgTertiary,
  },
});
