'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Merged into /segmentation (custom segments live there with search, status filter and paging). */
export default function AllSegmentsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/segmentation'); }, [router]);
  return null;
}
