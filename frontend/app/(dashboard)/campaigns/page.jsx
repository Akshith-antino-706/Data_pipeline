'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { getJourneys } from '@/lib/api';
import { Mail, MessageCircle, Smartphone, Bell, Globe, MessageSquare } from 'lucide-react';

const CHANNEL_ICON  = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell, rcs: MessageSquare, web: Globe };
const CHANNEL_COLOR = { email: 'var(--red)', whatsapp: '#25d366', sms: 'var(--orange)', push: 'var(--purple)', rcs: 'var(--yellow)', web: 'var(--brand-primary)' };
const STATUS_BADGE  = { active: 'badge-green', draft: 'badge-gray', paused: 'badge-orange', completed: 'badge-purple' };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

function getPrimaryChannel(nodes = []) {
  return (nodes.find(n => n.type === 'action')?.data?.channel || '').toLowerCase() || null;
}

export default function Campaigns() {
  const router = useRouter();
  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJourneys({ limit: 100 })
      .then(res => setJourneys(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      {/* Page header — keep real title visible */}
      <div className="page-header">
        <h2>Campaigns</h2>
      </div>

      {/* Table card skeleton */}
      <div className="card">
        <div className="card-header">
          <div className="skeleton" style={{ width: 160, height: 16, borderRadius: 4 }} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Campaign', 'Channel', 'Segment', 'Status'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(8)].map((_, i) => (
                <tr key={i}>
                  <td><div className="skeleton" style={{ width: 180, height: 13, borderRadius: 4 }} /></td>
                  <td><div className="skeleton" style={{ width: 70, height: 13, borderRadius: 4 }} /></td>
                  <td><div className="skeleton" style={{ width: 120, height: 13, borderRadius: 4 }} /></td>
                  <td><div className="skeleton" style={{ width: 56, height: 20, borderRadius: 20 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp} className="page-header">
        <h2>Campaigns</h2>
      </motion.div>

      <motion.div variants={fadeInUp} className="card">
        <div className="card-header">
          <h3>All Campaigns ({journeys.length})</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th>Segment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {journeys.map(j => {
                const channel = getPrimaryChannel(j.nodes || []);
                const ChIcon = CHANNEL_ICON[channel];
                return (
                  <tr
                    key={j.journey_id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/campaigns/${j.journey_id}`)}
                  >
                    <td className="font-medium">{j.name}</td>
                    <td>
                      {channel ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: CHANNEL_COLOR[channel] }}>
                          {ChIcon && <ChIcon size={12} />}{channel}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{j.segment_name || '—'}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[j.status] || 'badge-gray'}`}>
                        {j.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {journeys.length === 0 && (
                <tr><td colSpan={4} className="empty">No journeys yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}
