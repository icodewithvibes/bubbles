// AuroraBackground — from 21st.dev (@dhileepkumargm/aurora-background), adapted:
// motion/react instead of framer-motion, fills its parent, stars fixed per mount.
import { motion } from 'motion/react'
import { useMemo } from 'react'

export function AuroraBackground({ starCount = 60 }: { starCount?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: starCount }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        peak: Math.random() * 0.8,
        dur: Math.random() * 3 + 2,
        delay: Math.random() * 5,
      })),
    [starCount],
  )
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#06041a' }} aria-hidden>
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at 30% 20%, rgba(168,85,247,0.35) 0%, transparent 60%), radial-gradient(circle at 75% 80%, rgba(79,70,229,0.35) 0%, transparent 60%)',
        }}
      />
      <motion.div className="absolute inset-0 mix-blend-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}>
        <motion.div
          className="absolute -top-1/4 -left-1/4 h-1/2 w-1/2 rounded-full bg-purple-600 opacity-40 blur-3xl"
          animate={{ x: [-50, 50, -50], y: [-20, 20, -20], scale: [1, 1.2, 1] }}
          transition={{ duration: 30, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-1/4 -bottom-1/4 h-1/2 w-1/2 rounded-full bg-fuchsia-600 opacity-40 blur-3xl"
          animate={{ x: [50, -50, 50], y: [20, -20, 20], scale: [1, 1.3, 1] }}
          transition={{ duration: 40, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/3 left-1/3 h-1/3 w-1/3 rounded-full bg-indigo-700 opacity-30 blur-3xl"
          animate={{ x: [20, -20, 20], y: [-30, 30, -30], rotate: [0, 360, 0] }}
          transition={{ duration: 50, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-[10%] right-[15%] h-1/3 w-1/3 rounded-full bg-sky-500 opacity-25 blur-3xl"
          animate={{ x: [-30, 30, -30], y: [10, -25, 10] }}
          transition={{ duration: 36, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      </motion.div>
      {stars.map((s, i) => (
        <motion.div
          key={i}
          className="absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, s.peak, 0] }}
          transition={{ duration: s.dur, repeat: Infinity, delay: s.delay }}
        />
      ))}
    </div>
  )
}
