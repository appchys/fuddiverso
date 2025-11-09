'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface PremioFloatingButtonProps {
  onAgregarPremio: () => void
  premioYaAgregado: boolean
}

export function PremioFloatingButton({ onAgregarPremio, premioYaAgregado }: PremioFloatingButtonProps) {
  if (premioYaAgregado) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 100 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 100 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="fixed bottom-20 right-6 z-40 md:bottom-6"
      >
        <motion.button
          onClick={onAgregarPremio}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-500 hover:via-amber-600 hover:to-yellow-600 text-white font-bold py-4 px-6 rounded-full shadow-2xl transition-all duration-300 flex items-center gap-3 group relative overflow-hidden"
        >
          {/* Efecto de brillo animado */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30"
            animate={{
              x: ['-100%', '200%'],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: "linear",
            }}
          />
          
          {/* Ícono de regalo con animación */}
          <motion.svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 relative z-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            animate={{
              rotate: [0, -10, 10, -10, 0],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: "easeInOut",
            }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
            />
          </motion.svg>
          
          <div className="relative z-10 text-left">
            <div className="text-base font-extrabold leading-tight">
              ¡Reclama tus
            </div>
            <div className="text-lg font-extrabold leading-tight">
              5 munchys!
            </div>
          </div>

          {/* Partículas decorativas */}
          <motion.div
            className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-300 rounded-full"
            animate={{
              scale: [1, 1.5, 1],
              opacity: [1, 0.5, 1],
            }}
            transition={{
              repeat: Infinity,
              duration: 1.5,
            }}
          />
          <motion.div
            className="absolute -bottom-1 -left-1 w-2 h-2 bg-yellow-300 rounded-full"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [1, 0.6, 1],
            }}
            transition={{
              repeat: Infinity,
              duration: 1.8,
              delay: 0.3,
            }}
          />
        </motion.button>
      </motion.div>
    </AnimatePresence>
  )
}
