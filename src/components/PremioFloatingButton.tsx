'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'

interface PremioFloatingButtonProps {
  onAgregarPremio: () => void
  premioYaAgregado: boolean
  businessName?: string
  show?: boolean
}

export function PremioFloatingButton({ onAgregarPremio, premioYaAgregado, businessName = '', show = false }: PremioFloatingButtonProps) {
  // Si no es la tienda munchys o no se debe mostrar, no renderizar nada
  if (businessName.toLowerCase() !== 'munchys' || !show) {
    return null;
  }
  
  const [isExpanded, setIsExpanded] = useState(false);
  
  const handleClick = () => {
    if (isExpanded) {
      // Si ya está expandido, ejecutar la acción de agregar premio
      onAgregarPremio();
      // Colapsar después de agregar
      setIsExpanded(false);
    } else {
      // Si está colapsado, expandir
      setIsExpanded(true);
      // Colapsar automáticamente después de 3 segundos
      setTimeout(() => {
        setIsExpanded(false);
      }, 3000);
    }
  };;
  
  if (premioYaAgregado) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 100 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 100 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="fixed bottom-20 right-6 z-40"
      >
        <motion.button
          onClick={handleClick}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={`bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-500 hover:via-amber-600 hover:to-yellow-600 text-white rounded-full shadow-2xl hover:shadow-xl transition-all duration-300 transform hover:scale-105 group flex items-center justify-center ${isExpanded ? 'px-6' : 'w-12 h-12'}`}
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
          <div className={`flex items-center ${isExpanded ? 'px-4 py-3 space-x-2' : 'p-0'}`}>
            <div className="relative">
              <motion.svg
                xmlns="http://www.w3.org/2000/svg"
                className={`${isExpanded ? 'h-6 w-6' : 'h-6 w-6'}`}
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
            </div>
            {isExpanded && (
              <div className="text-left">
                <div className="text-sm font-semibold leading-none">¡Reclama tus</div>
                <div className="text-xs text-amber-100 leading-none mt-0.5">5 munchys!</div>
              </div>
            )}
          </div>

          {/* Contador de notificación */}
          {!isExpanded && (
            <span className="absolute -top-1 -right-1 bg-yellow-400 text-amber-900 rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center animate-pulse">
              !
            </span>
          )}
        </motion.button>
      </motion.div>
    </AnimatePresence>
  )
}
