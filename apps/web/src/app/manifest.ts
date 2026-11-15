import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CraftingHosting.free',
    short_name: 'CH.free',
    description: 'Free Minecraft hosting by CraftingHosting',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0d14',
    theme_color: '#0b0d14',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
