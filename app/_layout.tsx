/**
 * Root layout — dark theme, expo-router slot.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '../src/constants/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.textPrimary,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: COLORS.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'Canon Tether', headerShown: false }}
        />
        <Stack.Screen
          name="tether"
          options={{ title: 'Tether', headerShown: false }}
        />
        <Stack.Screen
          name="gallery"
          options={{
            title: 'Thư viện ảnh',
            presentation: 'modal',
            headerStyle: { backgroundColor: COLORS.bgSecondary },
          }}
        />
      </Stack>
    </>
  );
}
