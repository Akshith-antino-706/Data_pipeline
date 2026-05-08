'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] }
};

export default function NotFound() {
  return (
    <motion.div className="not-found" {...pageTransition}>
      <h1>404</h1>
      <p>Page not found. The page you are looking for does not exist.</p>
      <Link href="/" className="btn btn-primary">Back to Dashboard</Link>
    </motion.div>
  );
}
