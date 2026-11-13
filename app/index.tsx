/**
 * Connection screen — enter camera IP, test connection, navigate to tether.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../src/constants/theme';
import { ccapi } from '../src/services/ccapi';
import { DeviceInformation } from '../src/types/ccapi';

const STORAGE_KEY_IP = '@canon_tether/camera_ip';
const STORAGE_KEY_PORT = '@canon_tether/camera_port';

export default function ConnectionScreen() {
  const router = useRouter();
  const [ip, setIp] = useState('192.168.1.2');
  const [port, setPort] = useState('8080');
  const [testing, setTesting] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInformation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load saved IP on mount.
  useEffect(() => {
    (async () => {
      try {
        const savedIp = await AsyncStorage.getItem(STORAGE_KEY_IP);
        const savedPort = await AsyncStorage.getItem(STORAGE_KEY_PORT);
        if (savedIp) setIp(savedIp);
        if (savedPort) setPort(savedPort);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setDeviceInfo(null);
    ccapi.setConnection(ip, port);

    try {
      const info = await ccapi.getDeviceInfo();
      setDeviceInfo(info);

      // Persist on success.
      await AsyncStorage.setItem(STORAGE_KEY_IP, ip);
      await AsyncStorage.setItem(STORAGE_KEY_PORT, port);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối. Kiểm tra IP và đảm bảo máy ảnh đã bật WiFi + CCAPI.',
      );
    } finally {
      setTesting(false);
    }
  };

  const goToTether = () => {
    router.push('/tether');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {/* Logo / Title */}
        <View style={styles.header}>
          <Text style={styles.logoText}>📷</Text>
          <Text style={styles.title}>Canon Tether</Text>
          <Text style={styles.subtitle}>
            Kết nối iPad với máy ảnh Canon qua WiFi
          </Text>
        </View>

        {/* IP Input */}
        <View style={styles.card}>
          <Text style={styles.label}>Địa chỉ IP máy ảnh</Text>
          <TextInput
            style={styles.input}
            value={ip}
            onChangeText={setIp}
            placeholder="192.168.1.2"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="numeric"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={[styles.label, { marginTop: SPACING.md }]}>Cổng (Port)</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="8080"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="numeric"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={testConnection}
          />

          {/* Test Button */}
          <TouchableOpacity
            style={[styles.button, testing && styles.buttonDisabled]}
            onPress={testConnection}
            disabled={testing || !ip.trim()}
            activeOpacity={0.7}
          >
            {testing ? (
              <ActivityIndicator color={COLORS.textPrimary} />
            ) : (
              <Text style={styles.buttonText}>Kiểm tra kết nối</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {/* Success / Device Info */}
        {deviceInfo && (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>✅ Đã kết nối thành công!</Text>
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>Máy ảnh: </Text>
              {deviceInfo.productname}
            </Text>
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>Serial: </Text>
              {deviceInfo.serialnumber}
            </Text>
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>Firmware: </Text>
              {deviceInfo.firmwareversion}
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.buttonSuccess]}
              onPress={goToTether}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>Bắt đầu Tether →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>Hướng dẫn kết nối</Text>
          <Text style={styles.instructionsText}>
            1. Bật WiFi trên Canon RP (Menu → Cài đặt mạng → WiFi → Bật)
          </Text>
          <Text style={styles.instructionsText}>
            2. Kết nối iPad với WiFi của máy ảnh
          </Text>
          <Text style={styles.instructionsText}>
            3. Bật CCAPI trên máy ảnh (Menu → Cài đặt mạng → CCAPI)
          </Text>
          <Text style={styles.instructionsText}>
            4. Nhập địa chỉ IP hiển thị trên máy ảnh vào ô bên trên
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoText: {
    fontSize: 64,
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.hero,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
  },

  // Card
  card: {
    width: '100%',
    backgroundColor: COLORS.bgSecondary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.bgTertiary,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONT_SIZE.lg,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontVariant: ['tabular-nums'],
  },

  // Buttons
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    minHeight: 50,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonSuccess: {
    backgroundColor: COLORS.success,
  },
  buttonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },

  // Error
  errorCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.md,
  },

  // Success
  successCard: {
    width: '100%',
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  successTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: SPACING.sm,
  },
  infoRow: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  infoLabel: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },

  // Instructions
  instructions: {
    width: '100%',
    marginTop: SPACING.md,
    opacity: 0.7,
  },
  instructionsTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  instructionsText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
    lineHeight: 20,
  },
});
