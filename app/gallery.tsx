/**
 * Gallery screen — grid of downloaded photo thumbnails.
 *
 * Note: In a production app you would read from expo-media-library's album.
 * For simplicity this demo reads from the local file-system cache that
 * photoDownloader writes into.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  SafeAreaView,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../src/constants/theme';

const DOWNLOAD_DIR = `${FileSystem.documentDirectory}canon-tether/`;
const SCREEN_W = Dimensions.get('window').width;
const NUM_COLUMNS = 4;
const THUMB_GAP = SPACING.xs;
const THUMB_SIZE = (SCREEN_W - SPACING.lg * 2 - THUMB_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

interface GalleryPhoto {
  name: string;
  uri: string;
  modificationTime: number;
}

export default function GalleryScreen() {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);

  useEffect(() => {
    loadPhotos();
  }, []);

  const loadPhotos = async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
      if (!dirInfo.exists) {
        setPhotos([]);
        return;
      }

      const files = await FileSystem.readDirectoryAsync(DOWNLOAD_DIR);
      const imageFiles = files
        .filter((f) => {
          const lower = f.toLowerCase();
          return (
            lower.endsWith('.jpg') ||
            lower.endsWith('.jpeg') ||
            lower.endsWith('.png') ||
            lower.endsWith('.heic')
          );
        })
        .map((name) => ({
          name,
          uri: `${DOWNLOAD_DIR}${name}`,
          modificationTime: 0,
        }))
        .reverse(); // newest first (files are prefixed with timestamp)

      setPhotos(imageFiles);
    } catch (err) {
      console.error('[Gallery] load error:', err);
    }
  };

  const renderItem = ({ item }: { item: GalleryPhoto }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => setSelectedPhoto(item)}
      style={styles.thumbWrapper}
    >
      <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyText}>Chưa có ảnh nào</Text>
          <Text style={styles.emptySubtext}>
            Ảnh sẽ xuất hiện ở đây sau khi được tải từ máy ảnh
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.headerText}>{photos.length} ảnh</Text>
            <TouchableOpacity onPress={loadPhotos}>
              <Text style={styles.refreshBtn}>🔄 Làm mới</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={photos}
            keyExtractor={(item) => item.name}
            renderItem={renderItem}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}

      {/* Full-screen modal */}
      <Modal
        visible={!!selectedPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <SafeAreaView style={styles.modal}>
          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => setSelectedPhoto(null)}
          >
            <Text style={styles.modalCloseText}>✕ Đóng</Text>
          </TouchableOpacity>

          {selectedPhoto && (
            <>
              <Image
                source={{ uri: selectedPhoto.uri }}
                style={styles.modalImage}
                resizeMode="contain"
              />
              <Text style={styles.modalFilename}>{selectedPhoto.name}</Text>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  refreshBtn: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },

  // Grid
  grid: {
    padding: SPACING.lg,
  },
  gridRow: {
    gap: THUMB_GAP,
    marginBottom: THUMB_GAP,
  },
  thumbWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: BORDER_RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: COLORS.bgTertiary,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },

  // Empty
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
    opacity: 0.4,
  },
  emptyText: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: SPACING.xxl,
    right: SPACING.lg,
    zIndex: 10,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  modalCloseText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  modalImage: {
    width: '90%',
    height: '80%',
  },
  modalFilename: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.md,
    fontVariant: ['tabular-nums'],
  },
});
