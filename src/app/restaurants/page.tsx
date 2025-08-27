'use client';

import Link from 'next/link';

export default function RestaurantsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Restaurantes</h1>
          <p className="mt-4 text-lg text-gray-600">
            Explora todos los restaurantes disponibles
          </p>
        </div>
        
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}