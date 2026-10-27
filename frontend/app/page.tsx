'use client';

/**
 * Public landing page (/). Describes what the workspace does — product copy only, no figures —
 * in the same dark + gold style as the sign-in page. Signed-in visitors go straight to /dashboard.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
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

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  return (
    <div className={s.page}>
      <header className={s.header}>
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
            <div className={s.sectionHead}>
              <span className={s.kicker}>Features</span>
              <h2>Everything the marketing team needs</h2>
              <p>From the first booking to the follow-up message, in one place.</p>
            </div>
            <div className={s.grid3}>
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <article key={title} className={s.card}>
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
            <div className={s.sectionHead}>
              <span className={s.kicker}>How it works</span>
              <h2>From data to the right message</h2>
              <p>Four steps run every day without anyone lifting a finger.</p>
            </div>
            <ol className={s.steps}>
              {STEPS.map(({ title, text }, i) => (
                <li key={title} className={s.step}>
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
        <div className={`${s.wrap} ${s.closingInner}`}>
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
