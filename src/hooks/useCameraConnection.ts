/**
 * React hook – manages camera connection state.
 *
 * • Loads the persisted IP from AsyncStorage on mount.
 * • Exposes connect / disconnect helpers.
 * • Periodically pings the camera to detect drops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraConnectionState, ConnectionStatus, DeviceInformation } from '../types/ccapi';
import { ccapi } from '../services/ccapi';

const STORAGE_KEY_IP = '@canon_tether/camera_ip';
const STORAGE_KEY_PORT = '@canon_tether/camera_port';
const HEARTBEAT_INTERVAL_MS = 10_000;

export function useCameraConnection() {
  const [state, setState] = useState<CameraConnectionState>({
    status: 'disconnected',
    cameraIp: '',
    cameraPort: '8080',
    deviceInfo: null,
    errorMessage: null,
  });

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Persist helpers ─────────────────────────────────────────────

  const loadSavedIp = useCallback(async () => {
    try {
      const ip = await AsyncStorage.getItem(STORAGE_KEY_IP);
      const port = await AsyncStorage.getItem(STORAGE_KEY_PORT);
      if (ip) {
        setState((s) => ({
          ...s,
          cameraIp: ip,
          cameraPort: port || '8080',
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const saveIp = useCallback(async (ip: string, port: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_IP, ip);
      await AsyncStorage.setItem(STORAGE_KEY_PORT, port);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Connect ─────────────────────────────────────────────────────

  const connect = useCallback(
    async (ip: string, port: string = '8080') => {
      setState((s) => ({
        ...s,
        status: 'connecting' as ConnectionStatus,
        cameraIp: ip,
        cameraPort: port,
        errorMessage: null,
      }));

      ccapi.setConnection(ip, port);

      try {
        const info: DeviceInformation = await ccapi.getDeviceInfo();
        await saveIp(ip, port);
        setState((s) => ({
          ...s,
          status: 'connected' as ConnectionStatus,
          deviceInfo: info,
          errorMessage: null,
        }));
        startHeartbeat();
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Không thể kết nối tới máy ảnh';
        setState((s) => ({
          ...s,
          status: 'error' as ConnectionStatus,
          errorMessage: msg,
        }));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const disconnect = useCallback(() => {
    stopHeartbeat();
    setState((s) => ({
      ...s,
      status: 'disconnected' as ConnectionStatus,
      deviceInfo: null,
      errorMessage: null,
    }));
  }, []);

  // ── Heartbeat ───────────────────────────────────────────────────

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(async () => {
      const alive = await ccapi.ping();
      if (!alive) {
        setState((s) => {
          if (s.status === 'connected') {
            return {
              ...s,
              status: 'error' as ConnectionStatus,
              errorMessage: 'Mất kết nối tới máy ảnh',
            };
          }
          return s;
        });
      } else {
        setState((s) => {
          if (s.status === 'error') {
            return {
              ...s,
              status: 'connected' as ConnectionStatus,
              errorMessage: null,
            };
          }
          return s;
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // ── Lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    loadSavedIp();
    return () => stopHeartbeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    loadSavedIp,
  };
}
