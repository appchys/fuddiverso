'use client'

import Link from 'next/link'
import type { Business } from '@/types'

interface BusinessHeaderProps {
  business: Business
  username: string
  disableLink?: boolean
}

export default function BusinessHeader({ business, username, disableLink = false }: BusinessHeaderProps) {
  const content = (
    <>
      <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center border-2 border-white shadow-md ring-1 ring-gray-100 group-hover:shadow-lg transition-all">
        {business.image ? (
          <img
            src={business.image}
            alt={business.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-lg font-black text-gray-400">
            {business.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-base font-black text-gray-900 tracking-tight leading-tight group-hover:text-red-600 transition-colors">
          {business.name}
        </span>
        {business.username && (
          <span className="text-xs font-bold text-gray-400">
            @{business.username}
          </span>
        )}
      </div>
    </>
  )

  return (
    <div className="mb-8">
      {disableLink ? (
        <div className="inline-flex items-center space-x-4 group p-3 rounded-2xl bg-gray-50 border border-gray-100 shadow-sm">
          {content}
        </div>
      ) : (
        <Link
          href={`/${username}`}
          className="inline-flex items-center space-x-4 group p-2 rounded-2xl hover:bg-gray-50 transition-all duration-300"
        >
          {content}
        </Link>
      )}
    </div>
  )
}
