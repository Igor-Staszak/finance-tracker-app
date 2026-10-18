// Generates PWA PNG icons from public/favicon.svg
import sharp from 'sharp';
const src = new URL('../public/favicon.svg', import.meta.url).pathname;
const out = (f) => new URL(`../public/${f}`, import.meta.url).pathname;
for (const size of [192, 512]) await sharp(src).resize(size, size).png().toFile(out(`icon-${size}.png`));
await sharp(src).resize(180, 180).flatten({ background: '#2a78d6' }).png().toFile(out('apple-touch-icon.png'));
// maskable: icon with safe-zone padding on full-bleed background
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2a78d6' } })
  .composite([{ input: await sharp(src).resize(360, 360).png().toBuffer(), gravity: 'center' }])
  .png().toFile(out('icon-maskable-512.png'));
console.log('icons generated');
