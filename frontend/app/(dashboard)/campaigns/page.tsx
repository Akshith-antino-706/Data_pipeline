'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getJourneys } from '@/lib/api';
import { Mail, MessageCircle, Smartphone, Bell, Globe, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, PageHeader, Skeleton, StatusChip, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from './campaigns.module.css';

interface JourneyNode { type?: string; data?: { channel?: string } }
interface JourneyRow { journey_id: number | string; name?: string; segment_name?: string; status: string; nodes?: JourneyNode[] }

const CHANNEL_ICON: Record<string, LucideIcon> = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell, rcs: MessageSquare, web: Globe };
const STATUS_TONE: Record<string, ChipTone> = { active: 'ok', draft: 'mute', paused: 'warn', completed: 'info' };

function getPrimaryChannel(nodes: JourneyNode[] = []) {
  return (nodes.find(n => n.type === 'action')?.data?.channel || '').toLowerCase() || null;
}

const HEADERS = ['Campaign', 'Channel', 'Segment', 'Status'];

export default function Campaigns() {
  const router = useRouter();
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJourneys({ limit: 100 })
      .then(res => setJourneys((res as { data?: JourneyRow[] }).data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const header = <PageHeader title="Campaigns" description="Every journey and the channel it sends on. Select one to see per-step results." />;

  if (loading) return (
    <div className={styles.page}>
      {header}
      <Card title={<Skeleton width={160} height={16} />}>
        <Table label="Campaigns loading">
          <thead><tr>{HEADERS.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {[...Array<undefined>(8)].map((_, i) => (
              <tr key={i}>
                <td><Skeleton width={180} height={13} /></td>
                <td><Skeleton width={70} height={13} /></td>
                <td><Skeleton width={120} height={13} /></td>
                <td><Skeleton width={56} height={20} radius={20} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );

  return (
    <div className={styles.page}>
      {header}
      <Card title={`All Campaigns (${journeys.length})`}>
        <Table label="Campaigns">
          <thead><tr>{HEADERS.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {journeys.map(j => {
              const channel = getPrimaryChannel(j.nodes || []);
              const ChIcon = channel ? CHANNEL_ICON[channel] : undefined;
              const go = () => router.push(`/campaigns/${j.journey_id}`);
              return (
                <tr
                  key={j.journey_id}
                  className={styles.row}
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={e => { if (e.key === 'Enter') go(); }}
                >
                  <td className={styles.name}>{j.name}</td>
                  <td>
                    {channel ? (
                      <span className={styles.channel}>{ChIcon && <ChIcon size={13} aria-hidden="true" />}{channel}</span>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                  <td>{j.segment_name || <span className={styles.muted}>—</span>}</td>
                  <td><StatusChip tone={STATUS_TONE[j.status] ?? 'mute'}>{j.status}</StatusChip></td>
                </tr>
              );
            })}
            {journeys.length === 0 && (
              <tr><td colSpan={4} className={styles.empty}>No journeys yet</td></tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
