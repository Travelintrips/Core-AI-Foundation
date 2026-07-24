/**
 * Design tokens derived from Creative AI Studio customer portal.
 * Both light and dark palettes use the portal's dark Apex Intelligence theme
 * so the mobile app always matches the portal's look.
 */

const portalDark = {
  // Legacy aliases
  text: '#F0F4FF',
  tint: '#7C6EFA',
  // Core surfaces
  background: '#060B18',
  foreground: '#F0F4FF',
  // Cards / elevated surfaces
  card: '#0D1526',
  cardForeground: '#F0F4FF',
  // Primary — Violet
  primary: '#7C6EFA',
  primaryForeground: '#FFFFFF',
  // Secondary
  secondary: '#1C2A45',
  secondaryForeground: '#F0F4FF',
  // Muted
  muted: '#192038',
  mutedForeground: '#8B9BC4',
  // Accent
  accent: '#1A2540',
  accentForeground: '#F0F4FF',
  // Destructive
  destructive: '#F43F5E',
  destructiveForeground: '#FFFFFF',
  // Borders and inputs
  border: '#243352',
  input: '#131E35',
  // Surface layers
  surface1: '#0D1526',
  surface2: '#131E35',
  surface3: '#1C2A45',
  // Brand accent tokens
  cyan: '#22D3EE',
  gold: '#F59E0B',
  emerald: '#10B981',
};

const colors = {
  light: portalDark,
  dark: portalDark,
  radius: 12,
};

export default colors;
