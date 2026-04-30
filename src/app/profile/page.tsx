'use client'

import ProfileView from '@/components/ProfileView'
import { motion } from 'framer-motion'

export default function ProfilePage() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <ProfileView />
    </motion.div>
  )
}
