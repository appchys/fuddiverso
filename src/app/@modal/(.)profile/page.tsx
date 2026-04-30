'use client'

import ProfileView from '@/components/ProfileView'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function ProfileModal() {
  const router = useRouter()

  // Prevenir scroll en el body cuando el modal está abierto
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  const handleClose = () => {
    router.back()
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col md:items-end justify-end md:justify-center pointer-events-none">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto cursor-pointer"
      />

      {/* Content Panel */}
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full md:max-w-2xl h-[92vh] md:h-full bg-gray-50 md:shadow-2xl pointer-events-auto overflow-y-auto md:mr-0 scrollbar-hide md:rounded-l-[40px] shadow-[0_-20px_50px_rgba(0,0,0,0.3)]"
      >
        <ProfileView isModal onClose={handleClose} />
      </motion.div>
    </div>
  )
}
