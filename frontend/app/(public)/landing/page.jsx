'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useInView } from 'framer-motion';
import { useRef, useEffect } from 'react';
import {
  Target, GitBranch, BarChart3, ArrowRight, Users, Mail, MessageSquare,
  Smartphone, Bell, Zap, Shield, Globe, Layers, ChevronRight, CheckCircle2,
  Sparkles, TrendingUp
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/* ── Animations ──────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] } },
};
const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5 } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } },
};

/* ── Scroll-triggered section ────────────────────── */
function Anim({ children, className = '', style = {}, delay = 0, id }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.section
      ref={ref}
      id={id}
      className={className}
      style={style}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: delay } } }}
    >
      {children}
    </motion.section>
  );
}

/* ── Data ────────────────────────────────────────── */
const capabilities = [
  { icon: Target, title: 'Smart Segmentation', desc: '28-segment engine classifying 1.3M+ contacts by lifecycle, behavior & booking history' },
  { icon: GitBranch, title: 'Journey Builder', desc: 'Visual flow builder for multi-step automated journeys with conditional branching' },
  { icon: BarChart3, title: 'Real-time Analytics', desc: 'Live dashboards with KPIs, conversion funnels & campaign performance metrics' },
  { icon: Users, title: 'Unified Contacts', desc: 'Single customer view merging CRM, tours, hotels, visas & flight bookings' },
  { icon: Layers, title: 'Content Studio', desc: 'Create & manage email templates, SMS copy, and WhatsApp messages in one place' },
  { icon: Shield, title: 'Data Pipeline', desc: 'Automated sync from BigQuery, MySQL & Rayna API with real-time monitoring' },
];

const channels = [
  { icon: Mail, label: 'Email' },
  { icon: MessageSquare, label: 'WhatsApp' },
  { icon: Smartphone, label: 'SMS' },
  { icon: Bell, label: 'Push' },
  { icon: Globe, label: 'RCS' },
];

const stats = [
  { value: '1.3M+', label: 'Unified Contacts' },
  { value: '28', label: 'Smart Segments' },
  { value: '5', label: 'Channels' },
  { value: '24/7', label: 'Automated Sync' },
];

const workflow = [
  { step: '01', title: 'Ingest', desc: 'Data flows in from BigQuery, MySQL, and Rayna APIs automatically every day' },
  { step: '02', title: 'Unify', desc: 'Contacts are deduplicated and merged into a single customer profile with full history' },
  { step: '03', title: 'Segment', desc: '28-segment classification engine categorizes every contact by lifecycle stage' },
  { step: '04', title: 'Activate', desc: 'Trigger personalized journeys across Email, SMS, WhatsApp, Push & RCS' },
];

const bullets = [
  'Conditional branching per channel',
  'Send time optimization',
  'A/B testing built-in',
  'Delivery & open tracking',
  'Dynamic content personalization',
  'Automatic fallback channels',
];

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (isAuthenticated) router.replace('/');
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: '#ffffff', color: '#111111' }}>

      {/* ═══════ HEADER ═══════ */}
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-4"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #f0f0f0' }}
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <Link href="/landing" className="flex items-center no-underline">
          <img src="/rayna-logo.webp" alt="Rayna Tours" className="h-9 object-contain" />
        </Link>
        <div className="hidden md:flex items-center gap-8" style={{ flexDirection: 'row' }}>
          <a href="#features" className="text-[13px] font-medium no-underline transition-colors duration-200 hover:text-black" style={{ color: '#666' }}>Features</a>
          <a href="#how-it-works" className="text-[13px] font-medium no-underline transition-colors duration-200 hover:text-black" style={{ color: '#666' }}>How It Works</a>
          <a href="#channels" className="text-[13px] font-medium no-underline transition-colors duration-200 hover:text-black" style={{ color: '#666' }}>Channels</a>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-[13px] font-semibold no-underline transition-all duration-200 hover:-translate-y-0.5"
          style={{ background: '#111', color: '#fff' }}
        >
          Sign In <ArrowRight size={14} />
        </Link>
      </motion.header>

      {/* ═══════ 1. HERO ═══════ */}
      <section className="relative min-h-screen flex items-center justify-center px-6 py-20 pt-28 overflow-hidden">
        <motion.div className="relative z-10 text-center max-w-[860px] mx-auto" variants={stagger} initial="hidden" animate="show">
          {/* Logo */}
          <motion.div variants={fadeUp} className="flex justify-center mb-8">
            <img src="/rayna-logo.webp" alt="Rayna Tours" className="h-20 object-contain" />
          </motion.div>

          {/* Chip */}
          <motion.div variants={fadeUp} className="flex justify-center mb-6">
            <span
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest"
              style={{ border: '1px solid #e5e5e5', background: '#fafafa', color: '#111' }}
            >
              <Sparkles size={12} />
              Tourism Marketing Intelligence
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={fadeUp}
            className="font-bold tracking-tight leading-none mb-5 text-center"
            style={{ fontSize: 'clamp(36px, 6vw, 72px)', letterSpacing: '-2px', color: '#111' }}
          >
            Your Customers,<br />
            <span style={{ color: '#111' }}>One Platform</span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            variants={fadeUp}
            className="leading-relaxed mx-auto mb-10 text-center"
            style={{ fontSize: 'clamp(15px, 2vw, 19px)', maxWidth: 580, color: '#555' }}
          >
            Unify 1.3 million contacts, automate omnichannel journeys, and turn tourism data into revenue — all from a single dashboard.
          </motion.p>

          {/* CTAs */}
          <motion.div variants={fadeUp} className="flex flex-wrap gap-3.5 justify-center items-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[15px] font-semibold no-underline transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: '#111', color: '#fff' }}
            >
              Get Started <ArrowRight size={18} />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[15px] font-medium no-underline transition-all duration-200 hover:bg-black/5"
              style={{ color: '#555', border: '1px solid #e5e5e5' }}
            >
              Explore Features <ChevronRight size={16} />
            </a>
          </motion.div>

          {/* Channel icons row */}
          <motion.div variants={fadeUp} className="mt-16 flex items-center justify-center gap-8 flex-wrap">
            {channels.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#f5f5f5', color: '#333' }}>
                  <Icon size={18} />
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#999' }}>{label}</span>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="w-6 h-9 rounded-full flex justify-center pt-2" style={{ border: '2px solid #ddd' }}>
            <div className="w-1 h-2 rounded-full" style={{ background: '#999' }} />
          </div>
        </motion.div>
      </section>

      {/* ═══════ 2. STATS ═══════ */}
      <Anim className="py-16 px-6" style={{ background: '#fafafa', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <div className="max-w-[1000px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map(({ value, label }) => (
            <motion.div key={label} variants={fadeUp} className="text-center">
              <div className="font-bold mb-1 leading-none" style={{ fontSize: 'clamp(28px, 4vw, 44px)', color: '#111' }}>{value}</div>
              <div className="text-[11px] uppercase tracking-widest font-medium" style={{ color: '#999' }}>{label}</div>
            </motion.div>
          ))}
        </div>
      </Anim>

      {/* ═══════ 3. CAPABILITIES ═══════ */}
      <Anim className="py-24 px-6" style={{ background: '#fff' }} delay={0.05}>
        <div id="features" className="max-w-[1100px] mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ background: '#f5f5f5', color: '#333' }}>
              <Zap size={11} /> Capabilities
            </span>
            <h2 className="font-bold mb-3 text-center" style={{ fontSize: 'clamp(26px, 4vw, 42px)', letterSpacing: '-0.5px', color: '#111' }}>
              Everything You Need
            </h2>
            <p className="text-[15px] leading-relaxed max-w-[500px] mx-auto text-center" style={{ color: '#666' }}>
              From data ingestion to campaign execution — a complete marketing automation stack for tourism.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {capabilities.map(({ icon: Icon, title, desc }) => (
              <motion.div
                key={title}
                variants={scaleIn}
                className="group p-7 rounded-2xl border text-left transition-all duration-300 hover:-translate-y-1"
                style={{ background: '#fff', borderColor: '#eee' }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: '#f5f5f5', color: '#333' }}
                >
                  <Icon size={22} />
                </div>
                <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: '#111' }}>{title}</h3>
                <p className="text-[13px] leading-relaxed" style={{ color: '#666' }}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Anim>

      {/* ═══════ 4. HOW IT WORKS ═══════ */}
      <Anim id="how-it-works" className="py-24 px-6" style={{ background: '#fafafa', scrollMarginTop: 80 }} delay={0.05}>
        <div className="max-w-[900px] mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ background: '#f0f0f0', color: '#333' }}>
              <TrendingUp size={11} /> How It Works
            </span>
            <h2 className="font-bold mb-3 text-center" style={{ fontSize: 'clamp(26px, 4vw, 42px)', letterSpacing: '-0.5px', color: '#111' }}>
              Data to Action in 4 Steps
            </h2>
            <p className="text-[15px] leading-relaxed max-w-[480px] mx-auto text-center" style={{ color: '#666' }}>
              From raw data sources to personalized customer journeys — fully automated.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-4">
            {workflow.map(({ step, title, desc }) => (
              <motion.div
                key={step}
                variants={fadeUp}
                className="flex gap-5 p-6 rounded-2xl border text-left transition-all duration-200"
                style={{ background: '#fff', borderColor: '#eee' }}
              >
                <div
                  className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold"
                  style={{ background: '#111', color: '#fff' }}
                >
                  {step}
                </div>
                <div>
                  <h3 className="text-base font-semibold mb-1" style={{ color: '#111' }}>{title}</h3>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#666' }}>{desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Anim>

      {/* ═══════ 5. CHANNELS ═══════ */}
      <Anim id="channels" className="py-24 px-6" style={{ background: '#fff', scrollMarginTop: 80 }} delay={0.05}>
        <div className="max-w-[900px] mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ background: '#f5f5f5', color: '#333' }}>
              <Globe size={11} /> Omnichannel
            </span>
            <h2 className="font-bold mb-3 text-center" style={{ fontSize: 'clamp(26px, 4vw, 42px)', letterSpacing: '-0.5px', color: '#111' }}>
              Reach Customers Everywhere
            </h2>
            <p className="text-[15px] leading-relaxed max-w-[480px] mx-auto text-center" style={{ color: '#666' }}>
              One journey, multiple channels. Engage customers on their preferred platform.
            </p>
          </motion.div>

          <div className="flex flex-wrap justify-center gap-3.5">
            {channels.map(({ icon: Icon, label }) => (
              <motion.div
                key={label}
                variants={scaleIn}
                className="flex items-center gap-3.5 px-6 py-4 rounded-2xl border min-w-[160px] transition-all duration-200 hover:-translate-y-0.5"
                style={{ background: '#fff', borderColor: '#eee' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#f5f5f5', color: '#333' }}>
                  <Icon size={20} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: '#111' }}>{label}</div>
                  <div className="text-[11px]" style={{ color: '#999' }}>Automated</div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Bullets */}
          <motion.div variants={fadeUp} className="mt-12 grid sm:grid-cols-2 gap-2.5 max-w-[560px] mx-auto">
            {bullets.map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-[13px]" style={{ color: '#555' }}>
                <CheckCircle2 size={15} style={{ color: '#111', flexShrink: 0 }} />
                {item}
              </div>
            ))}
          </motion.div>
        </div>
      </Anim>

      {/* ═══════ 6. CTA FOOTER ═══════ */}
      <Anim className="py-24 px-6 relative overflow-hidden" style={{ background: '#fafafa', borderTop: '1px solid #eee' }} delay={0}>
        <div className="relative z-10 max-w-[600px] mx-auto text-center">
          <motion.div variants={fadeUp} className="flex justify-center mb-6">
            <img src="/rayna-logo.webp" alt="Rayna Tours" className="h-14 object-contain" />
          </motion.div>

          <motion.h2 variants={fadeUp} className="font-bold mb-3 text-center" style={{ fontSize: 'clamp(26px, 4vw, 42px)', letterSpacing: '-0.5px', color: '#111' }}>
            Ready to Get Started?
          </motion.h2>

          <motion.p variants={fadeUp} className="text-[15px] leading-relaxed max-w-[480px] mx-auto mb-8 text-center" style={{ color: '#666' }}>
            Sign in to access your dashboard and start managing your customer journeys today.
          </motion.p>

          <motion.div variants={fadeUp}>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[15px] font-semibold no-underline transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: '#111', color: '#fff' }}
            >
              Sign In to Dashboard <ArrowRight size={18} />
            </Link>
          </motion.div>

          <motion.p variants={fadeIn} className="mt-14 text-[11px] uppercase tracking-widest text-center" style={{ color: '#bbb' }}>
            &copy; {new Date().getFullYear()} Rayna Tours &middot; All rights reserved
          </motion.p>
        </div>
      </Anim>
    </div>
  );
}
