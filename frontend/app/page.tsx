'use client';

/**
 * Public landing page (/). Describes what the workspace does — product copy only, no figures —
 * in the same dark + gold style as the sign-in page. Signed-in visitors go straight to /dashboard.
 *
 * Motion: an animated hero backdrop, a looping "set up a journey" demo, data-source tiles that
 * fly in and tick, a schedule timeline that draws itself, and scroll reveals. Everything is
 * CSS/SVG; visitors who prefer reduced motion get the finished, still picture.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Mail, MessageCircle, Smartphone, Radio, Target, Route, Users, LayoutTemplate, Globe2, BarChart3,
  Check, Receipt, UserPlus, MessagesSquare, Inbox, MousePointerClick, RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useAuth } from '@/context/AuthContext';
import s from './landing.module.css';

interface Item { icon: LucideIcon; title: string; text: string; tint?: string }

/** The four channels the journey engine sends on. */
const CHANNELS: { icon: LucideIcon; label: string }[] = [
  { icon: Mail, label: 'Email' },
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: Smartphone, label: 'SMS' },
  { icon: Radio, label: 'RCS' },
];

/** The main areas of the workspace (same names as the app's menu). */
const FEATURES: Item[] = [
  { icon: Target, title: 'Segments', tint: 'gold', text: 'Group travellers by booking status, product and destination, or build your own rules.' },
  { icon: Route, title: 'Journeys', tint: 'blue', text: 'Automated multi-step flows with waits and branches, sent on the right channel for each person.' },
  { icon: Users, title: 'Contacts', tint: 'green', text: 'One profile per traveller, joining bookings, chats, website activity and messages.' },
  { icon: LayoutTemplate, title: 'Templates', tint: 'rose', text: 'Email, WhatsApp and SMS templates with personal details filled in for every send.' },
  { icon: Globe2, title: 'Website & links', tint: 'violet', text: 'See what people do on raynatours.com after a message, with tracked links for every campaign.' },
  { icon: BarChart3, title: 'Performance', tint: 'teal', text: 'Delivered, opened, clicked and booked for every journey, compared with the period before.' },
];

/** Where the contact data comes from (the real sources the pipeline syncs). */
const SOURCES: { icon: LucideIcon; label: string }[] = [
  { icon: Receipt, label: 'Bookings' },
  { icon: UserPlus, label: 'Sign-ups' },
  { icon: MessagesSquare, label: 'WhatsApp chats' },
  { icon: Inbox, label: 'Email enquiries' },
  { icon: MousePointerClick, label: 'Website visits' },
  { icon: Mail, label: 'Message results' },
];

/** The real daily schedule the backend runs (Dubai time). */
const SCHEDULE: { time: string; title: string; text: string; tag: string; tone: string }[] = [
  { time: '00:30', title: 'New sign-ups join', text: 'Affiliate, guest and agent registrations are added to the contact list.', tag: 'Contacts', tone: 'green' },
  { time: '01:00', title: "Yesterday's bookings arrive", text: 'Tours, hotels, visas, flights and packages from the Rayna billing system.', tag: 'Bookings', tone: 'gold' },
  { time: '02:00', title: 'Audiences refresh', text: 'Every contact moves to the right segment as trips start and end.', tag: 'Segments', tone: 'violet' },
  { time: 'Every 5 min', title: 'Journeys send', text: 'Each person gets their next message on time, on their channel.', tag: 'Journeys', tone: 'blue' },
  { time: 'Every 30 min', title: 'Results update', text: 'Opens, clicks and bookings flow into Performance.', tag: 'Performance', tone: 'rose' },
];

// ── Hero backdrop ───────────────────────────────────────────────────────────
const ROUTES = [
  { id: 'r1', d: 'M -80 520 C 260 360, 560 620, 880 400 S 1320 150, 1540 230', dur: '16s', begin: '0s' },
  { id: 'r2', d: 'M -80 170 C 240 90, 520 300, 820 190 S 1260 30, 1540 110', dur: '21s', begin: '-7s' },
  { id: 'r3', d: 'M 140 760 C 380 540, 700 560, 1010 640 S 1320 520, 1540 590', dur: '26s', begin: '-13s' },
];
// Points on the routes, kept to the right of the headline so nothing pulses over the text.
const CITIES = [
  { x: 880, y: 400, delay: '0s' }, { x: 820, y: 190, delay: '1.2s' }, { x: 1010, y: 640, delay: '2.1s' },
];

function HeroBackdrop({ idPrefix = 'hero' }: { idPrefix?: string }) {
  const gid = `${idPrefix}-routeFade`;
  return (
    <div className={s.heroBg} aria-hidden>
      <span className={`${s.orb} ${s.orbA}`} />
      <span className={`${s.orb} ${s.orbB}`} />
      <span className={`${s.orb} ${s.orbC}`} />
      <svg className={s.routes} viewBox="0 0 1440 700" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#C9A96E" stopOpacity="0" />
            <stop offset="0.2" stopColor="#C9A96E" stopOpacity="0.55" />
            <stop offset="0.8" stopColor="#C9A96E" stopOpacity="0.55" />
            <stop offset="1" stopColor="#C9A96E" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ROUTES.map(r => (
          <g key={r.id}>
            <path id={`${idPrefix}-${r.id}`} d={r.d} className={s.route} stroke={`url(#${gid})`} />
            <g className={s.moving}>
              {/* paper-plane glyph, nose pointing along +x so rotate="auto" follows the route */}
              <path d="M -9 -6 L 11 0 L -9 6 L -5 0 Z" className={s.plane} />
              <animateMotion dur={r.dur} begin={r.begin} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${idPrefix}-${r.id}`} />
              </animateMotion>
            </g>
          </g>
        ))}
        {CITIES.map(c => (
          <g key={`${c.x}-${c.y}`} transform={`translate(${c.x} ${c.y})`}>
            <circle r="3.5" className={s.cityDot} />
            <circle r="4" className={`${s.cityRing} ${s.moving}`}>
              <animate attributeName="r" values="4;18" dur="3s" begin={c.delay} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="3s" begin={c.delay} repeatCount="indefinite" />
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Hero demo: a journey being set up, on a loop ────────────────────────────
const DEMO_CARDS: { icon: LucideIcon; cls: string; title: string; sub: string }[] = [
  { icon: Mail, cls: s.dEmail, title: 'Email', sub: 'Trip checklist' },
  { icon: MessageCircle, cls: s.dWa, title: 'WhatsApp', sub: 'Day-before reminder' },
  { icon: Smartphone, cls: s.dSms, title: 'SMS', sub: 'Pickup details' },
];
const CONFETTI = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { x: Math.round(Math.cos(a) * 90), y: Math.round(Math.sin(a) * 46), c: ['#E8CF9C', '#7FD3A6', '#93C5FD', '#F9A8B4'][i % 4] };
});

function HeroDemo() {
  return (
    <div className={s.demo} aria-label="Example: setting up a journey">
      <div className={s.demoPrompt}>
        <span className={s.demoMark} aria-hidden />
        <span className={s.demoTyped}>Welcome every new booking</span>
        <span className={s.demoOk} aria-hidden><Check size={13} strokeWidth={3} /></span>
      </div>

      <div className={s.demoCards}>
        {DEMO_CARDS.map(({ icon: Icon, cls, title, sub }, i) => (
          <div key={title} className={s.demoCard} style={{ '--i': i } as CSSProperties}>
            <span className={s.demoReady}><Check size={10} strokeWidth={3} aria-hidden /> Ready</span>
            <span className={`${s.demoIcon} ${cls}`} aria-hidden><Icon size={16} /></span>
            <b>{title}</b>
            <span>{sub}</span>
          </div>
        ))}
      </div>

      <div className={s.demoFoot}>
        <span className={s.demoBtn}>
          <span className={s.demoBtnStart}>Start journey</span>
          <span className={s.demoBtnLive}><span className={s.liveDot} aria-hidden /> Live</span>
          {CONFETTI.map((c, i) => (
            <span key={i} className={s.confetti} aria-hidden
              style={{ '--x': `${c.x}px`, '--y': `${c.y}px`, background: c.c } as CSSProperties} />
          ))}
        </span>
        <svg className={s.cursor} viewBox="0 0 24 24" aria-hidden>
          <path d="M4 2 L4 19 L8.5 14.8 L11.6 21.5 L14.4 20.3 L11.3 13.7 L17.5 13.4 Z" fill="#fff" stroke="#121820" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>

      <div className={s.demoCaptions} aria-hidden>
        <span className={s.cap1}>Pick who it&apos;s for</span>
        <span className={s.cap2}>Messages ready on every channel</span>
        <span className={s.cap3}>Live with one click</span>
      </div>
    </div>
  );
}

/**
 * Scroll motion:
 *  - [data-reveal] blocks that start BELOW the fold fade/slide in when they scroll into view
 *    (blocks visible at load are left alone, so nothing flashes or stays blank).
 *  - [data-anim] blocks get `inView` the first time they are seen, which starts their sequence.
 * Without IntersectionObserver, or with reduced motion, everything just shows in its final state.
 */
function useScrollMotion(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const anim = [...root.querySelectorAll<HTMLElement>('[data-anim]')];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof IntersectionObserver === 'undefined' || reduced) {
      anim.forEach(el => el.classList.add(s.inView));
      return undefined;
    }
    const reveal = [...root.querySelectorAll<HTMLElement>('[data-reveal]')]
      .filter(el => el.getBoundingClientRect().top > window.innerHeight);
    reveal.forEach(el => el.classList.add(s.revealPending));
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        if (el.hasAttribute('data-anim')) el.classList.add(s.inView);
        if (el.classList.contains(s.revealPending)) { el.classList.add(s.revealed); el.classList.remove(s.revealPending); }
        io.unobserve(el);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    [...new Set([...reveal, ...anim])].forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useScrollMotion(rootRef);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  return (
    <div className={s.page} ref={rootRef}>
      <header className={scrolled ? `${s.header} ${s.headerScrolled}` : s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.logoLink} aria-label="Rayna Tours home">
            <img src="/rayna-logo.webp" alt="Rayna Tours" className={s.logo} />
          </Link>
          <nav className={s.nav} aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#sources">Your data</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          <Link href="/login" className={`${s.btn} ${s.btnGold}`}>
            Sign in <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </header>

      <main>
        <section className={s.hero}>
          <HeroBackdrop />
          <div className={`${s.wrap} ${s.heroInner}`}>
            <div className={s.heroCopy}>
              <span className={s.eyebrow}>Marketing workspace</span>
              <h1>Reach every traveller <em>at the right moment.</em></h1>
              <p className={s.lead}>
                Rayna&apos;s marketing workspace brings bookings, contacts and messages together, so the team can plan
                journeys, send on every channel and see what works.
              </p>
              <div className={s.ctaRow}>
                <Link href="/login" className={`${s.btn} ${s.btnGold} ${s.btnLg}`}>
                  Sign in to the workspace <ArrowRight size={16} aria-hidden />
                </Link>
                <a href="#features" className={`${s.btn} ${s.btnGhostDark} ${s.btnLg}`}>See what&apos;s inside</a>
              </div>
              <div className={s.channelRow} aria-label="Channels">
                {CHANNELS.map(({ icon: Icon, label }) => (
                  <span key={label} className={s.channelPill}><Icon size={13} aria-hidden /> {label}</span>
                ))}
              </div>
            </div>
            <HeroDemo />
          </div>
        </section>

        <section id="features" className={`${s.section} ${s.sectionAlt}`}>
          <div className={s.aurora} aria-hidden>
            <span className={s.auA} /><span className={s.auB} /><span className={s.auC} />
          </div>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <span className={s.kicker}>Features</span>
              <h2>Everything the marketing team needs</h2>
              <p>From the first booking to the follow-up message, in one place.</p>
            </div>
            <div className={s.grid3}>
              {FEATURES.map(({ icon: Icon, title, text, tint }, i) => (
                <article key={title} className={s.card} data-tint={tint} data-reveal
                  style={{ '--d': `${(i % 3) * 90}ms` } as CSSProperties}>
                  <span className={s.cardIcon} aria-hidden><Icon size={19} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="sources" className={s.section}>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <span className={s.kicker}>Your data</span>
              <h2>Every source, one contact</h2>
              <p>Bookings, sign-ups, chats and website visits come together automatically.</p>
            </div>
            <div className={s.hub} data-anim>
              <span className={s.hubCore}>
                <RefreshCw size={18} aria-hidden className={s.hubSpin} />
                <img src="/rayna-logo.webp" alt="" className={s.hubLogo} />
              </span>
              <ul className={s.tiles}>
                {SOURCES.map(({ icon: Icon, label }, i) => (
                  <li key={label} className={s.tile} style={{ '--i': i } as CSSProperties}>
                    <span className={s.tileTick} aria-hidden><Check size={10} strokeWidth={3} /></span>
                    <span className={s.tileIcon} aria-hidden><Icon size={18} /></span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how-it-works" className={`${s.section} ${s.sectionAlt}`}>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <span className={s.kicker}>How it works</span>
              <h2>Runs on its own, every day</h2>
              <p>The schedule the workspace keeps (Dubai time), so the team can focus on the messages.</p>
            </div>
            <ol className={s.timeline} data-anim>
              {SCHEDULE.map(({ time, title, text, tag, tone }, i) => (
                <li key={title} className={s.tItem} data-tone={tone} style={{ '--i': i } as CSSProperties}>
                  <span className={s.tTime}>{time}</span>
                  <span className={s.tDot} aria-hidden />
                  <div className={s.tCard}>
                    <h3>{title}</h3>
                    <p>{text}</p>
                    <span className={s.tTag}>{tag}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className={s.closing}>
        <HeroBackdrop idPrefix="closing" />
        <div className={`${s.wrap} ${s.closingInner}`} data-reveal>
          <h2>Ready when you are</h2>
          <p>Sign in with your Rayna work email.</p>
          <Link href="/login" className={`${s.btn} ${s.btnGold} ${s.btnLg}`}>
            Sign in <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <div className={s.footer}>
          <div className={`${s.wrap} ${s.footerInner}`}>
            <span>© {new Date().getFullYear()} Rayna Tours</span>
            <span>Internal use only</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
