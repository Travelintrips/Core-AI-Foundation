import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 * Both light and dark palettes use the portal dark theme, so the app
 * always matches Creative AI Studio's visual identity.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
