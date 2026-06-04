#!/usr/bin/env node
/**
 * render_carousel.js
 *
 * Orchestrator that emits an entire Day 1 or Day 2 social carousel in one shot.
 * Shares one puppeteer browser across all renders (~2-3× faster than calling
 * render_social_post.js N times).
 *
 * Day 1 (5 generic cards):
 *   node backend/scripts/render_carousel.js --day 1
 *
 * Day 2 (destination + N activities + CTA — for a specific city):
 *   node backend/scripts/render_carousel.js --day 2 --city Bangkok --code BKK1024 --discount 20 [--activities 3]
 *
 * Output: mail_templates/social/output/day{N}-{city|generic}/<NN>-<stem>.png
 * The NN prefix (01-, 02-, ...) keeps slides ordered when uploaded as a carousel.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const {
  renderDestinationPost,
  renderActivityPost,
  renderCtaPost,
  renderGenericHero,
  renderGenericCategory,
  renderCityCard,
  renderDayCard,
  renderClosingBanner,
  renderCruiseOpener,
  renderCruiseDayCard,
  renderCruiseClosing,
  renderVisaHero,
  renderVisaPromo,
  renderVisaCountry,
  renderVisaClosing,
  renderWaGenericHero,
  renderWaGenericCategory,
} = await import('../src/services/SocialPostRenderer.js');

const DEFAULT_OUT    = path.join(REPO_ROOT, 'mail_templates/social/output');
const WHATSAPP_OUT   = path.join(REPO_ROOT, 'mail_templates/wa_templates/output');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = val;
  }
  return out;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pad2(n) { return String(n).padStart(2, '0'); }

async function buildSlideList(args) {
  const day = args.day;
  const carousel = args.carousel;

  // ── activities-journey: N-card activity carousel for one city ──────
  if (carousel === 'activities-journey') {
    const { city } = args;
    if (!city) throw new Error('--carousel activities-journey requires --city <City>');
    const n = args.activities ? Math.max(1, Number(args.activities)) : 3;
    const slides = [];
    for (let r = 1; r <= n; r++) {
      slides.push({
        stem: `activity-${slug(city)}-rank${r}`,
        build: () => renderActivityPost({ city, rank: r }),
      });
    }
    return slides;
  }

  // ── generic-journey: 5-card WhatsApp generic carousel ──────────────
  if (carousel === 'generic-journey') {
    return [
      { stem: 'generic-hero',       build: () => renderWaGenericHero() },
      { stem: 'generic-activities', build: () => renderWaGenericCategory({ category: 'activities' }) },
      { stem: 'generic-cruises',    build: () => renderWaGenericCategory({ category: 'cruises' }) },
      { stem: 'generic-holidays',   build: () => renderWaGenericCategory({ category: 'holidays' }) },
      { stem: 'generic-visas',      build: () => renderWaGenericCategory({ category: 'visas' }) },
    ];
  }

  // ── visa-journey: 4-card visa WhatsApp carousel ─────────────────────
  if (carousel === 'visa-journey') {
    const country = args.country;
    if (!country) throw new Error('--carousel visa-journey requires --country <Country>');
    return [
      { stem: `visa-hero-${slug(country)}`,    build: () => renderVisaHero({ country }) },
      { stem: `visa-promo-${slug(country)}`,   build: () => renderVisaPromo({ country }) },
      { stem: `visa-country-${slug(country)}`, build: () => renderVisaCountry({ country }) },
      { stem: `visa-closing`,                  build: () => renderVisaClosing() },
    ];
  }

  // ── cruise-journey: 5-card cruise carousel (Day 4) ─────────────────
  if (carousel === 'cruise-journey') {
    const days = args.days ? Math.max(1, Math.min(5, Number(args.days))) : 3;
    const slides = [
      { stem: 'cruise-opener', build: () => renderCruiseOpener() },
    ];
    for (let d = 1; d <= days; d++) {
      slides.push({
        stem: `cruise-day${d}`,
        build: () => renderCruiseDayCard({ dayNumber: d }),
      });
    }
    slides.push({
      stem: 'cruise-closing',
      build: () => renderCruiseClosing(),
    });
    return slides;
  }

  // ── city-journey: 5-card editorial carousel ────────────────────────
  if (carousel === 'city-journey') {
    const { city } = args;
    if (!city) throw new Error('--carousel city-journey requires --city <City>');
    const days = args.days ? Math.max(1, Math.min(5, Number(args.days))) : 3;

    const slides = [
      { stem: `city-${slug(city)}`, build: () => renderCityCard({ city }) },
    ];
    for (let d = 1; d <= days; d++) {
      slides.push({
        stem: `day${d}`,
        build: () => renderDayCard({ city, dayNumber: d }),
      });
    }
    slides.push({
      stem: `closing-${slug(city)}`,
      build: () => renderClosingBanner({ city }),
    });
    return slides;
  }

  if (day === '1') {
    return [
      { stem: 'hero',                build: () => renderGenericHero() },
      { stem: 'activities',          build: () => renderGenericCategory({ category: 'activities' }) },
      { stem: 'cruises',             build: () => renderGenericCategory({ category: 'cruises' }) },
      { stem: 'holidays',            build: () => renderGenericCategory({ category: 'holidays' }) },
      { stem: 'visas',               build: () => renderGenericCategory({ category: 'visas' }) },
    ];
  }

  if (day === '2') {
    const { city, code, discount } = args;
    if (!city || !code || discount == null || discount === 'true') {
      throw new Error('Day 2 requires --city, --code, --discount');
    }
    const nActivities = args.activities ? Math.max(1, Number(args.activities)) : 3;

    const slides = [
      {
        stem: `destination-${slug(city)}`,
        build: () => renderDestinationPost({
          city, couponCode: code, discountValue: Number(discount),
        }),
      },
    ];
    for (let r = 1; r <= nActivities; r++) {
      slides.push({
        stem: `activity-rank${r}`,
        build: () => renderActivityPost({ city, rank: r }),
      });
    }
    slides.push({
      stem: `cta-${slug(city)}`,
      build: () => renderCtaPost({ city }),
    });
    return slides;
  }

  throw new Error(`Unknown --day: ${day} (expected 1 or 2)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const day = args.day;
  if (!day && !args.carousel) {
    console.error('Usage:');
    console.error('  --day 1                                                  # Day 1 generic carousel');
    console.error('  --day 2 --city <City> --code <CODE> --discount <N> [--activities 3]');
    console.error('  --carousel city-journey --city <City> [--days 3]         # editorial 5-card variant');
    console.error('  --carousel cruise-journey [--days 3]                     # cruise 5-card variant (Day 4)');
    console.error('  --carousel visa-journey --country <Country>              # WhatsApp visa 4-card carousel');
    console.error('  --carousel generic-journey                                # WhatsApp generic 5-card carousel');
    process.exit(2);
  }

  const slides = await buildSlideList(args);

  // WhatsApp carousels emit to a separate root so they don't intermix with Instagram social posts.
  const isWhatsApp = args.carousel === 'visa-journey' || args.carousel === 'generic-journey' || args.carousel === 'activities-journey';
  const dirName = args.carousel === 'visa-journey'
    ? `visa-journey-${slug(args.country)}`
    : args.carousel === 'generic-journey'
      ? 'generic-journey'
    : args.carousel === 'activities-journey'
      ? `activities-${slug(args.city)}`
    : args.carousel === 'cruise-journey'
      ? 'cruise-journey'
      : args.carousel === 'city-journey'
        ? `city-journey-${slug(args.city)}`
        : day === '1'
          ? 'day1-generic'
          : `day2-${slug(args.city)}`;
  const outRoot = isWhatsApp ? WHATSAPP_OUT : DEFAULT_OUT;
  const outDir  = args.out ? path.resolve(args.out) : path.join(outRoot, dirName);
  await fs.mkdir(outDir, { recursive: true });

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.error('puppeteer is required. Run `npm i puppeteer` in backend/.');
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const stem  = `${pad2(i + 1)}-${slide.stem}`;
      const htmlPath = path.join(outDir, `${stem}.html`);
      const pngPath  = path.join(outDir, `${stem}.png`);

      const html = await slide.build();
      await fs.writeFile(htmlPath, html, 'utf8');

      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
      await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.screenshot({ path: pngPath, omitBackground: false, fullPage: false });
      await page.close();

      console.log(`✓ ${stem}.png`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nCarousel ready in: ${outDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
