import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import s from './Segment.module.css';

export interface SegmentPagerProps {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}

export function SegmentPager({ page, totalPages, onPage }: SegmentPagerProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className={s.pager} aria-label="Pages">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} aria-hidden="true" /> Prev</Button>
      <span>Page {page} of {totalPages}</span>
      <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={14} aria-hidden="true" /></Button>
    </nav>
  );
}
