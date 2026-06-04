#!/usr/bin/env node
/**
 * render_social_post.js
 *
 * Renders any of the 1080×1350 social-post templates and emits HTML + PNG.
 *
 * Templates:
 *   --template destination   (default)  Destination opener with coupon.
 *   --template generic-hero              Day 1 carousel card 1: "Your dream holiday starts here"
 *   --template generic-category          Day 1 carousel cards 2-5: ACTIVITIES / CRUISES / HOLIDAYS / VISAS
 *
 * destination flags:
 *   --city       Required. City to pick the hero activity from.
 *   --code       Required. Coupon code (uppercased automatically).
 *   --discount   Required. Numeric discount %, e.g. 20.
 *   --product-id Optional. Pin a specific product_id; bypasses city pick.
 *   --title      Optional. Override the big headline (else "{COUNTRY} {CITY}").
 *   --subtitle   Optional. Override the script-font subtitle.
 *
 * generic-hero flags:
 *   --headline   Optional. Override "Your dream holiday starts here".
 *   --image      Optional. Override hero background image URL.
 *
 * generic-category flags:
 *   --category    Required. activities | cruises | holidays | visas (or a custom string).
 *   --description Optional. Override the preset tagline.
 *   --image       Optional. Override hero background image URL.
 *
 * Common:
 *   --out  Output directory (default mail_templates/social/output).
 *
 * PNG rendering requires puppeteer.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const {
  renderDestinationPost,
  renderActivityPost,
  renderCtaPost,
  renderGenericHero,
  renderGenericCategory,
} = await import('../src/services/SocialPostRenderer.js');

const DEFAULT_OUT = path.join(REPO_ROOT, 'mail_templates/social/output');

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

async function maybeRenderPng(htmlPath, pngPath) {
  let puppeteer = null;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    return { ok: false, reason: 'puppeteer-not-installed' };
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: pngPath, omitBackground: false, fullPage: false });
    return { ok: true };
  } finally {
    await browser.close();
  }
}

function usage() {
  console.error('Usage:');
  console.error('  --template destination       --city <City> --code <CODE> --discount <number>');
  console.error('  --template activity          --city <City> [--rank N] | --product-id <id>  [--title ...] [--description ...] [--image <url>]');
  console.error('  --template cta               --city <City> [--headline ...] [--sub ...] [--button-text ...] [--image <url>]');
  console.error('  --template generic-hero      [--headline "..."] [--image <url>]');
  console.error('  --template generic-category  --category <activities|cruises|holidays|visas> [--description "..."] [--image <url>]');
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = args.template || 'destination';

  let html;
  let stem;

  if (template === 'destination') {
    const city          = args.city;
    const couponCode    = args.code;
    const discountValue = args.discount;
    if (!city || !couponCode || discountValue == null || discountValue === 'true') usage();

    html = await renderDestinationPost({
      city,
      couponCode,
      discountValue: Number(discountValue),
      productId: args['product-id'] ? Number(args['product-id']) : undefined,
      title:    args.title,
      subtitle: args.subtitle,
    });
    stem = `destination-${slug(city)}-${slug(couponCode)}`;

  } else if (template === 'activity') {
    if (!args.city && !args['product-id']) usage();
    const rankNum = args.rank ? Math.max(1, Number(args.rank)) : 1;
    html = await renderActivityPost({
      city:        args.city,
      rank:        rankNum,
      productId:   args['product-id'] ? Number(args['product-id']) : undefined,
      title:       args.title,
      description: args.description,
      heroImage:   args.image,
    });
    const stemKey = args['product-id']
      ? `pid-${args['product-id']}`
      : `${slug(args.city)}-rank${rankNum}`;
    stem = `activity-${stemKey}`;

  } else if (template === 'cta') {
    html = await renderCtaPost({
      city:       args.city,
      headline:   args.headline,
      sub:        args.sub,
      buttonText: args['button-text'],
      heroImage:  args.image,
      productId:  args['product-id'] ? Number(args['product-id']) : undefined,
    });
    stem = `cta-${slug(args.city || 'generic')}`;

  } else if (template === 'generic-hero') {
    html = await renderGenericHero({
      headline:  args.headline,
      heroImage: args.image,
    });
    stem = 'generic-hero';

  } else if (template === 'generic-category') {
    if (!args.category || args.category === 'true') usage();
    html = await renderGenericCategory({
      category:    args.category,
      description: args.description,
      heroImage:   args.image,
    });
    stem = `generic-category-${slug(args.category)}`;

  } else {
    console.error(`Unknown template: ${template}`);
    usage();
  }

  const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
  await fs.mkdir(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `${stem}.html`);
  const pngPath  = path.join(outDir, `${stem}.png`);

  await fs.writeFile(htmlPath, html, 'utf8');
  console.log(`✓ HTML  → ${htmlPath}`);

  const png = await maybeRenderPng(htmlPath, pngPath);
  if (png.ok) {
    console.log(`✓ PNG   → ${pngPath}`);
  } else if (png.reason === 'puppeteer-not-installed') {
    console.log('⚠ Skipped PNG: puppeteer not installed. Run `npm i puppeteer` in backend/, then re-run.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
