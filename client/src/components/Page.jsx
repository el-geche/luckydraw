import { motion } from 'framer-motion';

const variants = {
  initial: { opacity: 0, y: 14, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1], when: 'beforeChildren', staggerChildren: 0.05 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } },
};
export function Page({ children, className = '' }) {
  return <motion.main className={`page container ${className}`} variants={variants} initial="initial" animate="animate" exit="exit">{children}</motion.main>;
}
export const rise = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } };
export const Rise = ({ as = 'div', children, ...p }) => {
  const C = motion[as];
  return <C variants={rise} {...p}>{children}</C>;
};
