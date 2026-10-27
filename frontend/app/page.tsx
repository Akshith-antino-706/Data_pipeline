'use client';

/**
 * Public landing page (/). Describes what the workspace does — product copy only, no figures —
 * in the same dark + gold style as the sign-in page. Signed-in visitors go straight to /dashboard.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Mail, MessageCircle, Smartphone, Radio, Target, Route, Users, LayoutTemplate, Globe2, BarChart3,
  Zap, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import s from './landing.module.css';

interface Item { icon: LucideIcon; title: string; text: string }

/** The four channels the journey engine sends on. */
const CHANNELS: { icon: LucideIcon; label: string }[] = [
  { icon: Mail, label: 'Email' },
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: Smartphone, label: 'SMS' },
  { icon: Radio, label: 'RCS' },
];

/** The main areas of the workspace (same names as the app's menu). */
const FEATURES: Item[] = [
  { icon: Target, title: 'Segments', text: 'Group travellers by booking status, product and destination, or build your own rules.' },
  { icon: Route, title: 'Journeys', text: 'Automated multi-step flows with waits and branches, sent on the right channel for each person.' },
  { icon: Users, title: 'Contacts', text: 'One profile per traveller, joining bookings, chats, website activity and messages.' },
  { icon: LayoutTemplate, title: 'Templates', text: 'Email, WhatsApp and SMS templates with personal details filled in for every send.' },
  { icon: Globe2, title: 'Website & links', text: 'See what people do on raynatours.com after a message, with tracked links for every campaign.' },
  { icon: BarChart3, title: 'Performance', text: 'Delivered, opened, clicked and booked for every journey, compared with the period before.' },
];

const STEPS: Item[] = [
  { icon: Zap, title: 'Collect', text: 'Bookings, registrations, chats and website events sync in automatically every day.' },
  { icon: Users, title: 'Unify', text: 'Records are matched into a single contact with their full history.' },
  { icon: Target, title: 'Segment', text: 'Every contact is placed in the right audience as their trip status changes.' },
  { icon: Route, title: 'Engage', text: 'Journeys send the right message at the right moment, and every result is tracked.' },
];

/** Illustration of a journey's shape — no numbers, no real data. */
const FLOW = [
  { icon: Zap, cls: s.nodeTrigger, title: 'Booking made', sub: 'Starts the journey', kind: 'Trigger' },
  { icon: Clock, cls: s.nodeWait, title: 'Wait 1 day', sub: 'Then continue', kind: 'Wait' },
  { icon: Mail, cls: s.nodeEmail, title: 'Trip checklist', sub: 'Personalised email', kind: 'Email' },
  { icon: MessageCircle, cls: s.nodeWa, title: 'Day-before reminder', sub: 'WhatsApp message', kind: 'WhatsApp' },
];

/**
 * Animated hero backdrop: drifting gold glows, dashed flight routes that flow, small planes
 * flying along them and pulsing city points. Pure SVG/CSS (no video), hidden from screen
 * readers, and still when the visitor prefers reduced motion.
 */
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

/**
 * Fades [data-reveal] blocks in as they scroll into view. Only blocks that start BELOW the fold
 * are hidden first, so nothing on screen at load ever flashes or stays blank; without
 * IntersectionObserver, or with reduced motion, everything simply stays visible.
 */
function useReveal(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const els = [...root.querySelectorAll<HTMLElement>('[data-reveal]')]
      .filter(el => el.getBoundingClientRect().top > window.innerHeight);
    els.forEach(el => el.classList.add(s.revealPending));
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add(s.revealed);
        e.target.classList.remove(s.revealPending);
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useReveal(rootRef);
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
        <div className={`${s.wrap} ${s.headerInner}`}>
          <Link href="/" className={s.logoLink} aria-label="Rayna Tours home">
            <img src="/rayna-logo.webp" alt="Rayna Tours" className={s.logo} />
          </Link>
          <nav className={s.nav} aria-label="Page sections">
            <a href="#features">Features</a>
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

            <div className={s.flowCard} aria-label="Example journey">
              <div className={s.flowHead}>
                <span className={s.flowTitle}>Example journey</span>
                <span className={s.flowTag}>Running</span>
              </div>
              <ol className={s.flow}>
                {FLOW.map(({ icon: Icon, cls, title, sub, kind }) => (
                  <li key={title} className={s.node}>
                    <span className={`${s.nodeIcon} ${cls}`} aria-hidden><Icon size={16} /></span>
                    <span className={s.nodeText}><b>{title}</b><span>{sub}</span></span>
                    <span className={s.nodeKind}>{kind}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="features" className={`${s.section} ${s.sectionAlt}`} style={{ scrollMarginTop: 68 }}>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <span className={s.kicker}>Features</span>
              <h2>Everything the marketing team needs</h2>
              <p>From the first booking to the follow-up message, in one place.</p>
            </div>
            <div className={s.grid3}>
              {FEATURES.map(({ icon: Icon, title, text }, i) => (
                <article key={title} className={s.card} data-reveal style={{ '--d': `${(i % 3) * 90}ms` } as React.CSSProperties}>
                  <span className={s.cardIcon} aria-hidden><Icon size={19} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className={s.section} style={{ scrollMarginTop: 68 }}>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <span className={s.kicker}>How it works</span>
              <h2>From data to the right message</h2>
              <p>Four steps run every day without anyone lifting a finger.</p>
            </div>
            <ol className={s.steps}>
              {STEPS.map(({ title, text }, i) => (
                <li key={title} className={s.step} data-reveal style={{ '--d': `${i * 110}ms` } as React.CSSProperties}>
                  <span className={s.stepNum}>Step {i + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
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
